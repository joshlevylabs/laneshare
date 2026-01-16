/**
 * Integrator Agent Runner
 *
 * Executes the Integrator Agent to semantically merge concurrent edits
 * from multiple Claude agents working on the same codebase.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  INTEGRATOR_SYSTEM_PROMPT,
  generateIntegratorPrompt,
  canAutoMerge,
  generateSimpleMergePrompt,
} from '@laneshare/shared/prompts'
import type {
  IntegratorInput,
  IntegratorOutput,
  FileConflictContext,
  EditStreamEntry,
  MergeStrategy,
  ConflictType,
  ResolutionStrategy,
} from '@laneshare/shared/types'

const anthropic = new Anthropic()

export interface IntegratorResult {
  success: boolean
  output?: IntegratorOutput
  error?: string
  durationMs: number
  tokensUsed?: {
    input: number
    output: number
  }
}

/**
 * Runs the Integrator Agent to merge conflicting edits
 */
export async function runIntegratorAgent(
  input: IntegratorInput,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
): Promise<IntegratorResult> {
  const startTime = Date.now()

  const {
    model = 'claude-sonnet-4-20250514',
    maxTokens = 8192,
    temperature = 0.3, // Lower temperature for more consistent merges
  } = options

  try {
    // Check if we can auto-merge without the agent
    if (canAutoMerge(input.conflicts)) {
      const autoMergeResult = await performAutoMerge(input.conflicts)
      return {
        success: true,
        output: autoMergeResult,
        durationMs: Date.now() - startTime,
      }
    }

    // Need the integrator agent for complex merges
    const prompt = generateIntegratorPrompt(input)

    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: INTEGRATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Extract the response content
    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from integrator agent')
    }

    // Parse the JSON response
    const jsonMatch = textContent.text.match(/```json\n?([\s\S]*?)\n?```/)
    const jsonStr = jsonMatch ? jsonMatch[1] : textContent.text

    const output: IntegratorOutput = JSON.parse(jsonStr)

    return {
      success: output.success,
      output,
      durationMs: Date.now() - startTime,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - startTime,
    }
  }
}

/**
 * Performs automatic merge for non-conflicting changes
 */
async function performAutoMerge(conflicts: FileConflictContext[]): Promise<IntegratorOutput> {
  const mergedFiles: IntegratorOutput['mergedFiles'] = []

  for (const conflict of conflicts) {
    if (conflict.edits.length === 0) continue

    if (conflict.edits.length === 1) {
      // Single edit, just take it
      mergedFiles.push({
        path: conflict.filePath,
        content: conflict.edits[0].edit.newContent || '',
        strategy: 'AUTO',
        reasoning: 'Single edit, applied directly',
      })
    } else {
      // Multiple non-overlapping edits - apply them sequentially
      let content = conflict.originalContent

      // Sort edits by line number (descending to avoid offset issues)
      const sortedEdits = [...conflict.edits].sort((a, b) => {
        const aLine = a.edit.diffHunks?.[0]?.startLine ?? 0
        const bLine = b.edit.diffHunks?.[0]?.startLine ?? 0
        return bLine - aLine
      })

      for (const edit of sortedEdits) {
        if (edit.edit.diffHunks) {
          content = applyDiffHunks(content, edit.edit.diffHunks)
        } else if (edit.edit.newContent) {
          // Fallback: use the newest content
          content = edit.edit.newContent
        }
      }

      mergedFiles.push({
        path: conflict.filePath,
        content,
        strategy: 'AUTO',
        reasoning: `Applied ${conflict.edits.length} non-overlapping edits sequentially`,
      })
    }
  }

  return {
    success: true,
    mergedFiles,
    conflicts: [],
    overallReasoning: 'Auto-merged non-overlapping changes',
  }
}

/**
 * Applies diff hunks to content
 */
function applyDiffHunks(
  content: string,
  hunks: Array<{ startLine: number; oldLines: string[]; newLines: string[] }>
): string {
  const lines = content.split('\n')

  // Sort hunks by line number descending to avoid offset issues
  const sortedHunks = [...hunks].sort((a, b) => b.startLine - a.startLine)

  for (const hunk of sortedHunks) {
    const { startLine, oldLines, newLines } = hunk
    // startLine is 1-indexed, array is 0-indexed
    const index = startLine - 1

    // Remove old lines and insert new ones
    lines.splice(index, oldLines.length, ...newLines)
  }

  return lines.join('\n')
}

