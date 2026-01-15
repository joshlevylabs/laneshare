/**
 * Claude Code Runner Interface
 *
 * This module provides the interface for running Claude Code to generate
 * repository documentation. It supports both real Claude API calls and
 * mock responses for local development.
 */

import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { spawn, execSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  ClaudeCodeDocOutput,
  RepoContext,
  RepoDocCategory,
} from '@laneshare/shared'
import {
  REPO_DOC_SYSTEM_PROMPT,
  buildRepoDocPrompt,
  buildRepoDocFollowUpPrompt,
  buildRepoDocContinuationPrompt,
} from '@laneshare/shared'

// ===========================================
// Zod Schemas for Claude Code Output Validation
// ===========================================

const DocEvidenceSchema = z.object({
  file_path: z.string().min(1),
  excerpt: z.string().max(1500), // Allow slightly more than 1200 for flexibility
  reason: z.string().min(1),
})

const RepoDocCategorySchema = z.enum(['ARCHITECTURE', 'API', 'FEATURE', 'RUNBOOK'])

const ClaudeCodeDocPageSchema = z.object({
  category: RepoDocCategorySchema,
  slug: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, 'Slug must be in format: category/page-name'),
  title: z.string().min(1).max(200),
  markdown: z.string().min(10),
  evidence: z.array(DocEvidenceSchema).default([]),
})

const ClaudeCodeDocTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: RepoDocCategorySchema.optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
})

const ClaudeCodeDocOutputSchema = z.object({
  repo_summary: z.object({
    name: z.string(),
    tech_stack: z.array(z.string()).default([]),
    entrypoints: z.array(z.string()).default([]),
  }),
  warnings: z.array(z.string()).default([]),
  needs_more_files: z.array(z.string()).optional(),
  pages: z.array(ClaudeCodeDocPageSchema).min(1),
  tasks: z.array(ClaudeCodeDocTaskSchema).optional(),
})

export type ValidatedClaudeOutput = z.infer<typeof ClaudeCodeDocOutputSchema>

// ===========================================
// Claude Code Runner Interface
// ===========================================

export interface ClaudeRunnerOptions {
  apiKey?: string
  model?: string
  maxTokens?: number
  useMock?: boolean
  useCLI?: boolean // Use Claude Code CLI instead of direct API calls
  maxContinuations?: number // Max number of continuation attempts for truncated responses (default: 3)
  onProgress?: (progress: ClaudeRunnerProgress) => void // Progress callback for UI updates
}

export interface ClaudeRunnerProgress {
  stage: 'starting' | 'calling_api' | 'streaming' | 'parsing' | 'continuation' | 'complete' | 'error'
  message: string
  pagesGenerated?: number
  continuationAttempt?: number
  maxContinuations?: number
  // Time estimation fields
  estimatedTotalSeconds?: number
  elapsedSeconds?: number
  // Streaming progress
  tokensGenerated?: number
  streamingPages?: string[] // Page titles found so far during streaming
}

export interface ClaudeRunnerResult {
  success: boolean
  output?: ValidatedClaudeOutput
  rawOutput?: string
  error?: string
  needsMoreFiles?: string[]
}

/**
 * Abstract interface for Claude Code execution
 */
export interface IClaudeRunner {
  run(context: RepoContext, previousOutput?: Partial<ClaudeCodeDocOutput>): Promise<ClaudeRunnerResult>
}

/**
 * Real Claude Code runner using Anthropic API
 * Supports automatic continuation when responses are truncated
 */
export class ClaudeRunner implements IClaudeRunner {
  private client: Anthropic
  private model: string
  private maxTokens: number
  private maxContinuations: number
  private onProgress?: (progress: ClaudeRunnerProgress) => void

