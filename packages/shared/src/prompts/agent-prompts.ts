/**
 * Agent Prompts - Prompt builders for task-focused AI coding agent prompts
 */

import type {
  Task,
  Repo,
  DocPage,
  SearchResult,
  ResponseAnalysisResult,
  PromptMetadata,
  TicketLinkType,
  TaskStatus,
  TaskType,
  TaskPriority,
} from '../types'

// ===========================================
// Types
// ===========================================

export interface LinkedContextForPrompt {
  services: Array<{
    service: string
    display_name: string
    assets?: Array<{
      name: string
      asset_type: string
      asset_key: string
      data_json?: Record<string, unknown>
    }>
  }>
  repos: Array<{
    owner: string
    name: string
    default_branch?: string
  }>
  docs: Array<{
    slug: string
    title: string
    markdown: string
    category?: string
  }>
  features?: Array<{
    feature_slug: string
    feature_name: string
    description?: string
    flow_json?: unknown[]
    screens?: string[]
    endpoints?: string[]
    tables?: string[]
  }>
  tickets?: Array<{
    link_type: TicketLinkType
    key: string
    title: string
    description?: string
    type: TaskType
    status: TaskStatus
    priority: TaskPriority
  }>
}

export interface TaskPromptContext {
  task: Task
  repo: Repo
  projectName: string
  relevantChunks: SearchResult[]
  relevantDocs: Pick<DocPage, 'slug' | 'title' | 'markdown'>[]
  additionalInstructions?: string
  linkedContext?: LinkedContextForPrompt
}

export interface ResponseAnalysisContext {
  originalPrompt: string
  taskTitle: string
  taskDescription?: string
  verificationChecklist: string[]
  agentResponse: string
  agentTool: string
}

export interface FollowUpContext {
  task: Task
  repo: Repo
  projectName: string
  previousPrompt: string
  previousResponse: string
  analysisResult: ResponseAnalysisResult
  relevantChunks: SearchResult[]
  additionalInstructions?: string
}

// ===========================================
// Initial Task Prompt Builder
// ===========================================

