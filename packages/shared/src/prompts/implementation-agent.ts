/**
 * Implementation Agent Prompts
 *
 * System prompts and builders for the AI implementation feature.
 * Supports autonomous code editing with iterative verification.
 */

import type {
  Task,
  Repo,
  AgentIteration,
  CriterionVerification,
  ImplementationContext,
  ImplementationResult,
} from '../types'

// ===========================================
// System Prompts
// ===========================================

export const IMPLEMENTATION_SYSTEM_PROMPT = `You are an expert software engineer implementing features and fixing bugs for a codebase.

## Your Role
You receive tasks with acceptance criteria and must implement them by modifying code files.
You have access to the repository structure and key files for context.

## Output Format
You MUST respond with valid JSON in this exact structure:
\`\`\`json
{
  "analysis": {
    "understanding": "Brief summary of what needs to be done",
    "approach": "Your implementation approach",
    "risks": ["Potential issues to watch for"]
  },
  "fileChanges": [
    {
      "path": "path/to/file.ts",
      "operation": "CREATE" | "UPDATE" | "DELETE",
      "content": "Full file content for CREATE/UPDATE (include entire file, not just changes)",
      "reason": "Why this change is needed"
    }
  ],
  "commitMessage": "Conventional commit message (e.g., feat: add user authentication)",
  "verification": {
    "selfCheck": [
      {
        "criterion": "The acceptance criterion text",
        "passed": true,
        "reason": "Why it passes/fails",
        "evidence": ["Code references showing it works"]
      }
    ],
    "allPassed": true,
    "confidence": 0.95
  },
  "needsHumanInput": false,
  "humanInputReason": "Only if needsHumanInput is true - explain what you need",
  "nextSteps": ["What to do in next iteration if not complete"]
}
\`\`\`

## Guidelines
1. **Make minimal, focused changes** - Only modify what's necessary
2. **Follow existing patterns** - Match the codebase's coding style
3. **Include complete file content** - For CREATE/UPDATE, provide the ENTIRE file content
4. **Self-verify against EACH criterion** - Be honest about what passes and what doesn't
5. **Be specific about confidence** - 0.0-1.0 where 1.0 means absolutely certain
6. **Request human input when truly stuck** - Don't guess at unclear requirements

## When to Request Human Input
- Unclear or ambiguous requirements
- Need access to systems/APIs not in context
- Design decisions that could go multiple ways
- Security-sensitive changes that need approval

## Code Quality Rules
- Use TypeScript with proper types (no \`any\` unless absolutely necessary)
- Handle errors appropriately
- Keep functions small and focused
- Follow the existing import patterns
- Add necessary imports for new code`

export const VERIFICATION_SYSTEM_PROMPT = `You are a code reviewer verifying whether an implementation meets acceptance criteria.

## Your Role
Review the code changes and verify each acceptance criterion is satisfied.

## Output Format
\`\`\`json
{
  "passed": boolean,
  "score": 0.0-1.0,
  "items": [
    {
      "criterion": "The acceptance criterion",
      "passed": boolean,
      "reason": "Detailed explanation",
      "evidence": ["Code snippets or file paths that support this"]
    }
  ],
  "summary": "Overall assessment",
  "suggestions": ["If not passed, what needs to change"]
}
\`\`\`

## Verification Guidelines
1. Check each criterion independently
2. Be strict - partial implementations should not pass
3. Look for edge cases and error handling
4. Verify consistency with existing patterns
5. Check for security issues in the changes`

// ===========================================
// Prompt Builders
// ===========================================

/**
 * Build the main implementation prompt for Claude
 */
