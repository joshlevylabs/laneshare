/**
 * Parallel Document Generation Orchestrator
 *
 * Manages the 7-terminal parallel document generation process.
 * Uses bridge connections to execute Claude Code CLI in user's Codespace.
 *
 * Architecture:
 * Phase 1: Context Gathering - Discover agents.md files, fetch file tree
 * Phase 2: Agents Summary - Generate sequentially (needed by other docs)
 * Phase 3: Parallel Generation - Launch 6 terminals for remaining docs
 * Phase 4: Assembly - Store results in database
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/lib/supabase/types'
import {
  DOC_TYPES,
  DocType,
  DocGenerationSession,
  DocGenerationPhase,
  DocJobStatus,
  initializeDocGenSession,
  areParallelJobsComplete,
  countCompletedJobs,
  countFailedJobs,
  type DocPromptContext,
} from '@laneshare/shared'
import { buildDocPrompt } from '@laneshare/shared'
import { RepoContextProvider } from './repo-context-provider'

// ============================================
// Types
// ============================================

export interface OrchestratorOptions {
  bundleId: string
  projectId: string
  repoId: string
  userId: string
  connectionId?: string  // Bridge connection ID from workspace session
  sessionId?: string     // Workspace session ID
  supabase: SupabaseClient
  onProgress?: (session: DocGenerationSession) => void
  // Timeout per document (default 4 minutes)
  documentTimeoutMs?: number
  // Whether to allow API fallback when bridge is not available (default: false)
  // When false (default), requires an active Codespace with Claude Code running
  allowApiFallback?: boolean
}

export interface OrchestratorResult {
  success: boolean
  session: DocGenerationSession
  pagesGenerated: number
  pagesFailed: number
  error?: string
}

// ============================================
// Constants
// ============================================

const DEFAULT_DOCUMENT_TIMEOUT_MS = 4 * 60 * 1000 // 4 minutes per document
const PARALLEL_DOC_TYPES: DocType[] = ['ARCHITECTURE', 'FEATURES', 'APIS', 'RUNBOOK', 'ADRS', 'SUMMARY']

// ============================================
// Orchestrator Class
// ============================================

export class DocGenerationOrchestrator {
  private session: DocGenerationSession
  private context: DocPromptContext | null = null
  private options: OrchestratorOptions
  private documentTimeoutMs: number

  constructor(options: OrchestratorOptions) {
    this.options = options
    this.documentTimeoutMs = options.documentTimeoutMs ?? DEFAULT_DOCUMENT_TIMEOUT_MS
    this.session = initializeDocGenSession(
      options.bundleId,
      options.projectId,
      options.repoId,
      options.connectionId,
      options.sessionId
    )
  }

  /**
   * Run the full parallel document generation process
   */
  async run(): Promise<OrchestratorResult> {
    try {
      // Phase 1: Gather context
      await this.gatherContext()

      // Phase 2: Generate Agents Summary (sequential - needed by others)
      await this.generateAgentsSummary()

      // Check if we should continue after agents summary
      if (this.session.jobs.AGENTS_SUMMARY.status !== 'completed') {
        console.warn('[DocOrchestrator] Agents Summary failed, continuing with remaining docs anyway')
      }

      // Phase 3: Generate remaining 6 documents in parallel
      await this.generateParallelDocuments()

      // Phase 4: Assemble and store
      await this.assembleAndStore()

      this.session.phase = 'complete'
      this.session.completedAt = new Date().toISOString()
      await this.emitProgress()

      return {
        success: true,
        session: this.session,
        pagesGenerated: countCompletedJobs(this.session),
        pagesFailed: countFailedJobs(this.session),
      }
    } catch (error) {
      this.session.phase = 'error'
      this.session.error = error instanceof Error ? error.message : 'Unknown error'
      await this.emitProgress()

      return {
        success: false,
        session: this.session,
        pagesGenerated: countCompletedJobs(this.session),
        pagesFailed: countFailedJobs(this.session),
        error: this.session.error,
      }
    }
  }

  /**
   * Phase 1: Gather repository context including agents.md files
   */
  private async gatherContext(): Promise<void> {
    this.session.phase = 'context'
    await this.emitProgress()

    console.log('[DocOrchestrator] Gathering context...')

    // Get repo info
    const { data: repo, error: repoError } = await this.options.supabase
      .from('repos')
      .select('*')
      .eq('id', this.options.repoId)
      .single()

    if (repoError || !repo) {
      throw new Error('Repository not found')
    }

    // Create context provider
    const contextProvider = new RepoContextProvider(this.options.supabase)

    // Build context (round 1 to get initial files)
    const repoContext = await contextProvider.buildContext(
      this.options.repoId,
      this.options.userId,
      1, // round
      1, // maxRounds
      [] // no requested files
    )

    // Discover agents.md files specifically
    const agentsMdFiles = await this.discoverAgentsMdFiles(
      contextProvider,
      repoContext.file_tree,
      repo.owner,
      repo.name,
      repoContext.default_branch
    )

    console.log(`[DocOrchestrator] Found ${agentsMdFiles.length} agents.md files`)

    // Build file tree string for prompts
    const fileTreeString = repoContext.file_tree
      .map(f => f.path)
      .join('\n')

    // Build key files list for prompts
    const keyFiles = repoContext.key_files.map(f => ({
      path: f.path,
      content: f.content,
    }))

    this.context = {
      repoName: repo.name,
      repoOwner: repo.owner,
      fileTree: fileTreeString,
      agentsMdFiles,
      keyFiles,
    }

    console.log(`[DocOrchestrator] Context ready: ${keyFiles.length} key files, ${agentsMdFiles.length} agents.md files`)
  }

  /**
   * Discover all agents.md files in the repository
   */
  private async discoverAgentsMdFiles(
    contextProvider: RepoContextProvider,
    fileTree: Array<{ path: string }>,
    owner: string,
    repo: string,
    branch: string
  ): Promise<Array<{ path: string; content: string }>> {
    // Find all agents.md files in the tree
    const agentsMdPaths = fileTree
      .filter(f => f.path.toLowerCase().endsWith('agents.md'))
      .map(f => f.path)

    if (agentsMdPaths.length === 0) {
      console.log('[DocOrchestrator] No agents.md files found')
      return []
    }

    console.log(`[DocOrchestrator] Found ${agentsMdPaths.length} agents.md files, fetching contents...`)

    // Get GitHub client and fetch contents
    const { data: connection } = await this.options.supabase
      .from('github_connections')
      .select('access_token_encrypted')
      .eq('user_id', this.options.userId)
      .single()

    if (!connection) {
      console.warn('[DocOrchestrator] No GitHub connection, cannot fetch agents.md files')
      return []
    }

    // Import dynamically to avoid circular dependency
    const { GitHubClient } = await import('./github')
    const { decrypt } = await import('./encryption')

    const token = await decrypt(connection.access_token_encrypted)
    const github = new GitHubClient(token)

    // Fetch all agents.md files in parallel
    const results = await Promise.all(
      agentsMdPaths.map(async (path) => {
        try {
          const content = await github.getFileContentDecoded(owner, repo, path, branch)
          return content ? { path, content } : null
        } catch (error) {
          console.warn(`[DocOrchestrator] Failed to fetch ${path}:`, error)
          return null
        }
      })
    )

    return results.filter((r): r is { path: string; content: string } => r !== null)
  }

  /**
   * Phase 2: Generate Agents Summary (must complete before parallel phase)
   */
  private async generateAgentsSummary(): Promise<void> {
    this.session.phase = 'agents_summary'
    const job = this.session.jobs.AGENTS_SUMMARY
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    await this.emitProgress()

    console.log('[DocOrchestrator] Generating Agents Summary...')

    try {
      if (!this.context) {
        throw new Error('Context not initialized')
      }

      const prompt = buildDocPrompt('AGENTS_SUMMARY', this.context)
      const result = await this.executePrompt(prompt, 'AGENTS_SUMMARY')

      job.result = result
      job.status = 'completed'
      job.completedAt = new Date().toISOString()

      // Cache for use by other documents
      this.session.agentsSummaryContent = result
      this.context.agentsSummary = result

      console.log('[DocOrchestrator] Agents Summary completed successfully')
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Unknown error'
      job.completedAt = new Date().toISOString()
      console.error('[DocOrchestrator] Agents Summary failed:', error)
    }

    await this.emitProgress()
  }

  /**
   * Phase 3: Generate 6 documents in parallel (with staggered start to avoid rate limits)
   *
   * Rate limit is 30k tokens/minute. Each prompt is ~15-20k tokens.
   * So we stagger starts by 30 seconds to avoid hitting the limit.
   */
  private async generateParallelDocuments(): Promise<void> {
    this.session.phase = 'parallel'
    await this.emitProgress()

    console.log('[DocOrchestrator] Starting parallel document generation (staggered to avoid rate limits)...')

    // Stagger delay between starting each document (30 seconds)
    const STAGGER_DELAY_MS = 30 * 1000

    // Launch documents with staggered starts
    const promises = PARALLEL_DOC_TYPES.map((docType, index) =>
      this.generateDocumentWithDelay(docType, index * STAGGER_DELAY_MS)
    )

    // Wait for all to complete (success or failure)
    await Promise.all(promises)

    console.log('[DocOrchestrator] Parallel generation complete')
    console.log(`[DocOrchestrator] Completed: ${countCompletedJobs(this.session)}, Failed: ${countFailedJobs(this.session)}`)
  }

  /**
   * Generate a document with an initial delay
   */
  private async generateDocumentWithDelay(docType: DocType, delayMs: number): Promise<void> {
    if (delayMs > 0) {
      console.log(`[DocOrchestrator] ${DOC_TYPES[docType].title} will start in ${delayMs / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
    return this.generateDocument(docType)
  }

  /**
   * Generate a single document
   */
  private async generateDocument(docType: DocType): Promise<void> {
    const job = this.session.jobs[docType]
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    await this.emitProgress()

    console.log(`[DocOrchestrator] Generating ${DOC_TYPES[docType].title}...`)

    try {
      if (!this.context) {
        throw new Error('Context not initialized')
      }

      const prompt = buildDocPrompt(docType, this.context)
      const result = await this.executePrompt(prompt, docType)

      job.result = result
      job.status = 'completed'
      job.completedAt = new Date().toISOString()

      console.log(`[DocOrchestrator] ${DOC_TYPES[docType].title} completed`)
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : 'Unknown error'
      job.completedAt = new Date().toISOString()
      console.error(`[DocOrchestrator] ${DOC_TYPES[docType].title} failed:`, error)
    }

    await this.emitProgress()
  }

  /**
   * Execute a prompt - requires bridge connection by default (Claude Code in Codespace)
   * Falls back to API only if allowApiFallback is explicitly true
   */
  private async executePrompt(prompt: string, docType: DocType): Promise<string> {
    const hasBridge = this.options.connectionId && this.options.sessionId
    const allowApiFallback = this.options.allowApiFallback === true

    if (hasBridge) {
      return this.executeViaBridge(prompt, docType)
    } else if (allowApiFallback) {
      console.log(`[DocOrchestrator] No bridge connection, using API fallback for ${docType}`)
      return this.executeViaApi(prompt, docType)
    } else {
      throw new Error(
        'Claude Code headless mode requires an active Codespace connection. ' +
        'Please start a Codespace from the Workspace page and ensure Claude Code is running.'
      )
    }
  }

  /**
   * Execute prompt via bridge connection (Claude Code CLI in Codespace)
   */
  private async executeViaBridge(prompt: string, docType: DocType): Promise<string> {
    const { connectionId, sessionId, supabase, userId } = this.options

    if (!connectionId || !sessionId) {
      throw new Error('Bridge connection not available')
    }

    console.log(`[DocOrchestrator] Queueing ${docType} prompt to bridge...`)

    // Queue prompt to bridge_prompt_queue
    const { data: queueItem, error: queueError } = await supabase
      .from('bridge_prompt_queue')
      .insert({
        session_id: sessionId,
        connection_id: connectionId,
        prompt: prompt,
        prompt_type: 'doc_generation',
        doc_type: docType,
        result_bundle_id: this.options.bundleId,
        status: 'PENDING',
        created_by: userId,
      })
      .select()
      .single()

    if (queueError || !queueItem) {
      throw new Error(`Failed to queue prompt: ${queueError?.message || 'Unknown error'}`)
    }

    // Store queue ID in job
    this.session.jobs[docType].promptQueueId = queueItem.id

    // Wait for result via polling (simpler than realtime for this use case)
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      const pollInterval = 2000 // 2 seconds

      const poll = async () => {
        // Check timeout
        if (Date.now() - startTime > this.documentTimeoutMs) {
          // Cancel the queued prompt
          await supabase
            .from('bridge_prompt_queue')
            .update({ status: 'CANCELLED' })
            .eq('id', queueItem.id)
          reject(new Error('Document generation timeout'))
          return
        }

        // Poll for status
        const { data: updated } = await supabase
          .from('bridge_prompt_queue')
          .select('status, streaming_output, error')
          .eq('id', queueItem.id)
          .single()

        if (!updated) {
          setTimeout(poll, pollInterval)
          return
        }

        if (updated.status === 'COMPLETED') {
          resolve(updated.streaming_output || '')
        } else if (updated.status === 'FAILED') {
          reject(new Error(updated.error || 'Bridge execution failed'))
        } else {
          // Still processing
          setTimeout(poll, pollInterval)
        }
      }

      poll()
    })
  }

  /**
   * Execute prompt via Anthropic API (fallback when bridge not available)
   * Includes retry logic for rate limit errors (429)
   */
  private async executeViaApi(prompt: string, docType: DocType, retryCount = 0): Promise<string> {
    const MAX_RETRIES = 3
    const BASE_RETRY_DELAY_MS = 35 * 1000 // 35 seconds (rate limit resets in ~30s)

    console.log(`[DocOrchestrator] Executing ${docType} via API...${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`)

    // Import Anthropic client
    const Anthropic = (await import('@anthropic-ai/sdk')).default

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: this.documentTimeoutMs,
    })

    const systemPrompt = `You are analyzing a code repository to generate documentation. Follow the instructions exactly and return ONLY the markdown content requested. Do not include any explanatory text or code blocks around the output.`

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      // Extract text from response
      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude API')
      }

      return content.text
    } catch (error: unknown) {
      // Check for rate limit error and retry
      const isRateLimitError = error instanceof Error &&
        'status' in error &&
        (error as { status?: number }).status === 429

      if (isRateLimitError && retryCount < MAX_RETRIES) {
        // Get retry-after from headers if available, otherwise use base delay
        let retryAfterMs = BASE_RETRY_DELAY_MS * (retryCount + 1)

        if ('headers' in error) {
          const headers = (error as { headers?: Record<string, string> }).headers
          const retryAfter = headers?.['retry-after']
          if (retryAfter) {
            retryAfterMs = (parseInt(retryAfter, 10) + 5) * 1000 // Add 5s buffer
          }
        }

        console.log(`[DocOrchestrator] Rate limited for ${docType}, retrying in ${Math.round(retryAfterMs / 1000)}s...`)
        await new Promise(resolve => setTimeout(resolve, retryAfterMs))

        return this.executeViaApi(prompt, docType, retryCount + 1)
      }

      throw error
    }
  }

  /**
   * Map DOC_TYPES category to document_category enum
   */
  private mapToDocumentCategory(docCategory: string): string {
    const mapping: Record<string, string> = {
      'ARCHITECTURE': 'architecture',
      'API': 'api',
      'FEATURE': 'feature_guide',
      'RUNBOOK': 'runbook',
    }
    return mapping[docCategory] || 'other'
  }

  /**
   * Phase 4: Assemble results and store in database
   */
  private async assembleAndStore(): Promise<void> {
    this.session.phase = 'assembly'
    await this.emitProgress()

    console.log('[DocOrchestrator] Assembling and storing results...')

    const { supabase, bundleId, projectId, repoId, userId } = this.options
    const repoName = this.context?.repoName || 'unknown'

    // Build pages from completed jobs
    const pagesToInsert = Object.entries(this.session.jobs)
      .filter(([_, job]) => job.status === 'completed' && job.result)
      .map(([docType, job]) => {
        const docInfo = DOC_TYPES[docType as DocType]
        return {
          bundle_id: bundleId,
          project_id: projectId,
          repo_id: repoId,
          category: docInfo.category,
          slug: `${docInfo.category.toLowerCase()}/${docInfo.id}`,
          title: docInfo.title,
          markdown: job.result!,
          original_markdown: job.result!,
          evidence_json: [] as unknown as Json,
          needs_review: false,
          verification_score: 100, // Auto-generated docs assumed valid
          verification_issues: [] as unknown as Json,
        }
      })

    console.log(`[DocOrchestrator] Inserting ${pagesToInsert.length} pages to repo_doc_pages...`)

    // Batch insert all pages to repo_doc_pages
    let insertedPages: Array<{ id: string; slug: string; category: string }> = []
    if (pagesToInsert.length > 0) {
      const { data: pagesData, error: pagesError } = await supabase
        .from('repo_doc_pages')
        .insert(pagesToInsert)
        .select('id, slug, category')

      if (pagesError) {
        console.error('[DocOrchestrator] Failed to insert pages:', pagesError)
        throw new Error(`Failed to store documentation: ${pagesError.message}`)
      }
      insertedPages = pagesData || []
    }

    // Auto-sync to documents table
    console.log(`[DocOrchestrator] Syncing ${pagesToInsert.length} pages to documents table...`)
    await this.syncToDocuments(pagesToInsert, insertedPages, repoName, userId)

    // Calculate summary
    const pagesByCategory: Record<string, number> = {}
    for (const page of pagesToInsert) {
      pagesByCategory[page.category] = (pagesByCategory[page.category] || 0) + 1
    }

    const failedCount = countFailedJobs(this.session)
    const finalStatus = pagesToInsert.length === 0 ? 'ERROR' :
                        failedCount > 0 ? 'NEEDS_REVIEW' : 'READY'

    // Update bundle
    await supabase
      .from('repo_doc_bundles')
      .update({
        status: finalStatus,
        generated_at: new Date().toISOString(),
        summary_json: {
          total_pages: pagesToInsert.length,
          pages_by_category: pagesByCategory,
          generation_mode: 'parallel',
          completed_jobs: countCompletedJobs(this.session),
          failed_jobs: failedCount,
        } as unknown as Json,
        progress_json: null, // Clear progress on completion
        generation_mode: 'parallel',
      })
      .eq('id', bundleId)

    // Update repo status
    await supabase
      .from('repos')
      .update({
        doc_status: finalStatus,
      })
      .eq('id', repoId)

    console.log(`[DocOrchestrator] Assembly complete. Status: ${finalStatus}`)
  }

  /**
   * Sync generated pages to the documents table for unified viewing
   */
  private async syncToDocuments(
    pages: Array<{
      category: string
      slug: string
      title: string
      markdown: string
      original_markdown: string
      evidence_json: Json
      verification_score: number
      verification_issues: Json
    }>,
    insertedPages: Array<{ id: string; slug: string; category: string }>,
    repoName: string,
    userId: string
  ): Promise<void> {
    const { supabase, projectId, repoId, bundleId } = this.options

    for (const page of pages) {
      // Find the corresponding inserted page to get its ID
      const insertedPage = insertedPages.find(p => p.slug === page.slug)

      // Build document slug: {repoName}-{docType}
      const docSlug = `${repoName.toLowerCase()}-${page.slug.split('/').pop()}`

      // Build document title: {repoName}/{docTitle}
      const docTitle = `${repoName}/${page.title}`

      // Map category to document_category enum
      const docCategory = this.mapToDocumentCategory(page.category)

      // Check if document with this slug already exists
      const { data: existingDoc } = await supabase
        .from('documents')
        .select('id')
        .eq('project_id', projectId)
        .eq('slug', docSlug)
        .single()

      if (existingDoc) {
        // Update existing document
        const updateData = {
          title: docTitle,
          markdown: page.markdown,
          original_markdown: page.original_markdown,
          evidence_json: page.evidence_json,
          verification_score: page.verification_score,
          verification_issues: page.verification_issues,
          source_repo_id: repoId,
          source_bundle_id: bundleId,
          source_repo_page_id: insertedPage?.id || null,
          needs_review: true,
          reviewed: false,
          reviewed_at: null,
          reviewed_by: null,
          user_edited: false,
          user_edited_at: null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }
        console.log(`[DocOrchestrator] Updating document ${docSlug} with data:`, JSON.stringify(updateData, null, 2))

        const { error: updateError } = await supabase
          .from('documents')
          .update(updateData)
          .eq('id', existingDoc.id)

        if (updateError) {
          console.error(`[DocOrchestrator] Failed to update document ${docSlug}:`, updateError.message, updateError.code, updateError.details, updateError.hint)
        } else {
          console.log(`[DocOrchestrator] Updated document: ${docSlug}`)
        }
      } else {
        // Create new document
        const insertData = {
          project_id: projectId,
          title: docTitle,
          slug: docSlug,
          category: docCategory,
          description: `Auto-generated documentation from ${repoName}`,
          tags: ['auto-generated', repoName],
          markdown: page.markdown,
          original_markdown: page.original_markdown,
          evidence_json: page.evidence_json,
          verification_score: page.verification_score,
          verification_issues: page.verification_issues,
          source_repo_id: repoId,
          source_bundle_id: bundleId,
          source_repo_page_id: insertedPage?.id || null,
          needs_review: true,
          reviewed: false,
          user_edited: false,
          created_by: userId,
        }
        console.log(`[DocOrchestrator] Inserting document ${docSlug} with data:`, JSON.stringify(insertData, null, 2))

        const { error: insertError } = await supabase
          .from('documents')
          .insert(insertData)

        if (insertError) {
          console.error(`[DocOrchestrator] Failed to create document ${docSlug}:`, insertError.message, insertError.code, insertError.details, insertError.hint)
        } else {
          console.log(`[DocOrchestrator] Created document: ${docSlug}`)
        }
      }
    }

    console.log(`[DocOrchestrator] Synced ${pages.length} documents`)
  }

  /**
   * Emit progress update to callback and database
   */
  private async emitProgress(): Promise<void> {
    // Call progress callback
    this.options.onProgress?.(this.session)

    // Update database with progress
    const progressData = {
      phase: this.session.phase,
      jobs: Object.fromEntries(
        Object.entries(this.session.jobs).map(([k, v]) => [k, {
          status: v.status,
          startedAt: v.startedAt,
          completedAt: v.completedAt,
          error: v.error,
        }])
      ),
      pagesGenerated: countCompletedJobs(this.session),
      totalPages: 7,
      startedAt: this.session.startedAt,
      lastUpdated: new Date().toISOString(),
    }

    await this.options.supabase
      .from('repo_doc_bundles')
      .update({
        progress_json: progressData as unknown as Json,
      })
      .eq('id', this.options.bundleId)
  }
}

/**
 * Create and run orchestrator (convenience function)
 */
export async function runParallelDocGeneration(
  options: OrchestratorOptions
): Promise<OrchestratorResult> {
  const orchestrator = new DocGenerationOrchestrator(options)
  return orchestrator.run()
}