export function buildTaskAgentPrompt(context: TaskPromptContext): {
  prompt: string
  metadata: PromptMetadata
} {
  const parts: string[] = []
  const keyFiles: string[] = []

  // Header with task context
  parts.push(`# Implementation Task: ${context.task.title}`)
  parts.push('')
  parts.push(`**Project:** ${context.projectName}`)
  parts.push(`**Repository:** ${context.repo.owner}/${context.repo.name}`)
  parts.push(`**Task Type:** ${context.task.type}`)
  parts.push(`**Priority:** ${context.task.priority}`)
  parts.push('')

  // Task description
  if (context.task.description) {
    parts.push('## Task Description')
    parts.push(context.task.description)
    parts.push('')
  }

  // Relevant code context
  if (context.relevantChunks.length > 0) {
    parts.push('## Relevant Code Context')
    parts.push('The following code snippets are relevant to this task:')
    parts.push('')

    for (const chunk of context.relevantChunks.slice(0, 8)) {
      keyFiles.push(chunk.file_path)
      parts.push(`### \`${chunk.file_path}\``)
      parts.push('```')
      parts.push(chunk.content.slice(0, 1200))
      parts.push('```')
      parts.push('')
    }
  }

  // Documentation context
  if (context.relevantDocs.length > 0) {
    parts.push('## Relevant Documentation')
    for (const doc of context.relevantDocs.slice(0, 3)) {
      parts.push(`### ${doc.title}`)
      parts.push(doc.markdown.slice(0, 800))
      parts.push('')
    }
  }

  // Linked context (services, assets, repos, docs, features, tickets)
  if (context.linkedContext) {
    const { services, repos, docs, features, tickets } = context.linkedContext
    const hasLinkedContext = services.length > 0 || repos.length > 0 || docs.length > 0 ||
      (features?.length ?? 0) > 0 || (tickets?.length ?? 0) > 0

    if (hasLinkedContext) {
      parts.push('## Linked Context')
      parts.push('')
      parts.push('The following context has been specifically linked to this task:')
      parts.push('')

      // Connected services and their assets
      if (services.length > 0) {
        parts.push('### Connected Services')
        for (const service of services) {
          parts.push(`#### ${service.display_name} (${service.service})`)
          if (service.assets && service.assets.length > 0) {
            parts.push('**Relevant assets:**')
            for (const asset of service.assets.slice(0, 10)) {
              parts.push(`- **${asset.asset_type}**: \`${asset.name}\` (${asset.asset_key})`)
              // Include schema info for tables
              if (asset.asset_type === 'table' && asset.data_json) {
                const columns = (asset.data_json as { columns?: Array<{ name: string; type: string }> }).columns
                if (columns && columns.length > 0) {
                  const colList = columns.slice(0, 8).map((c) => `${c.name}: ${c.type}`).join(', ')
                  parts.push(`  Columns: ${colList}${columns.length > 8 ? '...' : ''}`)
                }
              }
            }
          }
          parts.push('')
        }
      }

      // Related repositories
      if (repos.length > 0) {
        parts.push('### Related Repositories')
        for (const repo of repos) {
          parts.push(`- **${repo.owner}/${repo.name}** (${repo.default_branch || 'main'})`)
        }
        parts.push('')
      }

      // Linked documentation
      if (docs.length > 0) {
        parts.push('### Linked Documentation')
        for (const doc of docs.slice(0, 5)) {
          parts.push(`#### ${doc.title}`)
          if (doc.category) {
            parts.push(`*Category: ${doc.category}*`)
          }
          parts.push(doc.markdown.slice(0, 600))
          parts.push('')
        }
      }

      // Architecture features
      if (features && features.length > 0) {
        parts.push('### Architecture Features')
        parts.push('The following feature flows are relevant to this task:')
        parts.push('')
        for (const feature of features.slice(0, 5)) {
          parts.push(`#### ${feature.feature_name} (\`${feature.feature_slug}\`)`)
          if (feature.description) {
            parts.push(feature.description)
          }
          // Show related components
          const components: string[] = []
          if (feature.screens && feature.screens.length > 0) {
            components.push(`Screens: ${feature.screens.slice(0, 5).join(', ')}`)
          }
          if (feature.endpoints && feature.endpoints.length > 0) {
            components.push(`Endpoints: ${feature.endpoints.slice(0, 5).join(', ')}`)
          }
          if (feature.tables && feature.tables.length > 0) {
            components.push(`Tables: ${feature.tables.slice(0, 5).join(', ')}`)
          }
          if (components.length > 0) {
            parts.push(`**Components:** ${components.join(' | ')}`)
          }
          parts.push('')
        }
      }

      // Related tickets
      if (tickets && tickets.length > 0) {
        parts.push('### Related Tickets')
        parts.push('The following tickets are related to this task:')
        parts.push('')
        for (const ticket of tickets.slice(0, 10)) {
          const linkLabel = {
            related: 'Related',
            blocks: 'Blocks this task',
            blocked_by: 'This task is blocked by',
            duplicates: 'Duplicates',
            duplicated_by: 'Duplicated by',
          }[ticket.link_type] || 'Related'

          parts.push(`- **${ticket.key}** [${ticket.status}] - ${ticket.title}`)
          parts.push(`  *${linkLabel}* | Type: ${ticket.type} | Priority: ${ticket.priority}`)
          if (ticket.description) {
            parts.push(`  ${ticket.description.slice(0, 150)}...`)
          }
        }
        parts.push('')
      }
    }
  }

  // Implementation instructions
  parts.push('## Implementation Instructions')
  parts.push('')
  parts.push('Please implement this task following these guidelines:')
  parts.push('')
  parts.push('1. **Follow existing patterns** in the codebase shown above')
  parts.push('2. **Maintain consistency** with the project\'s coding style')
  parts.push('3. **Add appropriate error handling** where needed')
  parts.push('4. **Include comments** only where the logic is non-obvious')
  parts.push('')

  // Additional instructions from user
  if (context.additionalInstructions) {
    parts.push('## Additional Instructions')
    parts.push(context.additionalInstructions)
    parts.push('')
  }

  // Verification checklist
  const checklist = generateVerificationChecklist(context.task, context.repo)
  parts.push('## Verification Checklist')
  parts.push('After implementation, verify:')
  parts.push('')
  for (const item of checklist) {
    parts.push(`- [ ] ${item}`)
  }
  parts.push('')

  // Output expectations
  parts.push('## Expected Output')
  parts.push('')
  parts.push('Please provide:')
  parts.push('1. The complete implementation with file paths')
  parts.push('2. Any new dependencies that need to be installed')
  parts.push('3. Commands to run tests or verify the implementation')
  parts.push('4. Any manual steps needed (database migrations, env vars, etc.)')

  const metadata: PromptMetadata = {
    context_pack: {
      repos: [context.repo.id],
      key_files: Array.from(new Set(keyFiles)),
      chunk_count: context.relevantChunks.length,
    },
    verification_checklist: checklist,
    task_context: {
      title: context.task.title,
      description: context.task.description,
      type: context.task.type,
      priority: context.task.priority,
    },
  }

  return {
    prompt: parts.join('\n'),
    metadata,
  }
}