  constructor(options: ClaudeRunnerOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
      timeout: 5 * 60 * 1000, // 5 minute timeout - increased for larger prompts with verification
    })
    this.model = options.model || 'claude-sonnet-4-20250514'
    // Higher max_tokens = fewer continuation calls = faster total time
    // 16000 tokens is optimal: enough for most docs in one call, but not so large it's slow
    this.maxTokens = options.maxTokens || 16000
    // Reduced continuations since we have higher token limit
    this.maxContinuations = options.maxContinuations ?? 2
    this.onProgress = options.onProgress

    console.log(`[ClaudeRunner] Initialized with model: ${this.model}, maxTokens: ${this.maxTokens}`)
  }

  private async reportProgress(progress: ClaudeRunnerProgress): Promise<void> {
    console.log(`[ClaudeRunner] Progress: ${progress.stage} - ${progress.message}`)
    if (this.onProgress) {
      try {
        await this.onProgress(progress)
      } catch (err) {
        console.error('[ClaudeRunner] Error in progress callback:', err)
      }
    }
  }

  async run(context: RepoContext, previousOutput?: Partial<ClaudeCodeDocOutput>): Promise<ClaudeRunnerResult> {
    // Track accumulated pages across continuations
    let accumulatedPages: ValidatedClaudeOutput['pages'] = []
    let accumulatedWarnings: string[] = []
    let accumulatedTasks: ValidatedClaudeOutput['tasks'] = []
    let repoSummary: ValidatedClaudeOutput['repo_summary'] | undefined
    let needsMoreFiles: string[] | undefined
    let continuationAttempt = 0

    await this.reportProgress({
      stage: 'starting',
      message: `Starting documentation generation for ${context.repo_owner}/${context.repo_name}`,
      pagesGenerated: 0,
    })

    try {
      // Build the initial prompt
      let prompt = previousOutput?.needs_more_files
        ? buildRepoDocFollowUpPrompt(context, {
            warnings: previousOutput.warnings || [],
            needs_more_files: previousOutput.needs_more_files,
          })
        : buildRepoDocPrompt(context)

      // Main loop: initial call + continuations
      while (continuationAttempt <= this.maxContinuations) {
        console.log(`[ClaudeRunner] Calling Claude API for ${context.repo_owner}/${context.repo_name} (round ${context.round}, continuation ${continuationAttempt})`)
        console.log(`[ClaudeRunner] Prompt length: ${prompt.length} chars, System prompt length: ${REPO_DOC_SYSTEM_PROMPT.length} chars`)

        // Estimate time based on prompt size and model
        // Rough estimate: ~1 second per 500 chars of prompt for Sonnet, plus output generation
        const estimatedSeconds = Math.round((prompt.length + REPO_DOC_SYSTEM_PROMPT.length) / 500) + 60
        console.log(`[ClaudeRunner] Estimated time: ~${estimatedSeconds}s`)

        // Report initial progress with time estimate
        await this.reportProgress({
          stage: continuationAttempt === 0 ? 'calling_api' : 'continuation',
          message: continuationAttempt === 0
            ? `Connecting to Claude... (est. ${Math.round(estimatedSeconds / 60)}m)`
            : `Continuation ${continuationAttempt}/${this.maxContinuations}`,
          pagesGenerated: accumulatedPages.length,
          continuationAttempt,
          maxContinuations: this.maxContinuations,
          estimatedTotalSeconds: estimatedSeconds,
          elapsedSeconds: 0,
        })

        let rawOutput = ''
        let stopReason: string | null = null
        let streamingPages: string[] = []

        try {
          const startTime = Date.now()
          const TIMEOUT_MS = 300000 // 5 minute timeout

          // Use streaming API for real-time progress updates
          const stream = this.client.messages.stream({
            model: this.model,
            max_tokens: this.maxTokens,
            system: REPO_DOC_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          })

          // Set up timeout
          const timeoutId = setTimeout(() => {
            console.log(`[ClaudeRunner] Request timed out after ${TIMEOUT_MS/1000}s, aborting...`)
            stream.abort()
          }, TIMEOUT_MS)

          let lastProgressUpdate = Date.now()
          let tokensGenerated = 0

          // Process stream events
          stream.on('text', (text) => {
            rawOutput += text
            tokensGenerated += text.split(/\s+/).length // Rough token estimate

            // Try to extract page titles from streaming content
            const titleMatches = rawOutput.match(/"title"\s*:\s*"([^"]+)"/g)
            if (titleMatches) {
              streamingPages = titleMatches
                .map(m => m.match(/"title"\s*:\s*"([^"]+)"/)?.[1])
                .filter((t): t is string => !!t)
            }

            // Update progress every 5 seconds during streaming
            const now = Date.now()
            if (now - lastProgressUpdate > 5000) {
              lastProgressUpdate = now
              const elapsed = Math.round((now - startTime) / 1000)
              const pagesFound = streamingPages.length
              const totalPages = accumulatedPages.length + pagesFound

              this.reportProgress({
                stage: 'streaming',
                message: `Generating documentation... Found ${totalPages} pages`,
                pagesGenerated: totalPages,
                continuationAttempt,
                maxContinuations: this.maxContinuations,
                estimatedTotalSeconds: estimatedSeconds,
                elapsedSeconds: elapsed,
                tokensGenerated,
                streamingPages: streamingPages.slice(-5), // Last 5 page titles
              }).catch(err => console.error('[ClaudeRunner] Progress error:', err))

              console.log(`[ClaudeRunner] Streaming... ${elapsed}s elapsed, ${rawOutput.length} chars, ${pagesFound} pages found`)
            }
          })

          // Wait for stream to complete
          const finalMessage = await stream.finalMessage()
          clearTimeout(timeoutId)

          stopReason = finalMessage.stop_reason

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.log(`[ClaudeRunner] Streaming completed in ${elapsed}s`)
        } catch (apiError) {
          console.error('[ClaudeRunner] API call failed:', apiError)
          const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown API error'
          await this.reportProgress({
            stage: 'error',
            message: `API Error: ${errorMessage}`,
            pagesGenerated: accumulatedPages.length,
          })
          return {
            success: false,
            error: `Claude API error: ${errorMessage}`,
          }
        }

        console.log(`[ClaudeRunner] Response received. Length: ${rawOutput?.length || 0} chars, stop_reason: ${stopReason}`)

        if (!rawOutput || rawOutput.length === 0) {
          return {
            success: false,
            error: 'Empty response from Claude API',
          }
        }

        // Check if response was truncated
        const wasTruncated = stopReason === 'max_tokens'
        if (wasTruncated) {
          console.warn('[ClaudeRunner] Response was truncated (max_tokens). Attempting to extract partial data...')
        }

        // Try to parse the response (may be truncated)
        await this.reportProgress({
          stage: 'parsing',
          message: wasTruncated ? 'Extracting partial data from truncated response' : 'Parsing response',
          pagesGenerated: accumulatedPages.length,
        })

        const parseResult = wasTruncated
          ? this.extractPartialPages(rawOutput)
          : this.parseAndValidate(rawOutput)

        // Accumulate results
        if (parseResult.output) {
          // Store repo summary from first successful parse
          if (!repoSummary && parseResult.output.repo_summary) {
            repoSummary = parseResult.output.repo_summary
          }

          // Add new pages (avoid duplicates by slug)
          const existingSlugs = new Set(accumulatedPages.map(p => p.slug))
          for (const page of parseResult.output.pages) {
            if (!existingSlugs.has(page.slug)) {
              accumulatedPages.push(page)
              existingSlugs.add(page.slug)
            }
          }

          // Accumulate warnings and tasks
          accumulatedWarnings.push(...(parseResult.output.warnings || []))
          if (parseResult.output.tasks) {
            accumulatedTasks.push(...parseResult.output.tasks)
          }
          needsMoreFiles = parseResult.output.needs_more_files
        }

        console.log(`[ClaudeRunner] Accumulated ${accumulatedPages.length} pages so far`)

        // If not truncated, we're done
        if (!wasTruncated) {
          break
        }

        // If we still have continuation attempts, build continuation prompt
        continuationAttempt++
        if (continuationAttempt <= this.maxContinuations) {
          console.log(`[ClaudeRunner] Building continuation prompt (attempt ${continuationAttempt})`)

          // Build continuation prompt with list of completed pages
          const completedPages = accumulatedPages.map(p => ({
            category: p.category,
            slug: p.slug,
            title: p.title,
          }))

          prompt = buildRepoDocContinuationPrompt(context, completedPages)
        }
      }

      // Build final output from accumulated data
      if (accumulatedPages.length === 0) {
        return {
          success: false,
          error: 'Failed to extract any documentation pages',
        }
      }

      // Deduplicate warnings
      const uniqueWarnings = [...new Set(accumulatedWarnings)]

      const finalOutput: ValidatedClaudeOutput = {
        repo_summary: repoSummary || {
          name: context.repo_name,
          tech_stack: [],
          entrypoints: [],
        },
        warnings: uniqueWarnings,
        needs_more_files: needsMoreFiles,
        pages: accumulatedPages,
        tasks: accumulatedTasks.length > 0 ? accumulatedTasks : undefined,
      }

      await this.reportProgress({
        stage: 'complete',
        message: `Documentation generation complete: ${accumulatedPages.length} pages`,
        pagesGenerated: accumulatedPages.length,
      })

      return {
        success: true,
        output: finalOutput,
        rawOutput: JSON.stringify(finalOutput, null, 2),
        needsMoreFiles,
      }
    } catch (error) {
      console.error('[ClaudeRunner] Error:', error)
      await this.reportProgress({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        pagesGenerated: accumulatedPages.length,
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error calling Claude API',
      }
    }
  }

  /**
   * Extract partial valid pages from a truncated JSON response
   * This attempts to salvage any complete page objects from an incomplete response
   */
  private extractPartialPages(rawOutput: string): ClaudeRunnerResult {
    console.log('[ClaudeRunner] Attempting to extract partial pages from truncated response')

    try {
      // Strip markdown code blocks if present
      let jsonStr = rawOutput.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }

      // Try to find complete page objects using regex
      const pages: ValidatedClaudeOutput['pages'] = []
      const warnings: string[] = []
      let repoSummary: ValidatedClaudeOutput['repo_summary'] | undefined

      // Try to extract repo_summary
      const summaryMatch = jsonStr.match(/"repo_summary"\s*:\s*(\{[^}]+\})/s)
      if (summaryMatch) {
        try {
          const summary = JSON.parse(summaryMatch[1])
          repoSummary = {
            name: summary.name || 'unknown',
            tech_stack: Array.isArray(summary.tech_stack) ? summary.tech_stack : [],
            entrypoints: Array.isArray(summary.entrypoints) ? summary.entrypoints : [],
          }
        } catch {
          console.log('[ClaudeRunner] Could not parse repo_summary')
        }
      }

      // Try to extract warnings array
      const warningsMatch = jsonStr.match(/"warnings"\s*:\s*\[((?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*)\]/s)
      if (warningsMatch) {
        try {
          const parsedWarnings = JSON.parse(`[${warningsMatch[1]}]`)
          if (Array.isArray(parsedWarnings)) {
            warnings.push(...parsedWarnings.filter((w): w is string => typeof w === 'string'))
          }
        } catch {
          console.log('[ClaudeRunner] Could not parse warnings array')
        }
      }

      // Find all complete page objects
      // Match pattern: {"category": ..., "slug": ..., "title": ..., "markdown": ..., "evidence": [...]}
      const pageRegex = /\{\s*"category"\s*:\s*"([^"]+)"\s*,\s*"slug"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"markdown"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"evidence"\s*:\s*(\[[^\]]*\])\s*\}/gs

      let match
      while ((match = pageRegex.exec(jsonStr)) !== null) {
        try {
          const [, category, slug, title, markdownEscaped, evidenceStr] = match

          // Parse the escaped markdown
          const markdown = JSON.parse(`"${markdownEscaped}"`)

          // Parse evidence array
          let evidence: Array<{ file_path: string; excerpt: string; reason: string }> = []
          try {
            evidence = JSON.parse(evidenceStr)
          } catch {
            evidence = []
          }

          // Validate category
          if (['ARCHITECTURE', 'API', 'FEATURE', 'RUNBOOK'].includes(category)) {
            pages.push({
              category: category as 'ARCHITECTURE' | 'API' | 'FEATURE' | 'RUNBOOK',
              slug,
              title,
              markdown,
              evidence,
            })
            console.log(`[ClaudeRunner] Extracted page: ${slug}`)
          }
        } catch (e) {
          console.log('[ClaudeRunner] Failed to parse page match:', e)
        }
      }

      // If regex didn't work well, try a simpler approach: split by pages array
      if (pages.length === 0) {
        console.log('[ClaudeRunner] Regex approach failed, trying JSON repair')

        // Try to repair the JSON by closing brackets
        let repairedJson = jsonStr

        // Count open brackets and close them
        const openBraces = (jsonStr.match(/\{/g) || []).length
        const closeBraces = (jsonStr.match(/\}/g) || []).length
        const openBrackets = (jsonStr.match(/\[/g) || []).length
        const closeBrackets = (jsonStr.match(/\]/g) || []).length

        // Add missing closing brackets
        repairedJson += ']'.repeat(Math.max(0, openBrackets - closeBrackets))
        repairedJson += '}'.repeat(Math.max(0, openBraces - closeBraces))

        try {
          const parsed = JSON.parse(repairedJson)
          if (parsed.pages && Array.isArray(parsed.pages)) {
            for (const page of parsed.pages) {
              try {
                const validatedPage = ClaudeCodeDocPageSchema.parse(page)
                pages.push(validatedPage)
              } catch {
                // Skip invalid pages
              }
            }
          }
          if (parsed.repo_summary) {
            repoSummary = parsed.repo_summary
          }
        } catch {
          console.log('[ClaudeRunner] JSON repair also failed')
        }
      }

      console.log(`[ClaudeRunner] Extracted ${pages.length} complete pages from truncated response`)

      if (pages.length === 0) {
        return {
          success: false,
          error: 'Could not extract any valid pages from truncated response',
          rawOutput,
        }
      }

      warnings.push('[Partial] Some documentation may be incomplete due to response truncation')

      return {
        success: true,
        output: {
          repo_summary: repoSummary || { name: 'unknown', tech_stack: [], entrypoints: [] },
          warnings,
          pages,
        },
        rawOutput,
      }
    } catch (error) {
      console.error('[ClaudeRunner] Error extracting partial pages:', error)
      return {
        success: false,
        error: 'Failed to extract partial pages from truncated response',
        rawOutput,
      }
    }
  }

  private parseAndValidate(rawOutput: string): ClaudeRunnerResult {
    try {
      // Try to extract JSON from the response (in case there's any wrapper text)
      let jsonStr = rawOutput.trim()

      // Handle potential markdown code blocks
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3)
      }
      jsonStr = jsonStr.trim()

      // Parse JSON
      const parsed = JSON.parse(jsonStr)

      // Validate with Zod
      const validated = ClaudeCodeDocOutputSchema.parse(parsed)

      return {
        success: true,
        output: validated,
        rawOutput,
        needsMoreFiles: validated.needs_more_files,
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: `Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          rawOutput,
        }
      }
      if (error instanceof SyntaxError) {
        // Log the raw output for debugging JSON issues
        console.error('[ClaudeRunner] JSON parse error. Raw output length:', rawOutput?.length || 0)
        console.error('[ClaudeRunner] Raw output (first 500 chars):', rawOutput?.slice(0, 500))
        console.error('[ClaudeRunner] Raw output (last 500 chars):', rawOutput?.slice(-500))
        return {
          success: false,
          error: `JSON parse error: ${error.message}`,
          rawOutput,
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
        rawOutput,
      }
    }
  }
}

/**
 * Claude Code CLI runner - uses the local Claude Code CLI subscription
 * This runner spawns the `claude` CLI as a subprocess instead of calling the API directly
 *
 * NOTE: This requires the Claude Code CLI to be installed globally and authenticated.
 * Install with: npm install -g @anthropic-ai/claude-code
 * Authenticate with: claude login
 */
export class ClaudeCodeCLIRunner implements IClaudeRunner {
  private model: string
  private claudePath: string | null = null

  constructor(options: ClaudeRunnerOptions = {}) {
    this.model = options.model || 'claude-sonnet-4-20250514'
  }

  /**
   * Find the path to the claude executable
   * On Windows, npm global installs go to %APPDATA%\npm
   */
  private findClaudePath(): string {
    if (this.claudePath) return this.claudePath

    const isWindows = process.platform === 'win32'
    const possiblePaths: string[] = []

    if (isWindows) {
      // Windows npm global bin locations
      const appData = process.env.APPDATA || ''
      const localAppData = process.env.LOCALAPPDATA || ''
      const userProfile = process.env.USERPROFILE || ''

      possiblePaths.push(
        join(appData, 'npm', 'claude.cmd'),
        join(appData, 'npm', 'claude'),
        join(localAppData, 'npm', 'claude.cmd'),
        join(localAppData, 'npm', 'claude'),
        join(userProfile, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        join(userProfile, '.npm-global', 'claude.cmd'),
        'claude.cmd', // Try PATH
        'claude',     // Try PATH
      )
    } else {
      // Unix-like systems
      possiblePaths.push(
        '/usr/local/bin/claude',
        '/usr/bin/claude',
        join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
        join(process.env.HOME || '', 'node_modules', '.bin', 'claude'),
        'claude', // Try PATH
      )
    }

    // Try each path
    for (const p of possiblePaths) {
      try {
        const result = execSync(`"${p}" --version`, {
          stdio: 'pipe',
          timeout: 5000,
          shell: isWindows ? 'cmd.exe' : '/bin/sh',
          encoding: 'utf-8',
        })
        console.log(`[ClaudeCodeCLI] Found claude at: ${p}`)
        console.log(`[ClaudeCodeCLI] Version: ${result.trim()}`)
        this.claudePath = p
        return p
      } catch {
        // Try next path
      }
    }

    throw new Error(
      'Claude CLI not found. Please ensure it is installed:\n' +
      '1. Run: npm install -g @anthropic-ai/claude-code\n' +
      '2. Run: claude login\n' +
      '3. Verify with: claude --version'
    )
  }

  async run(context: RepoContext, previousOutput?: Partial<ClaudeCodeDocOutput>): Promise<ClaudeRunnerResult> {
    let claudePath: string

    try {
      claudePath = this.findClaudePath()
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Claude CLI not found',
      }
    }

    try {
      // Build the appropriate prompt
      const prompt = previousOutput?.needs_more_files
        ? buildRepoDocFollowUpPrompt(context, {
            warnings: previousOutput.warnings || [],
            needs_more_files: previousOutput.needs_more_files,
          })
        : buildRepoDocPrompt(context)

      console.log(`[ClaudeCodeCLI] Running Claude CLI for ${context.repo_owner}/${context.repo_name} (round ${context.round})`)

      // Combine system prompt and user prompt for CLI
      const fullPrompt = `${REPO_DOC_SYSTEM_PROMPT}\n\n---\n\n${prompt}`

      // Run the Claude CLI
      const rawOutput = await this.runClaudeCLI(claudePath, fullPrompt)

      // Parse and validate JSON
      return this.parseAndValidate(rawOutput)
    } catch (error) {
      console.error('[ClaudeCodeCLI] Error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error running Claude CLI',
      }
    }
  }

  private async runClaudeCLI(claudePath: string, prompt: string): Promise<string> {
    // Write prompt to a temp file to handle large prompts
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-doc-'))
    const promptFile = join(tempDir, 'prompt.txt')

    try {
      writeFileSync(promptFile, prompt, 'utf-8')
      console.log(`[ClaudeCodeCLI] Wrote prompt to ${promptFile} (${prompt.length} chars)`)

      return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32'

        // Build the command to read from file and pipe to claude
        // Using shell command: type prompt.txt | claude -p (Windows)
        // Or: cat prompt.txt | claude -p (Unix)
        const shellCommand = isWindows
          ? `type "${promptFile}" | "${claudePath}" -p --output-format text`
          : `cat "${promptFile}" | "${claudePath}" -p --output-format text`

        console.log(`[ClaudeCodeCLI] Running: ${shellCommand.substring(0, 100)}...`)

        const claudeProcess = spawn(shellCommand, [], {
          stdio: ['inherit', 'pipe', 'pipe'],
          shell: true,
          env: {
            ...process.env,
            // Ensure npm global bin is in PATH
            PATH: this.getEnhancedPath(),
          },
          // Increase timeout for large prompts
          timeout: 300000, // 5 minutes
        })

        let stdout = ''
        let stderr = ''

        claudeProcess.stdout?.on('data', (data) => {
          const chunk = data.toString()
          stdout += chunk
          // Log progress for long-running operations
          if (stdout.length % 5000 < 100) {
            console.log(`[ClaudeCodeCLI] Received ${stdout.length} chars so far...`)
          }
        })

        claudeProcess.stderr?.on('data', (data) => {
          const chunk = data.toString()
          stderr += chunk
          // Log stderr for debugging
          console.log('[ClaudeCodeCLI] stderr:', chunk)
        })

        claudeProcess.on('error', (error) => {
          this.cleanup(tempDir, promptFile)
          reject(new Error(`Failed to start Claude CLI: ${error.message}`))
        })

        claudeProcess.on('close', (code) => {
          this.cleanup(tempDir, promptFile)

          if (code === 0) {
            console.log(`[ClaudeCodeCLI] Success! Received ${stdout.length} chars`)
            resolve(stdout)
          } else {
            console.error('[ClaudeCodeCLI] Failed with code:', code)
            console.error('[ClaudeCodeCLI] stderr:', stderr)
            console.error('[ClaudeCodeCLI] stdout (first 1000 chars):', stdout.slice(0, 1000))

            // Parse error message
            let errorMsg = this.parseErrorMessage(stderr, stdout, code)
            reject(new Error(errorMsg))
          }
        })
      })
    } catch (error) {
      this.cleanup(tempDir, promptFile)
      throw error
    }
  }

  private getEnhancedPath(): string {
    const currentPath = process.env.PATH || ''
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      const appData = process.env.APPDATA || ''
      const npmPath = join(appData, 'npm')
      return `${npmPath};${currentPath}`
    }

    const home = process.env.HOME || ''
    const npmGlobal = join(home, '.npm-global', 'bin')
    return `${npmGlobal}:${currentPath}`
  }

  private parseErrorMessage(stderr: string, stdout: string, code: number | null): string {
    const output = stderr || stdout || ''

    if (output.includes('not authenticated') || output.includes('login') || output.includes('unauthorized')) {
      return 'Claude CLI not authenticated. Please run "claude login" in your terminal first.'
    }

    if (output.includes('rate limit') || output.includes('too many requests')) {
      return 'Rate limit exceeded. Please wait a moment and try again.'
    }

    if (output.includes('subscription') || output.includes('billing')) {
      return 'Subscription issue. Please verify your Claude Code subscription is active.'
    }

    if (code === 127) {
      return 'Claude CLI not found in PATH. Please ensure it is installed correctly.'
    }

    if (output.length > 0) {
      return `Claude CLI error (code ${code}): ${output.substring(0, 500)}`
    }

    return `Claude CLI exited with code ${code}. Check the server console for details.`
  }

  private cleanup(tempDir: string, promptFile: string): void {
    try {
      unlinkSync(promptFile)
      // Try to remove the temp directory
      try {
        const { rmdirSync } = require('fs')
        rmdirSync(tempDir)
      } catch {
        // Ignore - OS will clean up temp dirs
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private parseAndValidate(rawOutput: string): ClaudeRunnerResult {
    try {
      // Try to extract JSON from the response (in case there's any wrapper text)
      let jsonStr = rawOutput.trim()

      // Handle potential markdown code blocks
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7)
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3)
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3)
      }
      jsonStr = jsonStr.trim()

      // Try to find JSON object in the response if it's embedded in other text
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }

      // Parse JSON
      const parsed = JSON.parse(jsonStr)

      // Validate with Zod
      const validated = ClaudeCodeDocOutputSchema.parse(parsed)

      return {
        success: true,
        output: validated,
        rawOutput,
        needsMoreFiles: validated.needs_more_files,
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: `Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          rawOutput,
        }
      }
      if (error instanceof SyntaxError) {
        return {
          success: false,
          error: `JSON parse error: ${error.message}. The CLI output may not be valid JSON.`,
          rawOutput,
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
        rawOutput,
      }
    }
  }
}

