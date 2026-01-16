/**
 * POST /api/projects/[id]/repos/[repoId]/docs/generate
 *
 * Triggers documentation generation for a repository using Claude Code.
 * Creates a new doc bundle and runs the generation pipeline.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { RepoContextProvider, generateRepoFingerprint } from '@/lib/repo-context-provider'
import { createClaudeRunner, type ValidatedClaudeOutput, type ClaudeRunnerProgress } from '@/lib/claude-code-runner'
import { verifyDocumentation, type VerificationSummary, type DocPage } from '@/lib/doc-verification'
import { runParallelDocGeneration } from '@/lib/doc-generation-orchestrator'
import type { RepoDocStatus, RepoDocBundleSummary, RepoDocCategory, RepoContext, DocGenerationSession } from '@laneshare/shared'
import type { Json } from '@/lib/supabase/types'

// Generation modes
type GenerationMode = 'legacy' | 'parallel'

// Progress info stored in the database for UI polling (legacy mode)
interface LegacyDocGenProgress {
  stage: ClaudeRunnerProgress['stage']
  message: string
  pagesGenerated: number
  round: number
  maxRounds: number
  continuationAttempt?: number
  lastUpdated: string
  // Time estimation
  estimatedTotalSeconds?: number
  elapsedSeconds?: number
  // Streaming progress
  streamingPages?: string[]
  // Mode indicator
  mode: 'legacy'
}

// Progress info for parallel mode (matches DocGenerationSession progress)
interface ParallelDocGenProgress {
  mode: 'parallel'
  phase: DocGenerationSession['phase']
  jobs: Record<string, {
    status: string
    startedAt?: string
    completedAt?: string
    error?: string
  }>
  pagesGenerated: number
  totalPages: number
  startedAt?: string
  lastUpdated: string
}

type DocGenProgress = LegacyDocGenProgress | ParallelDocGenProgress

const GenerateRequestSchema = z.object({
  force: z.boolean().optional().default(false),
  mode: z.enum(['legacy', 'parallel']).optional().default('legacy'),
  // For parallel mode with bridge connection
  connectionId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
})

// Reduced from 3 to 2 - with improved file selection (critical files first),
// we get most context in round 1, and rarely need a 3rd round
const MAX_ROUNDS = 2

export async function POST(
  request: Request,
  { params }: { params: { id: string; repoId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  try {
    // Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership (maintainer or higher)
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only maintainers can generate documentation' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json().catch(() => ({}))
    const { force, mode, connectionId, sessionId } = GenerateRequestSchema.parse(body)

    // Get repo info
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .eq('project_id', projectId)
      .single()

    if (repoError || !repo) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    // Check if repo is synced
    if (repo.status !== 'SYNCED') {
      return NextResponse.json(
        { error: 'Repository must be synced before generating documentation' },
        { status: 400 }
      )
    }

    // Generate fingerprint for deduplication
    const fingerprint = generateRepoFingerprint(
      repo.selected_branch || repo.default_branch,
      repo.last_synced_commit_sha || 'unknown'
    )

    // Check existing bundle (skip if same fingerprint and not forced)
    if (!force) {
      const { data: existingBundle } = await supabase
        .from('repo_doc_bundles')
        .select('id, version, status, source_fingerprint')
        .eq('repo_id', repoId)
        .order('version', { ascending: false })
        .limit(1)
        .single()

      if (existingBundle?.source_fingerprint === fingerprint &&
          existingBundle.status !== 'ERROR') {
        return NextResponse.json({
          message: 'Documentation is up to date',
          bundle_id: existingBundle.id,
          version: existingBundle.version,
          status: existingBundle.status,
          skipped: true,
        })
      }
    }

    // Get next version number
    const { data: latestBundle } = await supabase
      .from('repo_doc_bundles')
      .select('version')
      .eq('repo_id', repoId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (latestBundle?.version || 0) + 1

    // Create new bundle with PENDING status
    const { data: bundle, error: bundleError } = await serviceClient
      .from('repo_doc_bundles')
      .insert({
        project_id: projectId,
        repo_id: repoId,
        version: nextVersion,
        status: 'PENDING' as RepoDocStatus,
        generated_by: user.id,
        source_fingerprint: fingerprint,
        generation_mode: mode,
      })
      .select()
      .single()

    if (bundleError || !bundle) {
      console.error('[DocGen] Failed to create bundle:', bundleError)
      return NextResponse.json({ error: 'Failed to create documentation bundle' }, { status: 500 })
    }

    // Update repo doc status
    await serviceClient
      .from('repos')
      .update({
        doc_status: 'GENERATING',
        doc_bundle_id: bundle.id,
      })
      .eq('id', repoId)

    // Start generation in background based on mode
    if (mode === 'parallel') {
      console.log(`[DocGen] Starting PARALLEL generation for bundle ${bundle.id}`)
      runParallelDocGeneration({
        bundleId: bundle.id,
        projectId,
        repoId,
        userId: user.id,
        connectionId,
        sessionId,
        supabase: serviceClient,
        onProgress: (session) => {
          console.log(`[DocGen] Parallel progress: ${session.phase}, ${Object.values(session.jobs).filter(j => j.status === 'completed').length}/7 completed`)
        },
      }).catch(error => {
        console.error('[DocGen] Parallel generation failed:', error)
      })
    } else {
      console.log(`[DocGen] Starting LEGACY generation for bundle ${bundle.id}`)
      runDocGeneration(
        projectId,
        repoId,
        bundle.id,
        user.id,
        serviceClient,
        fingerprint
      ).catch(error => {
        console.error('[DocGen] Background generation failed:', error)
      })
    }

    return NextResponse.json({
      message: 'Documentation generation started',
      bundle_id: bundle.id,
      version: nextVersion,
      status: 'GENERATING',
      mode,
    })
  } catch (error) {
    console.error('[DocGen] Error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Run the documentation generation pipeline
 */
