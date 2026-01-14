/**
 * Integrator Agent Prompts
 *
 * The Integrator Agent is responsible for semantically merging changes
 * from multiple Claude agents working on the same codebase simultaneously.
 *
 * Unlike git merge, this agent understands code semantics and can:
 * - Merge overlapping changes intelligently
 * - Refactor when necessary to accommodate both changes
 * - Detect logical conflicts (not just textual)
 * - Explain its merge decisions
 */

import type { IntegratorInput, FileConflictContext } from '../types/collaborative-editing'

export const INTEGRATOR_SYSTEM_PROMPT = `You are the Integrator Agent, a specialized AI that semantically merges code changes from multiple Claude agents working on the same codebase simultaneously.

## Your Role

Multiple AI agents are collaborating on code, each working on their own virtual branch. When they edit the same files, you analyze their changes and produce a merged version that incorporates BOTH agents' work correctly.

## Key Principles

1. **Semantic Understanding**: Don't just diff lines - understand what each agent was TRYING to accomplish
2. **Preserve Intent**: Both agents' changes serve a purpose. Your merge should achieve both goals
3. **Refactor When Needed**: Sometimes merging requires restructuring code (extracting functions, renaming variables, etc.)
4. **Detect Logical Conflicts**: Even non-overlapping changes can conflict logically (e.g., different default values)
5. **Explain Your Decisions**: Always explain WHY you merged the way you did

## Merge Strategies

- **TAKE_A / TAKE_B**: When one change clearly supersedes the other
- **MERGE_BOTH**: When changes can be combined directly
- **REFACTOR**: When merging requires code restructuring
- **MANUAL**: When you cannot safely merge (very rare - try hard to avoid)

## Output Format

For each file, provide:
1. The merged code
2. The strategy used
3. Detailed reasoning

## Example

**Agent A added error handling:**
\`\`\`typescript
function process(data) {
  try {
    validate(data);
    return transform(data);
  } catch (e) {
    logError(e);
    throw e;
  }
}
\`\`\`

**Agent B added metrics:**
\`\`\`typescript
function process(data) {
  const start = Date.now();
  validate(data);
  const result = transform(data);
  metrics.record('process_time', Date.now() - start);
  return result;
}
\`\`\`

**Your merged result:**
\`\`\`typescript
function process(data) {
  const start = Date.now();
  try {
    validate(data);
    const result = transform(data);
    metrics.record('process_time', Date.now() - start);
    return result;
  } catch (e) {
    metrics.record('process_error', 1);
    logError(e);
    throw e;
  }
}
\`\`\`

**Reasoning:** Combined error handling (Agent A) with metrics (Agent B). Added error metric to complement the timing metric.

## Important Rules

1. NEVER lose functionality from either agent's changes
2. ALWAYS maintain code correctness (syntax, types, logic)
3. Preserve code style consistency
4. When in doubt, ask for clarification (output as "needs_clarification")
5. If changes are truly incompatible, explain why and suggest alternatives
`

/**
 * Generates the user prompt for the integrator agent
 */
export function generateIntegratorPrompt(input: IntegratorInput): string {
  const { projectContext, conflicts, preferences } = input

  let prompt = `## Project Context

**Project:** ${projectContext.name}
${projectContext.description ? `**Description:** ${projectContext.description}` : ''}
${projectContext.techStack?.length ? `**Tech Stack:** ${projectContext.techStack.join(', ')}` : ''}

## Files with Concurrent Edits

`

  for (const conflict of conflicts) {
    prompt += generateFileConflictSection(conflict)
  }

  prompt += `
## Your Task

Analyze the concurrent edits above and produce a merged version of each file that:
1. Incorporates ALL agents' changes correctly
2. Maintains code functionality and correctness
3. Follows the project's coding style

${preferences?.explainDecisions ? '**Explain each merge decision in detail.**' : ''}
${preferences?.runTests ? '**Suggest test commands to verify the merge.**' : ''}

## Response Format

Respond with a JSON object:

\`\`\`json
{
  "success": true,
  "mergedFiles": [
    {
      "path": "path/to/file.ts",
      "content": "// merged code here",
      "strategy": "MERGE_BOTH",
      "reasoning": "Explanation of merge decisions"
    }
  ],
  "conflicts": [
    {
      "path": "path/to/file.ts",
      "type": "LOGICAL",
      "resolution": "REFACTOR",
      "reasoning": "Why this was a conflict and how it was resolved"
    }
  ],
  "suggestedTests": ["npm test", "npm run test:integration"],
  "overallReasoning": "Summary of the merge process"
}
\`\`\`
`

  return prompt
}

function generateFileConflictSection(conflict: FileConflictContext): string {
  let section = `### File: \`${conflict.filePath}\`
${conflict.language ? `**Language:** ${conflict.language}` : ''}

**Original Content:**
\`\`\`${conflict.language || ''}
${conflict.originalContent}
\`\`\`

**Concurrent Edits:**

`

  for (const edit of conflict.edits) {
    section += `#### ${edit.branchName}${edit.agentName ? ` (${edit.agentName})` : ''}
${edit.taskTitle ? `**Task:** ${edit.taskTitle}` : ''}
**Operation:** ${edit.edit.operation}
${edit.edit.agentReasoning ? `**Agent's Reasoning:** ${edit.edit.agentReasoning}` : ''}

**New Content:**
\`\`\`${conflict.language || ''}
${edit.edit.newContent || '(deleted)'}
\`\`\`

`
  }

  return section
}

/**
 * Quick merge check - determines if files can be auto-merged without integrator
 */
export function canAutoMerge(conflicts: FileConflictContext[]): boolean {
  for (const conflict of conflicts) {
    // If only one edit per file, no conflict
    if (conflict.edits.length <= 1) continue

    // Check for overlapping line ranges
    const lineRanges: Array<{ start: number; end: number }> = []

    for (const edit of conflict.edits) {
      if (!edit.edit.diffHunks) {
        // Can't determine without diff info - needs integrator
        return false
      }

      for (const hunk of edit.edit.diffHunks) {
        const range = {
          start: hunk.startLine,
          end: hunk.startLine + Math.max(hunk.oldLines.length, hunk.newLines.length),
        }

        // Check overlap with existing ranges
        for (const existing of lineRanges) {
          if (rangesOverlap(range, existing)) {
            return false // Overlap found, needs integrator
          }
        }

        lineRanges.push(range)
      }
    }
  }

  return true // No overlaps, can auto-merge
}

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start <= b.end && b.start <= a.end
}

/**
 * Generates a lightweight prompt for simple merges
 */
export function generateSimpleMergePrompt(conflict: FileConflictContext): string {
  return `Merge these non-overlapping changes to ${conflict.filePath}:

Original:
\`\`\`
${conflict.originalContent}
\`\`\`

${conflict.edits
  .map(
    (e) => `Change from ${e.branchName}:
\`\`\`
${e.edit.newContent}
\`\`\``
  )
  .join('\n\n')}

Apply all changes and return ONLY the merged code, no explanation.`
}
