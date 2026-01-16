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
  connectionId?: string  // Bridge connection (optional - will use API if not available)
  sessionId?: string     // Workspace session
  supabase: SupabaseClient
  onProgress?: (session: DocGenerationSession) => void
  // Timeout per document (default 4 minutes)
  documentTimeoutMs?: number
  // Whether to use bridge connection (default: true if connectionId provided)
  useBridge?: boolean
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
   * Phase 3: Generate 6 documents in parallel
   */
  private async generateParallelDocuments(): Promise<void> {
    this.session.phase = 'parallel'
    await this.emitProgress()

    console.log('[DocOrchestrator] Starting parallel document generation...')

    // Launch all 6 terminals in parallel
    const promises = PARALLEL_DOC_TYPES.map(docType =>
      this.generateDocument(docType)
    )

    // Wait for all to complete (success or failure)
    await Promise.all(promises)

    console.log('[DocOrchestrator] Parallel generation complete')
    console.log(`[DocOrchestrator] Completed: ${countCompletedJobs(this.session)}, Failed: ${countFailedJobs(this.session)}`)
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
   * Execute a prompt - uses bridge if available, otherwise falls back to API
   */
  private async executePrompt(prompt: string, docType: DocType): Promise<string> {
    const useBridge = this.options.useBridge !== false &&
                      this.options.connectionId &&
                      this.options.sessionId

    if (useBridge) {
      return this.executeViaBridge(prompt, docType)
    } else {
      return this.executeViaApi(prompt, docType)
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
   */
  private async executeViaApi(prompt: string, docType: DocType): Promise<string> {
    console.log(`[DocOrchestrator] Executing ${docType} via API...`)

    // Import Anthropic client
    const Anthropic = (await import('@anthropic-ai/sdk')).default

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: this.documentTimeoutMs,
    })

    const systemPrompt = `You are analyzing a code repository to generate documentation. Follow the instructions exactly and return ONLY the markdown content requested. Do not include any explanatory text or code blocks around the output.`

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
  }

  /**
   * Phase 4: Assemble results and store in database
   */
  private async assembleAndStore(): Promise<void> {
    this.session.phase = 'assembly'
    await this.emitProgress()

    console.log('[DocOrchestrator] Assembling and storing results...')

    const { supabase, bundleId, projectId, repoId } = this.options

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

    console.log(`[DocOrchestrator] Inserting ${pagesToInsert.length} pages...`)

    // Batch insert all pages
    if (pagesToInsert.length > 0) {
      const { error: pagesError } = await supabase
        .from('repo_doc_pages')
        .insert(pagesToInsert)

      if (pagesError) {
        console.error('[DocOrchestrator] Failed to insert pages:', pagesError)
        throw new Error(`Failed to store documentation: ${pagesError.message}`)
      }
    }

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