export function buildImplementationPrompt(context: ImplementationContext): string {
  const parts: string[] = []

  parts.push(`# Implementation Task: ${context.task.title}`)
  parts.push('')

  // Task details
  if (context.task.description) {
    parts.push('## Task Description')
    parts.push(context.task.description)
    parts.push('')
  }

  // Acceptance criteria
  parts.push('## Acceptance Criteria')
  parts.push('The implementation MUST satisfy ALL of these criteria:')
  parts.push('')
  context.acceptanceCriteria.forEach((criterion, i) => {
    parts.push(`${i + 1}. ${criterion}`)
  })
  parts.push('')

  // Repository context
  parts.push('## Repository Structure')
  parts.push(`Repository: ${context.repo.owner}/${context.repo.name}`)
  parts.push('Key directories and files:')
  parts.push('```')
  parts.push(context.repoStructure.slice(0, 100).join('\n'))
  if (context.repoStructure.length > 100) {
    parts.push(`... and ${context.repoStructure.length - 100} more files`)
  }
  parts.push('```')
  parts.push('')

  // Key files
  if (context.keyFiles.length > 0) {
    parts.push('## Relevant Code Context')
    for (const file of context.keyFiles.slice(0, 10)) {
      parts.push(`### \`${file.path}\``)
      parts.push('```')
      // Truncate very long files
      const content = file.content.length > 3000
        ? file.content.slice(0, 3000) + '\n... (truncated)'
        : file.content
      parts.push(content)
      parts.push('```')
      parts.push('')
    }
  }

  // Previous iterations
  if (context.previousIterations.length > 0) {
    parts.push('## Previous Iteration Results')
    const lastIteration = context.previousIterations[context.previousIterations.length - 1]

    parts.push(`Iteration ${lastIteration.iteration_number} results:`)
    if (lastIteration.verification_results) {
      parts.push(`- Criteria passed: ${lastIteration.criteria_passed}/${lastIteration.criteria_total}`)
      for (const item of lastIteration.verification_results.items) {
        const status = item.passed ? 'PASS' : 'FAIL'
        parts.push(`- [${status}] ${item.criterion}: ${item.reason}`)
      }
    }

    if (lastIteration.changes_made.length > 0) {
      parts.push('')
      parts.push('Files modified in previous iteration:')
      for (const change of lastIteration.changes_made) {
        parts.push(`- ${change.operation}: ${change.file}`)
      }
    }

    if (lastIteration.blocked_reason) {
      parts.push('')
      parts.push(`Blocked reason: ${lastIteration.blocked_reason}`)
    }
    parts.push('')
  }

  // Human feedback
  if (context.humanFeedback) {
    parts.push('## Human Feedback')
    parts.push('The user has provided the following guidance:')
    parts.push('')
    parts.push(context.humanFeedback)
    parts.push('')
  }

  // Instructions
  parts.push('## Instructions')
  parts.push('1. Analyze the task and acceptance criteria')
  parts.push('2. Plan your implementation approach')
  parts.push('3. Make the necessary file changes (provide COMPLETE file content)')
  parts.push('4. Self-verify against EACH acceptance criterion')
  parts.push('5. Provide a conventional commit message')
  parts.push('')
  parts.push('Respond with the JSON format specified in your system prompt.')

  return parts.join('\n')
}

/**
 * Build a verification prompt for checking implementation
 */
export function buildVerificationPrompt(
  context: ImplementationContext,
  changes: Array<{ path: string; content: string; operation: string }>
): string {
  const parts: string[] = []

  parts.push(`# Verify Implementation: ${context.task.title}`)
  parts.push('')

  parts.push('## Acceptance Criteria to Verify')
  context.acceptanceCriteria.forEach((criterion, i) => {
    parts.push(`${i + 1}. ${criterion}`)
  })
  parts.push('')

  parts.push('## Changes Made')
  for (const change of changes) {
    parts.push(`### ${change.operation}: \`${change.path}\``)
    if (change.content) {
      parts.push('```')
      const content = change.content.length > 4000
        ? change.content.slice(0, 4000) + '\n... (truncated)'
        : change.content
      parts.push(content)
      parts.push('```')
    }
    parts.push('')
  }

  parts.push('## Instructions')
  parts.push('Verify that the changes above satisfy ALL acceptance criteria.')
  parts.push('Be strict - partial implementations should fail.')
  parts.push('Respond with the JSON format specified in your system prompt.')

  return parts.join('\n')
}

// ===========================================
// Acceptance Criteria Extraction
// ===========================================

/**
 * Extract acceptance criteria from a task description
 */