/**
 * Mock Claude Code runner for local development and testing
 */
export class MockClaudeRunner implements IClaudeRunner {
  private fixtures: Map<string, ClaudeCodeDocOutput>

  constructor() {
    this.fixtures = new Map()
    // Add default mock response
    this.fixtures.set('default', this.generateMockOutput())
  }

  /**
   * Add a fixture for a specific repo
   */
  addFixture(repoKey: string, output: ClaudeCodeDocOutput): void {
    this.fixtures.set(repoKey, output)
  }

  async run(context: RepoContext): Promise<ClaudeRunnerResult> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000))

    const repoKey = `${context.repo_owner}/${context.repo_name}`
    const fixture = this.fixtures.get(repoKey) || this.fixtures.get('default')!

    // Customize fixture with actual repo info
    const output: ClaudeCodeDocOutput = {
      ...fixture,
      repo_summary: {
        ...fixture.repo_summary,
        name: context.repo_name,
      },
    }

    return {
      success: true,
      output: output as ValidatedClaudeOutput,
      rawOutput: JSON.stringify(output, null, 2),
    }
  }

  private generateMockOutput(): ClaudeCodeDocOutput {
    return {
      repo_summary: {
        name: 'mock-repo',
        tech_stack: ['TypeScript', 'React', 'Next.js', 'PostgreSQL'],
        entrypoints: ['src/index.ts', 'src/app/page.tsx'],
      },
      warnings: [
        'Some API endpoints may not be fully documented due to limited context.',
      ],
      pages: [
        {
          category: 'ARCHITECTURE',
          slug: 'architecture/overview',
          title: 'Architecture Overview',
          markdown: `# Architecture Overview

This repository follows a modern web application architecture using Next.js App Router.

## Key Components

- **Frontend**: React with Next.js App Router
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL with Supabase

## Data Flow

1. Client requests are handled by Next.js
2. API routes process business logic
3. Database queries via Supabase client

**[Needs Review]** - Additional architecture details may be available in other files.`,
          evidence: [
            {
              file_path: 'package.json',
              excerpt: '{ "name": "app", "dependencies": { "next": "^14.0.0" } }',
              reason: 'Shows Next.js as primary framework',
            },
          ],
        },
        {
          category: 'ARCHITECTURE',
          slug: 'architecture/tech-stack',
          title: 'Technology Stack',
          markdown: `# Technology Stack

## Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## Backend
- **Runtime**: Node.js
- **API**: Next.js API Routes

## Database
- **Provider**: Supabase (PostgreSQL)
- **ORM**: Supabase Client

## Infrastructure
- **Hosting**: Vercel
- **CI/CD**: GitHub Actions`,
          evidence: [
            {
              file_path: 'package.json',
              excerpt: '"typescript": "^5.0.0", "tailwindcss": "^3.0.0"',
              reason: 'Shows TypeScript and Tailwind CSS dependencies',
            },
          ],
        },
        {
          category: 'API',
          slug: 'api/overview',
          title: 'API Overview',
          markdown: `# API Overview

The API follows RESTful conventions using Next.js API Routes.

## Base URL
\`/api\`

## Authentication
JWT-based authentication via Supabase Auth.

## Response Format
All responses are JSON formatted.

**[Needs Review]** - Full API documentation requires additional endpoint analysis.`,
          evidence: [],
        },
        {
          category: 'FEATURE',
          slug: 'features/index',
          title: 'Features Index',
          markdown: `# Features

## Major Features

1. **User Authentication** - Login, registration, password reset
2. **Repository Management** - Connect and sync GitHub repositories
3. **Documentation** - Auto-generated documentation from code

**[Needs Review]** - Feature list may be incomplete.`,
          evidence: [],
        },
        {
          category: 'RUNBOOK',
          slug: 'runbook/local-dev',
          title: 'Local Development Setup',
          markdown: `# Local Development Setup

## Prerequisites
- Node.js 18+
- pnpm 8+

## Setup Steps

\`\`\`bash
# Clone repository
git clone <repo-url>

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local

# Start development server
pnpm dev
\`\`\`

## Environment Variables
See \`.env.example\` for required variables.`,
          evidence: [
            {
              file_path: 'package.json',
              excerpt: '"scripts": { "dev": "next dev" }',
              reason: 'Shows development script',
            },
          ],
        },
      ],
      tasks: [
        {
          title: 'Document authentication flow in detail',
          description: 'Create detailed API documentation for auth endpoints',
          category: 'API',
          priority: 'medium',
        },
        {
          title: 'Add database schema documentation',
          description: 'Document all database tables and relationships',
          category: 'ARCHITECTURE',
          priority: 'high',
        },
      ],
    }
  }
}

