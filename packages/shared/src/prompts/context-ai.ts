/**
 * Context AI Prompts - System prompts for intelligent context discovery
 */

import type {
  Task,
  ContextAISuggestion,
  ContextSuggestionType,
  TaskStatus,
  TaskType,
  TicketLinkType,
} from '../types'

// ===========================================
// Types
// ===========================================

export interface ContextDiscoveryInput {
  task: Task
  projectName: string
  availableServices: Array<{
    id: string
    service: string
    display_name: string
  }>
  availableAssets: Array<{
    id: string
    name: string
    asset_type: string
    asset_key: string
    service: string
  }>
  availableRepos: Array<{
    id: string
    owner: string
    name: string
    default_branch?: string
  }>
  availableDocs: Array<{
    id: string
    slug: string
    title: string
    category?: string
    excerpt?: string
  }>
  availableFeatures: Array<{
    id: string
    feature_slug: string
    feature_name: string
    description?: string
  }>
  availableTickets: Array<{
    id: string
    key: string
    title: string
    status: TaskStatus
    type: TaskType
  }>
  conversationHistory?: Array<{
    role: 'user' | 'ai'
    content: string
  }>
  userMessage: string
}

export interface ContextDiscoveryOutput {
  response: string
  suggestions: ContextAISuggestion[]
}

// ===========================================
// System Prompt
// ===========================================

export const CONTEXT_AI_SYSTEM_PROMPT = `You are a Context AI assistant helping users discover and link relevant context to their development tasks. Your job is to analyze the task and suggest services, database assets, repositories, documentation, architecture features, and related tickets that would be relevant for implementing the task.

## Your Capabilities

1. **Analyze Tasks**: Understand what the task is about and what context would be helpful
2. **Suggest Services**: Recommend connected services (Supabase, Vercel, etc.) that are relevant
3. **Suggest Assets**: Recommend specific database tables, functions, policies, etc.
4. **Suggest Repositories**: Recommend relevant code repositories
5. **Suggest Documentation**: Recommend relevant docs (architecture, features, decisions)
6. **Suggest Architecture Features**: Recommend relevant architecture feature flows
7. **Suggest Related Tickets**: Recommend related tasks/tickets that share context or dependencies

## Response Format

You MUST respond with valid JSON in this exact structure:
{
  "response": "Your conversational response to the user",
  "suggestions": [
    {
      "type": "service" | "asset" | "repo" | "doc" | "feature" | "ticket",
      "id": "uuid",
      "name": "Display name",
      "reason": "Why this is relevant",
      "confidence": 0.0-1.0,
      "details": {
        "service": "optional service name",
        "asset_type": "optional for assets",
        "owner": "optional for repos",
        "slug": "optional for docs",
        "category": "optional for docs",
        "feature_slug": "optional for features",
        "key": "optional ticket key for tickets",
        "status": "optional ticket status",
        "task_type": "optional task type",
        "link_type": "optional: related | blocks | blocked_by | duplicates | duplicated_by"
      }
    }
  ]
}

## Guidelines

1. **Be Conversational**: Your response should be friendly and helpful
2. **Prioritize by Relevance**: Order suggestions by confidence (highest first)
3. **Explain Why**: Each suggestion should have a clear reason
4. **Be Thorough**: Look for non-obvious connections (e.g., if a task mentions auth, suggest auth-related assets, policies, docs, and related tickets)
5. **Consider Task Type**:
   - BUG: Focus on related code, existing functionality, and similar bug tickets
   - STORY/TASK: Focus on related features, architecture docs, and dependent/related tickets
   - SPIKE: Focus on research/architecture docs and existing similar features
   - EPIC: Focus on high-level architecture, related sub-systems, and child tickets
6. **Don't Over-Suggest**: Only suggest items that are genuinely relevant (confidence > 0.5)
7. **Handle Follow-ups**: If the user asks clarifying questions, adapt your suggestions
8. **Ticket Relationships**: When suggesting tickets, consider the relationship type:
   - "related": General connection (default)
   - "blocks": This task blocks the current task
   - "blocked_by": This task is blocked by the suggested ticket
   - "duplicates": The current task duplicates the suggested one
   - "duplicated_by": The suggested ticket duplicates the current one

## Keywords to Match

Look for these types of keywords in task titles/descriptions:
- Database/data: tables, columns, schema, CRUD, queries
- Auth: users, login, authentication, authorization, roles, permissions
- API: endpoints, routes, handlers, middleware
- UI: components, pages, forms, views, layouts
- Infrastructure: deployment, hosting, domains, env vars
- Docs: documentation, architecture, decisions, features
- Architecture: flows, features, screens, endpoints, integrations
- Dependencies: blocked, depends on, prerequisite, before, after`

// ===========================================
// Prompt Builder
// ===========================================