// ===========================================
// Response Analysis Prompt
// ===========================================

export const RESPONSE_ANALYSIS_SYSTEM_PROMPT = `You are an AI response analyzer specialized in parsing outputs from coding AI agents (Cursor, Claude Code, Copilot, Aider, etc.).

Your job is to analyze the response and determine:
1. Whether the implementation task was successful
2. Which specific items from the verification checklist were completed
3. What failed or was skipped, and why
4. Whether follow-up prompts are needed

## Output Format
You MUST respond with valid JSON in this exact structure:
{
  "success": boolean,
  "confidence": number,
  "completedItems": ["string"],
  "failedItems": [{"item": "string", "reason": "string"}],
  "partialItems": [{"item": "string", "status": "string"}],
  "notes": ["string"],
  "suggestedTaskStatus": "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED" | null,
  "suggestedDocUpdates": [{"slug": "string", "action": "create" | "update", "description": "string"}],
  "needsFollowUp": boolean,
  "followUpReason": "string or null"
}

## Analysis Guidelines
- Look for explicit success/failure indicators in the response
- Parse error messages, stack traces, and warnings
- Identify files that were created or modified
- Check if tests were mentioned and whether they passed
- Note any TODOs, FIXMEs, or incomplete sections
- Consider partial implementations as needing follow-up
- Confidence should reflect how certain you are about the assessment (0.0-1.0)

## Task Status Mapping
- "DONE": All items completed, tests pass, implementation is production-ready
- "IN_REVIEW": Implementation complete but needs human review
- "IN_PROGRESS": Partial implementation, needs more work
- "BLOCKED": Implementation cannot proceed due to external blockers
- null: No status change recommended`

export function buildResponseAnalysisPrompt(context: ResponseAnalysisContext): string {
  const parts: string[] = []

  parts.push('## Task Context')
  parts.push(`**Title:** ${context.taskTitle}`)
  if (context.taskDescription) {
    parts.push(`**Description:** ${context.taskDescription}`)
  }
  parts.push('')

  parts.push('## Original Prompt Given to AI Agent')
  parts.push('```')
  parts.push(context.originalPrompt.slice(0, 3000))
  parts.push('```')
  parts.push('')

  parts.push('## Verification Checklist')
  for (const item of context.verificationChecklist) {
    parts.push(`- ${item}`)
  }
  parts.push('')

  parts.push('## AI Agent Response')
  parts.push(`**Tool Used:** ${context.agentTool}`)
  parts.push('')
  parts.push('```')
  parts.push(context.agentResponse)
  parts.push('```')
  parts.push('')

  parts.push('## Your Task')
  parts.push('Analyze the AI agent response above and provide your assessment in the required JSON format.')
  parts.push('Be thorough in identifying completed vs incomplete items.')

  return parts.join('\n')
}

// ===========================================
// Follow-up Prompt Builder
// ===========================================