/**
 * Detects potential conflicts between edits
 */
export function detectConflicts(edits: EditStreamEntry[]): Map<string, EditStreamEntry[]> {
  const fileEdits = new Map<string, EditStreamEntry[]>()

  for (const edit of edits) {
    const existing = fileEdits.get(edit.filePath) || []
    existing.push(edit)
    fileEdits.set(edit.filePath, existing)
  }

  // Filter to only files with multiple edits
  const conflicts = new Map<string, EditStreamEntry[]>()
  for (const [path, pathEdits] of Array.from(fileEdits.entries())) {
    if (pathEdits.length > 1) {
      conflicts.set(path, pathEdits)
    }
  }

  return conflicts
}

/**
 * Analyzes conflict type based on the edits
 */
export function analyzeConflictType(
  editA: EditStreamEntry,
  editB: EditStreamEntry
): ConflictType {
  // Delete vs modify
  if (editA.operation === 'delete' || editB.operation === 'delete') {
    if (editA.operation !== editB.operation) {
      return 'DELETE_MODIFY'
    }
  }

  // Rename conflicts
  if (editA.operation === 'rename' || editB.operation === 'rename') {
    return 'RENAME_CONFLICT'
  }

  // Check for overlapping line ranges
  if (editA.diffHunks && editB.diffHunks) {
    for (const hunkA of editA.diffHunks) {
      for (const hunkB of editB.diffHunks) {
        const rangeA = {
          start: hunkA.startLine,
          end: hunkA.startLine + Math.max(hunkA.oldLines.length, hunkA.newLines.length),
        }
        const rangeB = {
          start: hunkB.startLine,
          end: hunkB.startLine + Math.max(hunkB.oldLines.length, hunkB.newLines.length),
        }

        if (rangeA.start <= rangeB.end && rangeB.start <= rangeA.end) {
          // Check if it's the same line or same block
          if (rangeA.start === rangeB.start && rangeA.end === rangeB.end) {
            return 'SAME_LINE'
          }
          return 'SAME_BLOCK'
        }
      }
    }
  }

  // If we can't determine overlap, assume it might be logical
  return 'LOGICAL'
}

/**
 * Creates a merge prompt for a single file conflict
 */
export function createSingleFileMergePrompt(
  filePath: string,
  originalContent: string,
  editA: { content: string; reasoning?: string; agentName?: string },
  editB: { content: string; reasoning?: string; agentName?: string }
): string {
  return `Merge these two versions of ${filePath}:

## Original
\`\`\`
${originalContent}
\`\`\`

## Version A${editA.agentName ? ` (${editA.agentName})` : ''}
${editA.reasoning ? `Reasoning: ${editA.reasoning}` : ''}
\`\`\`
${editA.content}
\`\`\`

## Version B${editB.agentName ? ` (${editB.agentName})` : ''}
${editB.reasoning ? `Reasoning: ${editB.reasoning}` : ''}
\`\`\`
${editB.content}
\`\`\`

## Instructions
1. Understand what each version is trying to accomplish
2. Create a merged version that achieves BOTH goals
3. If necessary, refactor the code to accommodate both changes
4. Explain your merge decisions

Respond with JSON:
{
  "mergedContent": "...",
  "strategy": "MERGE_BOTH" | "REFACTOR" | "TAKE_A" | "TAKE_B",
  "reasoning": "..."
}
`
}

/**
 * Streams merge progress events
 */
export async function* streamMergeProgress(
  input: IntegratorInput
): AsyncGenerator<{
  type: 'analyzing' | 'merging' | 'validating' | 'complete' | 'error'
  file?: string
  progress?: number
  message?: string
  result?: IntegratorOutput
}> {
  yield { type: 'analyzing', message: 'Analyzing conflicts...', progress: 0 }

  const totalFiles = input.conflicts.length
  let processedFiles = 0

  for (const conflict of input.conflicts) {
    yield {
      type: 'merging',
      file: conflict.filePath,
      progress: (processedFiles / totalFiles) * 100,
      message: `Merging ${conflict.filePath}...`,
    }
    processedFiles++
  }

  yield { type: 'validating', message: 'Validating merged code...', progress: 90 }

  // Run the actual merge
  const result = await runIntegratorAgent(input)

  if (result.success && result.output) {
    yield {
      type: 'complete',
      progress: 100,
      message: 'Merge complete',
      result: result.output,
    }
  } else {
    yield {
      type: 'error',
      message: result.error || 'Merge failed',
    }
  }
}