async function runDocGeneration(
  projectId: string,
  repoId: string,
  bundleId: string,
  userId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
  fingerprint: string
) {
  const contextProvider = new RepoContextProvider(supabase)

  let currentRound = 1
  let currentOutput: ValidatedClaudeOutput | undefined
  let allPages: ValidatedClaudeOutput['pages'] = []
  let allWarnings: string[] = []
  let allTasks: ValidatedClaudeOutput['tasks'] = []
  let lastContext: RepoContext | undefined // Keep track of context for verification

  // Helper to update progress in the database
  const updateProgress = async (progress: Partial<LegacyDocGenProgress>) => {
    const progressData: LegacyDocGenProgress = {
      mode: 'legacy',
      stage: progress.stage || 'starting',
      message: progress.message || '',
      pagesGenerated: progress.pagesGenerated ?? allPages.length,
      round: currentRound,
      maxRounds: MAX_ROUNDS,
      continuationAttempt: progress.continuationAttempt,
      lastUpdated: new Date().toISOString(),
      // Include streaming/time estimation fields
      estimatedTotalSeconds: progress.estimatedTotalSeconds,
      elapsedSeconds: progress.elapsedSeconds,
      streamingPages: progress.streamingPages,
    }

    await supabase
      .from('repo_doc_bundles')
      .update({ progress_json: progressData as unknown as Json })
      .eq('id', bundleId)
  }

  // Create runner with progress callback
  const claudeRunner = createClaudeRunner({
    onProgress: async (progress) => {
      await updateProgress({
        stage: progress.stage,
        message: progress.message,
        pagesGenerated: progress.pagesGenerated,
        continuationAttempt: progress.continuationAttempt,
        estimatedTotalSeconds: progress.estimatedTotalSeconds,
        elapsedSeconds: progress.elapsedSeconds,
        streamingPages: progress.streamingPages,
      })
    },
  })

  try {
    // Update status to GENERATING
    await supabase
      .from('repo_doc_bundles')
      .update({ status: 'GENERATING' as RepoDocStatus })
      .eq('id', bundleId)

    await updateProgress({
      stage: 'starting',
      message: 'Initializing documentation generation...',
    })

    // Run up to MAX_ROUNDS
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      currentRound = round
      console.log(`[DocGen] Starting round ${round}/${MAX_ROUNDS} for bundle ${bundleId}`)

      await updateProgress({
        stage: 'calling_api',
        message: `Round ${round}/${MAX_ROUNDS}: Building repository context...`,
      })

      // Build context
      console.log(`[DocGen] Building context for round ${round}...`)
      const contextStartTime = Date.now()
      const context = await contextProvider.buildContext(
        repoId,
        userId,
        round,
        MAX_ROUNDS,
        currentOutput?.needs_more_files || []
      )
      lastContext = context // Save for verification
      const contextElapsed = ((Date.now() - contextStartTime) / 1000).toFixed(1)
      console.log(`[DocGen] Context built in ${contextElapsed}s. Key files: ${context.key_files.length}, Tree files: ${context.file_tree.length}`)

      // Skip follow-up rounds if no files were fetched (avoids Claude complaining about missing context)
      if (round > 1 && context.key_files.length === 0) {
        console.log(`[DocGen] Skipping round ${round} - no additional files available to provide`)
        break
      }

      // Run Claude Code
      console.log(`[DocGen] Starting Claude API call for round ${round}...`)
      const result = await claudeRunner.run(context, currentOutput)
      console.log(`[DocGen] Claude API call completed. Success: ${result.success}, Pages: ${result.output?.pages?.length || 0}`)

      if (!result.success || !result.output) {
        throw new Error(result.error || 'Claude Code execution failed')
      }

      currentOutput = result.output

      // Accumulate results
      allPages.push(...result.output.pages)
      allWarnings.push(...result.output.warnings)
      if (result.output.tasks) {
        allTasks.push(...result.output.tasks)
      }

      await updateProgress({
        stage: 'parsing',
        message: `Round ${round}/${MAX_ROUNDS}: Generated ${result.output.pages.length} pages (${allPages.length} total)`,
        pagesGenerated: allPages.length,
      })

      // Store raw output for debugging
      await supabase
        .from('repo_doc_bundles')
        .update({ raw_output: result.rawOutput })
        .eq('id', bundleId)

      // Check if more files are needed
      if (!result.needsMoreFiles || result.needsMoreFiles.length === 0) {
        console.log(`[DocGen] No more files needed, completing after round ${round}`)
        break
      }

      console.log(`[DocGen] Claude Code requested ${result.needsMoreFiles.length} more files`)
    }

    await updateProgress({
      stage: 'complete',
      message: `Verifying ${allPages.length} documentation pages...`,
      pagesGenerated: allPages.length,
    })

    // Deduplicate pages by slug (keep latest)
    const pageMap = new Map<string, ValidatedClaudeOutput['pages'][0]>()
    for (const page of allPages) {
      pageMap.set(page.slug, page)
    }
    const uniquePages = Array.from(pageMap.values())

    // Run verification against actual file contents
    let verificationSummary: VerificationSummary | undefined
    if (lastContext) {
      console.log(`[DocGen] Running verification on ${uniquePages.length} pages...`)
      const docPages: DocPage[] = uniquePages.map(p => ({
        category: p.category,
        slug: p.slug,
        title: p.title,
        markdown: p.markdown,
        evidence: p.evidence,
      }))

      verificationSummary = verifyDocumentation(
        docPages,
        lastContext.key_files,
        lastContext.file_tree
      )

      console.log(`[DocGen] Verification complete: ${verificationSummary.overall_score}% score, ${verificationSummary.needs_review} pages need review`)

      // Add verification warnings to allWarnings
      for (const pageResult of verificationSummary.pages) {
        for (const issue of pageResult.issues) {
          if (issue.severity === 'error') {
            allWarnings.push(`[${pageResult.title}] ${issue.message}`)
          }
        }
      }
    }

    await updateProgress({
      stage: 'complete',
      message: `Saving ${uniquePages.length} documentation pages...`,
      pagesGenerated: uniquePages.length,
    })

    // Build batch of pages to insert (MUCH faster than one-by-one)
    let needsReviewCount = 0
    const pagesToInsert = uniquePages.map(page => {
      // Get verification result for this page
      const pageVerification = verificationSummary?.pages.find(p => p.slug === page.slug)

      // Determine if needs review based on verification
      const needsReview = pageVerification?.needs_review ??
                         (page.markdown.includes('[Needs Review]') || page.evidence.length === 0)

      if (needsReview) needsReviewCount++

      // Include verification issues in evidence_json
      const evidenceWithVerification = {
        items: page.evidence,
        verification: pageVerification ? {
          score: pageVerification.verification_score,
          verified_count: pageVerification.verified_count,
          total_count: pageVerification.total_evidence,
          issues: pageVerification.issues,
        } : undefined,
      }

      return {
        bundle_id: bundleId,
        project_id: projectId,
        repo_id: repoId,
        category: page.category,
        slug: page.slug,
        title: page.title,
        markdown: page.markdown,
        original_markdown: page.markdown, // Store original for comparison
        evidence_json: evidenceWithVerification as unknown as Json,
        needs_review: needsReview,
        verification_score: pageVerification?.verification_score || 0,
        verification_issues: (pageVerification?.issues || []) as unknown as Json,
      }
    })

    // Batch insert all pages at once (single database call)
    if (pagesToInsert.length > 0) {
      const { error: pagesError } = await supabase
        .from('repo_doc_pages')
        .insert(pagesToInsert)

      if (pagesError) {
        console.error('[DocGen] Failed to insert pages:', pagesError)
      }
    }

    // Batch insert tasks
    if (allTasks.length > 0) {
      const tasksToInsert = allTasks.map(task => ({
        bundle_id: bundleId,
        project_id: projectId,
        repo_id: repoId,
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority || 'medium',
      }))

      const { error: tasksError } = await supabase
        .from('repo_doc_tasks')
        .insert(tasksToInsert)

      if (tasksError) {
        console.error('[DocGen] Failed to insert tasks:', tasksError)
      }
    }

    // Calculate summary
    const pagesByCategory: Partial<Record<RepoDocCategory, number>> = {}
    for (const page of uniquePages) {
      pagesByCategory[page.category] = (pagesByCategory[page.category] || 0) + 1
    }

    const summary: RepoDocBundleSummary = {
      total_pages: uniquePages.length,
      pages_by_category: pagesByCategory as Record<RepoDocCategory, number>,
      needs_review_count: needsReviewCount,
      warnings: allWarnings,
      tech_stack: currentOutput?.repo_summary.tech_stack || [],
      entrypoints: currentOutput?.repo_summary.entrypoints || [],
      // Include verification summary
      verification: verificationSummary ? {
        overall_score: verificationSummary.overall_score,
        verified_evidence: verificationSummary.verified_evidence,
        total_evidence: verificationSummary.total_evidence,
        fully_verified_pages: verificationSummary.fully_verified,
      } : undefined,
    }

    // Determine final status
    const finalStatus: RepoDocStatus = needsReviewCount > 0 ? 'NEEDS_REVIEW' : 'READY'

    // Update bundle (clear progress_json on completion)
    await supabase
      .from('repo_doc_bundles')
      .update({
        status: finalStatus,
        generated_at: new Date().toISOString(),
        summary_json: summary as unknown as Json,
        source_fingerprint: fingerprint,
        progress_json: null, // Clear progress on completion
      })
      .eq('id', bundleId)

    // Update repo status
    await supabase
      .from('repos')
      .update({
        doc_status: finalStatus,
        doc_bundle_id: bundleId,
      })
      .eq('id', repoId)

    console.log(`[DocGen] Completed bundle ${bundleId} with ${uniquePages.length} pages, status: ${finalStatus}`)
  } catch (error) {
    console.error(`[DocGen] Failed for bundle ${bundleId}:`, error)

    // Determine user-friendly error message
    let errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check for GitHub auth errors
    if (errorMessage.includes('401') || errorMessage.includes('Bad credentials')) {
      errorMessage = 'GitHub authentication failed. Please reconnect your GitHub account in Settings > Integrations.'
    } else if (errorMessage.includes('404')) {
      errorMessage = 'Repository not found or access denied. Make sure you have access to this repository.'
    } else if (errorMessage.includes('403')) {
      errorMessage = 'Access to repository denied. You may need to grant additional permissions.'
    }

    // Update progress with error state
    await updateProgress({
      stage: 'error',
      message: errorMessage,
      pagesGenerated: allPages.length,
    })

    // Update bundle with error
    await supabase
      .from('repo_doc_bundles')
      .update({
        status: 'ERROR' as RepoDocStatus,
        error: errorMessage,
        progress_json: null, // Clear progress on error
      })
      .eq('id', bundleId)

    // Update repo status
    await supabase
      .from('repos')
      .update({
        doc_status: 'ERROR',
      })
      .eq('id', repoId)
  }
}
