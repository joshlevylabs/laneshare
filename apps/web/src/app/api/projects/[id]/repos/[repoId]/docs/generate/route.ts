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
import { createClaudeRunner, type ValidatedClaudeOutput } from '@/lib/claude-code-runner'
import type { RepoDocStatus, RepoDocBundleSummary, RepoDocCategory } from '@laneshare/shared'

const GenerateRequestSchema = z.object({
  force: z.boolean().optional().default(false),
})

const MAX_ROUNDS = 3

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
    const { force } = GenerateRequestSchema.parse(body)

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

    // Start generation in background
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

    return NextResponse.json({
      message: 'Documentation generation started',
      bundle_id: bundle.id,
      version: nextVersion,
      status: 'GENERATING',
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
  const claudeRunner = createClaudeRunner()

  let currentOutput: ValidatedClaudeOutput | undefined
  let allPages: ValidatedClaudeOutput['pages'] = []
  let allWarnings: string[] = []
  let allTasks: ValidatedClaudeOutput['tasks'] = []

  try {
    // Update status to GENERATING
    await supabase
      .from('repo_doc_bundles')
      .update({ status: 'GENERATING' as RepoDocStatus })
      .eq('id', bundleId)

    // Run up to MAX_ROUNDS
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      console.log(`[DocGen] Starting round ${round}/${MAX_ROUNDS} for bundle ${bundleId}`)

      // Build context
      const context = await contextProvider.buildContext(
        repoId,
        userId,
        round,
        MAX_ROUNDS,
        currentOutput?.needs_more_files || []
      )

      // Run Claude Code
      const result = await claudeRunner.run(context, currentOutput)

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

    // Deduplicate pages by slug (keep latest)
    const pageMap = new Map<string, ValidatedClaudeOutput['pages'][0]>()
    for (const page of allPages) {
      pageMap.set(page.slug, page)
    }
    const uniquePages = Array.from(pageMap.values())

    // Save pages to database
    let needsReviewCount = 0
    for (const page of uniquePages) {
      const needsReview = page.markdown.includes('[Needs Review]') ||
                         page.evidence.length === 0

      if (needsReview) needsReviewCount++

      await supabase
        .from('repo_doc_pages')
        .insert({
          bundle_id: bundleId,
          project_id: projectId,
          repo_id: repoId,
          category: page.category,
          slug: page.slug,
          title: page.title,
          markdown: page.markdown,
          evidence_json: page.evidence,
          needs_review: needsReview,
        })
    }

    // Save tasks
    for (const task of allTasks) {
      await supabase
        .from('repo_doc_tasks')
        .insert({
          bundle_id: bundleId,
          project_id: projectId,
          repo_id: repoId,
          title: task.title,
          description: task.description,
          category: task.category,
          priority: task.priority || 'medium',
        })
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
    }

    // Determine final status
    const finalStatus: RepoDocStatus = needsReviewCount > 0 ? 'NEEDS_REVIEW' : 'READY'

    // Update bundle
    await supabase
      .from('repo_doc_bundles')
      .update({
        status: finalStatus,
        generated_at: new Date().toISOString(),
        summary_json: summary,
        source_fingerprint: fingerprint,
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

    // Update bundle with error
    await supabase
      .from('repo_doc_bundles')
      .update({
        status: 'ERROR' as RepoDocStatus,
        error: errorMessage,
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