export function buildContextDiscoveryPrompt(input: ContextDiscoveryInput): string {
  const parts: string[] = []

  // Task context
  parts.push('## Current Task')
  parts.push(`**Title:** ${input.task.title}`)
  parts.push(`**Type:** ${input.task.type}`)
  parts.push(`**Priority:** ${input.task.priority}`)
  if (input.task.description) {
    parts.push(`**Description:** ${input.task.description}`)
  }
  if (input.task.labels && input.task.labels.length > 0) {
    parts.push(`**Labels:** ${input.task.labels.join(', ')}`)
  }
  parts.push('')

  // Available context
  parts.push('## Available Context')
  parts.push('')

  // Services
  if (input.availableServices.length > 0) {
    parts.push('### Connected Services')
    for (const service of input.availableServices) {
      parts.push(`- **${service.display_name}** (${service.service}) - ID: ${service.id}`)
    }
    parts.push('')
  }

  // Assets (grouped by service)
  if (input.availableAssets.length > 0) {
    parts.push('### Service Assets')
    const assetsByService = input.availableAssets.reduce((acc, asset) => {
      if (!acc[asset.service]) acc[asset.service] = []
      acc[asset.service].push(asset)
      return acc
    }, {} as Record<string, typeof input.availableAssets>)

    for (const [service, assets] of Object.entries(assetsByService)) {
      parts.push(`#### ${service}`)
      for (const asset of assets.slice(0, 20)) {  // Limit to prevent token overflow
        parts.push(`- ${asset.asset_type}: **${asset.name}** (${asset.asset_key}) - ID: ${asset.id}`)
      }
      if (assets.length > 20) {
        parts.push(`  ... and ${assets.length - 20} more assets`)
      }
    }
    parts.push('')
  }

  // Repos
  if (input.availableRepos.length > 0) {
    parts.push('### Repositories')
    for (const repo of input.availableRepos) {
      parts.push(`- **${repo.owner}/${repo.name}** (${repo.default_branch || 'main'}) - ID: ${repo.id}`)
    }
    parts.push('')
  }

  // Docs
  if (input.availableDocs.length > 0) {
    parts.push('### Documentation')
    for (const doc of input.availableDocs.slice(0, 15)) {  // Limit to prevent token overflow
      parts.push(`- **${doc.title}** (${doc.category || 'general'}) - slug: ${doc.slug} - ID: ${doc.id}`)
      if (doc.excerpt) {
        parts.push(`  ${doc.excerpt.slice(0, 100)}...`)
      }
    }
    if (input.availableDocs.length > 15) {
      parts.push(`  ... and ${input.availableDocs.length - 15} more documents`)
    }
    parts.push('')
  }

  // Features
  if (input.availableFeatures.length > 0) {
    parts.push('### Architecture Features')
    for (const feature of input.availableFeatures.slice(0, 15)) {
      parts.push(`- **${feature.feature_name}** (${feature.feature_slug}) - ID: ${feature.id}`)
      if (feature.description) {
        parts.push(`  ${feature.description.slice(0, 100)}...`)
      }
    }
    if (input.availableFeatures.length > 15) {
      parts.push(`  ... and ${input.availableFeatures.length - 15} more features`)
    }
    parts.push('')
  }

  // Tickets
  if (input.availableTickets.length > 0) {
    parts.push('### Related Tickets')
    for (const ticket of input.availableTickets.slice(0, 20)) {
      parts.push(`- **${ticket.key}**: ${ticket.title} [${ticket.status}] (${ticket.type}) - ID: ${ticket.id}`)
    }
    if (input.availableTickets.length > 20) {
      parts.push(`  ... and ${input.availableTickets.length - 20} more tickets`)
    }
    parts.push('')
  }

  // Conversation history
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    parts.push('## Conversation History')
    for (const msg of input.conversationHistory.slice(-6)) {  // Last 6 messages
      const role = msg.role === 'user' ? 'User' : 'Context AI'
      parts.push(`**${role}:** ${msg.content}`)
    }
    parts.push('')
  }

  // Current user message
  parts.push('## User Message')
  parts.push(input.userMessage)
  parts.push('')

  // Instructions
  parts.push('## Your Task')
  parts.push('Respond to the user and suggest relevant context items based on the task and conversation.')
  parts.push('Only suggest items from the "Available Context" section above, using their exact IDs.')
  parts.push('Respond in the required JSON format.')

  return parts.join('\n')
}

// ===========================================
// Response Parser
// ===========================================

export function parseContextDiscoveryResponse(
  response: string
): ContextDiscoveryOutput | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate structure
    if (typeof parsed.response !== 'string') {
      return null
    }

    const suggestions: ContextAISuggestion[] = []
    if (Array.isArray(parsed.suggestions)) {
      for (const s of parsed.suggestions) {
        if (
          s.type &&
          s.id &&
          s.name &&
          s.reason &&
          typeof s.confidence === 'number'
        ) {
          suggestions.push({
            type: s.type as ContextSuggestionType,
            id: s.id,
            name: s.name,
            reason: s.reason,
            confidence: Math.min(1, Math.max(0, s.confidence)),
            details: s.details,
          })
        }
      }
    }

    // Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence)

    return {
      response: parsed.response,
      suggestions,
    }
  } catch (error) {
    console.error('Failed to parse context discovery response:', error)
    return null
  }
}

// ===========================================
// Auto-Discovery Prompt (initial analysis)
// ===========================================

export const AUTO_DISCOVERY_PROMPT = `Based on the task details, what services, assets, repositories, documentation, architecture features, and related tickets would be most relevant for implementing this task?

Focus on:
1. Database tables and functions that would be involved
2. Repositories where code changes would be needed
3. Architecture or feature documentation that provides context
4. Any services (auth, storage, etc.) that would be used
5. Architecture feature flows that are relevant
6. Related or dependent tickets that share context

Suggest 3-10 items that are most directly relevant.`

// ===========================================
// Helper for generating initial suggestions
// ===========================================

export function buildAutoDiscoveryPrompt(input: Omit<ContextDiscoveryInput, 'userMessage' | 'conversationHistory'>): string {
  return buildContextDiscoveryPrompt({
    ...input,
    userMessage: AUTO_DISCOVERY_PROMPT,
    conversationHistory: [],
  })
}