export function extractAcceptanceCriteria(task: Task): string[] {
  const criteria: string[] = []

  if (!task.description) return criteria

  const description = task.description

  // Look for "Acceptance Criteria:" section
  const acMatch = description.match(/acceptance\s*criteria[:\s]*\n((?:[-*\d.]\s*.+\n?)+)/i)
  if (acMatch) {
    const acSection = acMatch[1]
    const items = acSection.match(/[-*\d.]\s*(.+)/g)
    if (items) {
      criteria.push(
        ...items.map(item => item.replace(/^[-*\d.]\s*/, '').trim()).filter(Boolean)
      )
    }
  }

  // Also look for "AC:" section
  if (criteria.length === 0) {
    const acShortMatch = description.match(/\bAC[:\s]*\n((?:[-*\d.]\s*.+\n?)+)/i)
    if (acShortMatch) {
      const acSection = acShortMatch[1]
      const items = acSection.match(/[-*\d.]\s*(.+)/g)
      if (items) {
        criteria.push(
          ...items.map(item => item.replace(/^[-*\d.]\s*/, '').trim()).filter(Boolean)
        )
      }
    }
  }

  // Look for checkbox items as criteria
  if (criteria.length === 0) {
    const checkboxes = description.match(/^[-*]\s*\[[ x]\]\s*(.+)$/gmi)
    if (checkboxes) {
      criteria.push(
        ...checkboxes.map(cb => cb.replace(/^[-*]\s*\[[ x]\]\s*/, '').trim()).filter(Boolean)
      )
    }
  }

  // Extract any bullet points or numbered lists
  if (criteria.length === 0) {
    const bullets = description.match(/^[-*]\s+(.+)$/gm)
    if (bullets) {
      criteria.push(
        ...bullets.map(b => b.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
      )
    }
  }

  // Extract numbered items
  if (criteria.length === 0) {
    const numbered = description.match(/^\d+[.)]\s+(.+)$/gm)
    if (numbered) {
      criteria.push(
        ...numbered.map(n => n.replace(/^\d+[.)]\s+/, '').trim()).filter(Boolean)
      )
    }
  }

  // Fallback: use the whole description as a single criterion
  if (criteria.length === 0 && description.trim()) {
    // Split by newlines and take meaningful lines
    const lines = description
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 10 && !l.startsWith('#'))

    if (lines.length > 0) {
      // Take up to 5 lines as separate criteria
      criteria.push(...lines.slice(0, 5))
    } else {
      criteria.push(description.trim().slice(0, 500))
    }
  }

  return criteria
}

// ===========================================
// Branch Name Generation
// ===========================================

/**
 * Generate a branch name for an implementation
 */
export function generateBranchName(task: Task): string {
  // Format: ai/TASK-KEY-slugified-title
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  return `ai/${task.key}-${slug}`
}

// ===========================================
// PR Description Builder
// ===========================================

/**
 * Build a pull request description
 */
export function buildPRDescription(
  task: { key: string; title: string; description?: string },
  criteria: string[],
  iterations: number,
  filesChanged: number
): string {
  const parts: string[] = []

  parts.push(`## Summary`)
  parts.push(`This PR implements **${task.key}: ${task.title}**`)
  parts.push('')

  if (task.description) {
    parts.push(`### Task Description`)
    parts.push(task.description.slice(0, 500))
    if (task.description.length > 500) {
      parts.push('...')
    }
    parts.push('')
  }

  parts.push(`### Acceptance Criteria`)
  for (const criterion of criteria) {
    parts.push(`- [x] ${criterion}`)
  }
  parts.push('')

  parts.push(`### Implementation Notes`)
  parts.push(`- Generated by AI implementation agent`)
  parts.push(`- Completed in ${iterations} iteration(s)`)
  parts.push(`- ${filesChanged} file(s) changed`)
  parts.push(`- Please review carefully before merging`)
  parts.push('')

  parts.push(`---`)
  parts.push(`*This PR was automatically generated by LaneShare AI Implementation.*`)

  return parts.join('\n')
}

// ===========================================
// Response Parser
// ===========================================

/**
 * Parse an implementation result from Claude's response
 */
export function parseImplementationResult(text: string): ImplementationResult {
  // Extract JSON from response
  let jsonStr = text.trim()

  // Handle markdown code blocks
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  // Try to find JSON object in the response if it's embedded in other text
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    jsonStr = objectMatch[0]
  }

  const parsed = JSON.parse(jsonStr) as ImplementationResult

  // Validate required fields
  if (!parsed.analysis || !parsed.fileChanges || !parsed.verification) {
    throw new Error('Missing required fields in implementation result')
  }

  return parsed
}

// ===========================================
// Keyword Extraction (for finding relevant files)
// ===========================================

/**
 * Extract keywords from text for finding relevant files
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
    'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but',
    'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these',
    'those', 'task', 'implement', 'create', 'add', 'update', 'feature',
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 15)
}