export function buildFollowUpPrompt(context: FollowUpContext): {
  prompt: string
  metadata: PromptMetadata
} {
  const parts: string[] = []
  const keyFiles: string[] = []

  parts.push(`# Follow-up: ${context.task.title}`)
  parts.push('')
  parts.push('## Previous Attempt Summary')
  parts.push('')

  // What succeeded
  if (context.analysisResult.completedItems.length > 0) {
    parts.push('### Completed Successfully')
    for (const item of context.analysisResult.completedItems) {
      parts.push(`- ${item}`)
    }
    parts.push('')
  }

  // What failed
  if (context.analysisResult.failedItems.length > 0) {
    parts.push('### Failed Items (Need Resolution)')
    for (const item of context.analysisResult.failedItems) {
      parts.push(`- **${item.item}**: ${item.reason}`)
    }
    parts.push('')
  }

  // Partial items
  if (context.analysisResult.partialItems.length > 0) {
    parts.push('### Partial Implementation')
    for (const item of context.analysisResult.partialItems) {
      parts.push(`- **${item.item}**: ${item.status}`)
    }
    parts.push('')
  }

  // Analysis notes
  if (context.analysisResult.notes.length > 0) {
    parts.push('### Notes from Previous Attempt')
    for (const note of context.analysisResult.notes) {
      parts.push(`- ${note}`)
    }
    parts.push('')
  }

  // Follow-up reason
  if (context.analysisResult.followUpReason) {
    parts.push('## Why Follow-up is Needed')
    parts.push(context.analysisResult.followUpReason)
    parts.push('')
  }

  // Previous response excerpt (for context)
  parts.push('## Previous Response (Excerpt)')
  parts.push('```')
  parts.push(context.previousResponse.slice(-2000))
  parts.push('```')
  parts.push('')

  // Updated code context
  if (context.relevantChunks.length > 0) {
    parts.push('## Current Code Context')
    for (const chunk of context.relevantChunks.slice(0, 5)) {
      keyFiles.push(chunk.file_path)
      parts.push(`### \`${chunk.file_path}\``)
      parts.push('```')
      parts.push(chunk.content.slice(0, 1000))
      parts.push('```')
      parts.push('')
    }
  }

  // Additional instructions
  if (context.additionalInstructions) {
    parts.push('## Additional Instructions')
    parts.push(context.additionalInstructions)
    parts.push('')
  }

  // Clear action items
  parts.push('## Required Actions')
  parts.push('')
  parts.push('Please address the following:')
  parts.push('')

  let actionNum = 1
  for (const item of context.analysisResult.failedItems) {
    parts.push(`${actionNum}. Fix: ${item.item}`)
    parts.push(`   - Issue: ${item.reason}`)
    actionNum++
  }
  for (const item of context.analysisResult.partialItems) {
    parts.push(`${actionNum}. Complete: ${item.item}`)
    parts.push(`   - Current status: ${item.status}`)
    actionNum++
  }

  parts.push('')
  parts.push('## Verification')
  parts.push('After making these changes, please verify that:')
  parts.push('1. All previously failing items now work')
  parts.push('2. No regressions were introduced')
  parts.push('3. Tests pass (if applicable)')

  const metadata: PromptMetadata = {
    context_pack: {
      repos: [context.repo.id],
      key_files: Array.from(new Set(keyFiles)),
      chunk_count: context.relevantChunks.length,
    },
    task_context: {
      title: context.task.title,
      description: context.task.description,
      type: context.task.type,
      priority: context.task.priority,
    },
  }

  return {
    prompt: parts.join('\n'),
    metadata,
  }
}

// ===========================================
// Helper Functions
// ===========================================

function generateVerificationChecklist(task: Task, repo: Repo): string[] {
  const checklist: string[] = []

  // Type-specific checks
  switch (task.type) {
    case 'BUG':
      checklist.push('Bug is fixed and no longer reproducible')
      checklist.push('Root cause is addressed (not just symptoms)')
      checklist.push('No regressions introduced')
      break
    case 'STORY':
    case 'TASK':
      checklist.push('Feature works as described in the task')
      checklist.push('Edge cases are handled')
      checklist.push('User-facing changes are tested')
      break
    case 'SPIKE':
      checklist.push('Research findings are documented')
      checklist.push('Proof of concept demonstrates feasibility')
      checklist.push('Next steps are identified')
      break
    case 'EPIC':
      checklist.push('All sub-tasks are identified')
      checklist.push('Integration points are documented')
      break
  }

  // Standard checks
  checklist.push('Code compiles without errors')
  checklist.push('No new TypeScript/lint errors introduced')

  // Repo-specific checks
  if (repo.name.includes('web') || repo.name.includes('frontend')) {
    checklist.push('UI renders correctly')
    checklist.push('No console errors in browser')
  }

  if (repo.name.includes('api') || repo.name.includes('backend')) {
    checklist.push('API endpoints return expected responses')
    checklist.push('Database operations work correctly')
  }

  checklist.push('Tests pass (if applicable)')

  return checklist
}

/**
 * Determine suggested task status based on analysis result
 */
export function determineTaskStatus(
  analysis: ResponseAnalysisResult,
  currentStatus: string
): string | null {
  // All items completed with high confidence
  if (
    analysis.success &&
    analysis.confidence >= 0.8 &&
    analysis.failedItems.length === 0 &&
    analysis.partialItems.length === 0
  ) {
    // Check if tests passed (mentioned in notes or completed items)
    const testsPass = analysis.notes.some(
      (n) => n.toLowerCase().includes('test') && n.toLowerCase().includes('pass')
    ) || analysis.completedItems.some(
      (item) => item.toLowerCase().includes('test') && item.toLowerCase().includes('pass')
    )

    return testsPass ? 'DONE' : 'IN_REVIEW'
  }

  // Partial progress
  if (analysis.completedItems.length > 0 && currentStatus === 'TODO') {
    return 'IN_PROGRESS'
  }

  // Blocked
  if (analysis.failedItems.some((f) =>
    f.reason.toLowerCase().includes('blocker') ||
    f.reason.toLowerCase().includes('dependency') ||
    f.reason.toLowerCase().includes('cannot proceed')
  )) {
    return 'BLOCKED'
  }

  // If needs follow-up but has progress, stay in progress
  if (analysis.needsFollowUp && analysis.completedItems.length > 0) {
    return 'IN_PROGRESS'
  }

  return null
}