/**
 * Factory function to create the appropriate runner
 *
 * Priority:
 * 1. If useMock is true or USE_MOCK_CLAUDE env var is set, use mock runner
 * 2. If useCLI is true or USE_CLAUDE_CLI env var is set, use CLI runner (Claude Code subscription)
 *    - This takes priority over API key when explicitly set, because user is explicitly requesting CLI
 * 3. If ANTHROPIC_API_KEY is set, use direct API runner
 * 4. Default to mock runner if nothing else is configured
 */
export function createClaudeRunner(options: ClaudeRunnerOptions = {}): IClaudeRunner {
  // Mock runner for development/testing
  if (options.useMock || process.env.USE_MOCK_CLAUDE === 'true') {
    console.log('[ClaudeRunner] Using mock runner')
    return new MockClaudeRunner()
  }

  // CLI runner takes priority when explicitly requested (user has Claude Code subscription)
  if (options.useCLI || process.env.USE_CLAUDE_CLI === 'true') {
    console.log('[ClaudeRunner] Using Claude Code CLI runner (subscription)')
    console.log('[ClaudeRunner] NOTE: CLI runner requires "claude" command to be available in the server PATH.')
    console.log('[ClaudeRunner] If this fails, set ANTHROPIC_API_KEY instead or USE_MOCK_CLAUDE=true')
    return new ClaudeCodeCLIRunner(options)
  }

  // Fall back to API runner if API key is available
  if (process.env.ANTHROPIC_API_KEY || options.apiKey) {
    console.log('[ClaudeRunner] Using Anthropic API runner')
    return new ClaudeRunner(options)
  }

  // Default to mock if nothing is configured
  console.log('[ClaudeRunner] No API key or CLI configured. Using mock runner.')
  console.log('[ClaudeRunner] To generate real docs, set ANTHROPIC_API_KEY in .env.local or USE_CLAUDE_CLI=true')
  return new MockClaudeRunner()
}

/**
 * Normalize a slug to ensure consistent format
 */
export function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9/-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Extract category from slug
 */
export function getCategoryFromSlug(slug: string): RepoDocCategory | null {
  const category = slug.split('/')[0]?.toUpperCase()
  if (['ARCHITECTURE', 'API', 'FEATURE', 'RUNBOOK'].includes(category)) {
    return category as RepoDocCategory
  }
  return null
}

// Export schemas for use in tests
export {
  ClaudeCodeDocOutputSchema,
  ClaudeCodeDocPageSchema,
  DocEvidenceSchema,
  RepoDocCategorySchema,
}
