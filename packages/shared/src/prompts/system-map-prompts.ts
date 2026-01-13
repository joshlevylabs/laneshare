/**
 * System Map Prompts - Prompt builders for System Map analysis and agent output processing
 */

import type {
  System,
  SystemGraph,
  SystemNode,
  SystemEdge,
  GroundedFinding,
  EvidenceSourceType,
  EvidenceConfidence,
  SystemNodeType,
  SystemEdgeKind,
} from '../types'

// ===========================================
// Types
// ===========================================

export interface SystemAnalysisContext {
  system: System
  projectName: string
  relevantDocs: Array<{
    slug: string
    title: string
    markdown: string
  }>
  relevantChunks: Array<{
    repoId: string
    repoName: string
    filePath: string
    content: string
  }>
}

export interface AgentOutputParseContext {
  system: System
  agentOutput: string
  agentTool: string
  existingFindings: GroundedFinding[]
}

// ===========================================
// Analysis Prompt - For initial system analysis
// ===========================================

export const SYSTEM_ANALYSIS_SYSTEM_PROMPT = `You are an expert software architecture analyst. Your role is to analyze existing documentation and code to identify factual information about a specific system or feature area.

## Key Principles:
1. **Grounded in Evidence**: Every statement must be backed by specific evidence from the provided docs or code
2. **No Speculation**: Only report what you can confirm from the provided context
3. **Cite Sources**: Include specific references for each finding
4. **Identify Gaps**: Note areas where information is missing or unclear

## Output Format:
You MUST respond with valid JSON in this exact structure:
{
  "findings": [
    {
      "statement": "A factual statement about the system",
      "confidence": "HIGH" | "MED" | "LOW",
      "citations": [
        {
          "type": "DOC" | "REPO",
          "ref": "doc slug or file path",
          "excerpt": "relevant quote"
        }
      ]
    }
  ],
  "openQuestions": [
    "Question about unclear or missing information"
  ],
  "componentSuggestions": [
    {
      "type": "UI" | "API" | "SERVICE" | "DATA" | "WORKER" | "EXTERNAL" | "DOC",
      "label": "Component name",
      "details": "What it does",
      "evidenceRefs": ["citation refs"]
    }
  ],
  "relationshipSuggestions": [
    {
      "from": "source component label",
      "to": "target component label",
      "kind": "CALLS" | "READS" | "WRITES" | "TRIGGERS" | "CONFIGURES",
      "label": "optional description",
      "evidenceRefs": ["citation refs"]
    }
  ]
}

## Confidence Levels:
- HIGH: Directly stated in docs/code, multiple sources confirm
- MED: Implied or partially confirmed, single source
- LOW: Inferred from patterns, needs verification

## Component Types:
- UI: User interfaces, pages, screens, frontend components
- API: API endpoints, routes, handlers
- SERVICE: Business logic, services, modules
- DATA: Databases, storage, caches
- WORKER: Background jobs, queues, scheduled tasks
- EXTERNAL: Third-party services, external APIs
- DOC: Documentation pages`

export function buildSystemAnalysisPrompt(context: SystemAnalysisContext): string {
  const parts: string[] = []

  parts.push(`# System Analysis: ${context.system.name}`)
  parts.push('')
  parts.push(`**Project:** ${context.projectName}`)
  parts.push('')

  if (context.system.description) {
    parts.push('## System Description')
    parts.push(context.system.description)
    parts.push('')
  }

  if (context.system.in_scope) {
    parts.push('## In Scope')
    parts.push(context.system.in_scope)
    parts.push('')
  }

  if (context.system.out_of_scope) {
    parts.push('## Out of Scope')
    parts.push(context.system.out_of_scope)
    parts.push('')
  }

  if (context.system.keywords.length > 0) {
    parts.push('## Keywords')
    parts.push(context.system.keywords.join(', '))
    parts.push('')
  }

  // Documentation context
  if (context.relevantDocs.length > 0) {
    parts.push('## Relevant Documentation')
    parts.push('')
    for (const doc of context.relevantDocs.slice(0, 8)) {
      parts.push(`### ${doc.title} (${doc.slug})`)
      parts.push(doc.markdown.slice(0, 2000))
      parts.push('')
    }
  }

  // Code context
  if (context.relevantChunks.length > 0) {
    parts.push('## Relevant Code')
    parts.push('')
    for (const chunk of context.relevantChunks.slice(0, 12)) {
      parts.push(`### ${chunk.repoName}: ${chunk.filePath}`)
      parts.push('```')
      parts.push(chunk.content.slice(0, 1500))
      parts.push('```')
      parts.push('')
    }
  }

  parts.push('## Your Task')
  parts.push(`Analyze the documentation and code above to identify factual information about the "${context.system.name}" system.`)
  parts.push('')
  parts.push('Focus on:')
  parts.push('1. Components that are part of this system')
  parts.push('2. How components interact (data flow, calls, etc.)')
  parts.push('3. External dependencies')
  parts.push('4. Data stores and their usage')
  parts.push('')
  parts.push('Respond with the JSON format specified.')

  return parts.join('\n')
}

// ===========================================
// Agent Context Prompt - For external coding agents
// ===========================================

export function buildAgentContextPrompt(
  system: System,
  projectName: string,
  groundedFindings: GroundedFinding[],
  openQuestions: string[]
): string {
  const parts: string[] = []

  parts.push(`# System Architecture Discovery: ${system.name}`)
  parts.push('')
  parts.push(`**Project:** ${projectName}`)
  parts.push('')

  parts.push('## Context')
  parts.push('You are helping document the architecture of a specific system/feature. We need you to explore the codebase and provide structured information about the components, their relationships, and data flows.')
  parts.push('')

  if (system.description) {
    parts.push('## System Description')
    parts.push(system.description)
    parts.push('')
  }

  if (system.in_scope) {
    parts.push('## In Scope')
    parts.push(system.in_scope)
    parts.push('')
  }

  if (system.out_of_scope) {
    parts.push('## Out of Scope (Do NOT include these)')
    parts.push(system.out_of_scope)
    parts.push('')
  }

  if (system.keywords.length > 0) {
    parts.push('## Keywords to Search For')
    parts.push(system.keywords.join(', '))
    parts.push('')
  }

  // Show existing findings
  if (groundedFindings.length > 0) {
    parts.push('## What We Already Know')
    parts.push('These findings have been confirmed from documentation:')
    parts.push('')
    for (const finding of groundedFindings.slice(0, 15)) {
      parts.push(`- [${finding.confidence}] ${finding.statement}`)
    }
    parts.push('')
  }

  // Show open questions
  if (openQuestions.length > 0) {
    parts.push('## Open Questions')
    parts.push('Please help answer these questions:')
    parts.push('')
    for (const question of openQuestions) {
      parts.push(`- ${question}`)
    }
    parts.push('')
  }

  parts.push('## Your Task')
  parts.push('Explore the codebase and provide a structured analysis of this system. Output your findings in this format:')
  parts.push('')
  parts.push('```')
  parts.push('## Components Found')
  parts.push('For each component, provide:')
  parts.push('- **Name**: Component name')
  parts.push('- **Type**: UI | API | SERVICE | DATA | WORKER | EXTERNAL')
  parts.push('- **Location**: File path(s) where it\'s implemented')
  parts.push('- **Description**: What it does')
  parts.push('- **Evidence**: Relevant code snippets or file references')
  parts.push('')
  parts.push('## Relationships')
  parts.push('For each relationship between components:')
  parts.push('- **From**: Source component')
  parts.push('- **To**: Target component')
  parts.push('- **Type**: CALLS | READS | WRITES | TRIGGERS | CONFIGURES')
  parts.push('- **Evidence**: Code showing this relationship')
  parts.push('')
  parts.push('## Data Flow')
  parts.push('Describe how data moves through the system:')
  parts.push('1. Entry points (user actions, API calls, scheduled jobs)')
  parts.push('2. Processing steps')
  parts.push('3. Storage operations')
  parts.push('4. Outputs (responses, notifications, side effects)')
  parts.push('')
  parts.push('## Unanswered Questions')
  parts.push('List anything you couldn\'t determine from the codebase.')
  parts.push('```')
  parts.push('')
  parts.push('Be thorough but focused on this specific system. Include file paths and code snippets as evidence.')

  return parts.join('\n')
}

// ===========================================
// Agent Output Parsing Prompt
// ===========================================

export const AGENT_OUTPUT_PARSE_SYSTEM_PROMPT = `You are a structured data extractor. Your job is to parse the output from a coding AI agent and extract it into a standardized system specification format.

## Output Format:
You MUST respond with valid JSON in this exact structure:
{
  "systemId": "string",
  "title": "string",
  "nodes": [
    {
      "id": "node_type_slug",
      "type": "UI" | "API" | "SERVICE" | "DATA" | "WORKER" | "EXTERNAL" | "DOC" | "UNKNOWN",
      "label": "Human readable name",
      "details": "Description of what this component does",
      "children": ["child_node_ids"],
      "refs": [{"evidenceId": "temp_1"}],
      "confidence": "HIGH" | "MED" | "LOW"
    }
  ],
  "edges": [
    {
      "id": "edge_source_kind_target",
      "from": "source_node_id",
      "to": "target_node_id",
      "kind": "CALLS" | "READS" | "WRITES" | "TRIGGERS" | "CONFIGURES",
      "label": "optional description",
      "refs": [{"evidenceId": "temp_2"}],
      "confidence": "HIGH" | "MED" | "LOW"
    }
  ],
  "evidence": [
    {
      "tempId": "temp_1",
      "sourceType": "AGENT",
      "sourceRef": "agent_output",
      "excerpt": "relevant code or text excerpt",
      "metadata": {
        "file_path": "path/to/file.ts",
        "symbol": "functionName",
        "line_start": 10,
        "line_end": 25
      }
    }
  ],
  "openQuestions": ["Questions that couldn't be answered"],
  "notes": ["Additional observations"]
}

## ID Generation Rules:
- Node IDs: "node_{type}_{slug}" where slug is lowercase with underscores (e.g., "node_api_auth_login")
- Edge IDs: "edge_{from}_{kind}_{to}" (e.g., "edge_node_ui_login_calls_node_api_auth")
- Evidence tempIds: "temp_1", "temp_2", etc. (will be replaced with real IDs)

## Extraction Guidelines:
1. Parse ALL components mentioned in the agent output
2. Infer relationships from code patterns (function calls, imports, database queries)
3. Extract code snippets as evidence
4. Include file paths when mentioned
5. Mark confidence based on evidence quality:
   - HIGH: Explicit in code with clear evidence
   - MED: Implied or partially shown
   - LOW: Inferred from patterns
6. Use UNKNOWN type for components you can't classify

## Component Type Identification:
- UI: React components, pages, forms, modals
- API: Route handlers, endpoints, controllers
- SERVICE: Business logic, utilities, helpers
- DATA: Database tables, models, stores
- WORKER: Background jobs, cron tasks, queue processors
- EXTERNAL: Third-party APIs, external services
- DOC: Documentation references`

export function buildAgentOutputParsePrompt(context: AgentOutputParseContext): string {
  const parts: string[] = []

  parts.push(`# Parse Agent Output for: ${context.system.name}`)
  parts.push('')
  parts.push(`**System ID:** ${context.system.id}`)
  parts.push(`**Agent Tool:** ${context.agentTool}`)
  parts.push('')

  if (context.existingFindings.length > 0) {
    parts.push('## Existing Findings (for context)')
    for (const finding of context.existingFindings.slice(0, 10)) {
      parts.push(`- ${finding.statement}`)
    }
    parts.push('')
  }

  parts.push('## Agent Output to Parse')
  parts.push('```')
  parts.push(context.agentOutput)
  parts.push('```')
  parts.push('')

  parts.push('## Your Task')
  parts.push('Parse the agent output above and extract structured system specification data.')
  parts.push('Include ALL components and relationships mentioned.')
  parts.push('Respond with the JSON format specified in your instructions.')

  return parts.join('\n')
}

// ===========================================
// Doc Generation Prompt
// ===========================================

export function buildSystemDocPrompt(
  system: System,
  graph: SystemGraph,
  evidence: Array<{
    id: string
    sourceType: EvidenceSourceType
    sourceRef: string
    excerpt: string
  }>
): string {
  const parts: string[] = []

  parts.push('You are a technical documentation writer. Generate clear, comprehensive documentation for this system.')
  parts.push('')
  parts.push(`# System: ${system.name}`)
  parts.push('')

  if (system.description) {
    parts.push('## Overview')
    parts.push(system.description)
    parts.push('')
  }

  parts.push('## Components')
  parts.push('')

  // Group nodes by type
  const nodesByType = new Map<SystemNodeType, SystemNode[]>()
  for (const node of graph.nodes) {
    const nodes = nodesByType.get(node.type) || []
    nodes.push(node)
    nodesByType.set(node.type, nodes)
  }

  for (const [type, nodes] of Array.from(nodesByType)) {
    parts.push(`### ${formatNodeType(type)}`)
    for (const node of nodes) {
      parts.push(`- **${node.label}**: ${node.details || 'No description'}`)
    }
    parts.push('')
  }

  parts.push('## Relationships')
  parts.push('')

  // Group edges by kind
  const edgesByKind = new Map<SystemEdgeKind, SystemEdge[]>()
  for (const edge of graph.edges) {
    const edges = edgesByKind.get(edge.kind) || []
    edges.push(edge)
    edgesByKind.set(edge.kind, edges)
  }

  for (const [kind, edges] of Array.from(edgesByKind)) {
    parts.push(`### ${formatEdgeKind(kind)}`)
    for (const edge of edges) {
      const fromNode = graph.nodes.find(n => n.id === edge.from)
      const toNode = graph.nodes.find(n => n.id === edge.to)
      if (fromNode && toNode) {
        const label = edge.label ? ` (${edge.label})` : ''
        parts.push(`- ${fromNode.label} → ${toNode.label}${label}`)
      }
    }
    parts.push('')
  }

  if (graph.openQuestions && graph.openQuestions.length > 0) {
    parts.push('## Open Questions')
    for (const q of graph.openQuestions) {
      parts.push(`- ${q}`)
    }
    parts.push('')
  }

  parts.push('## Task')
  parts.push('Generate comprehensive Markdown documentation that:')
  parts.push('1. Explains what this system does and why it exists')
  parts.push('2. Describes each component and its responsibilities')
  parts.push('3. Explains how components interact')
  parts.push('4. Provides guidance for developers working on this system')
  parts.push('')
  parts.push('Output clean Markdown starting with a level-2 heading (##).')

  return parts.join('\n')
}

// ===========================================
// Helper Functions
// ===========================================

function formatNodeType(type: SystemNodeType): string {
  const labels: Record<SystemNodeType, string> = {
    UI: 'User Interfaces',
    API: 'API Endpoints',
    SERVICE: 'Services',
    DATA: 'Data Stores',
    WORKER: 'Background Workers',
    EXTERNAL: 'External Services',
    DOC: 'Documentation',
    UNKNOWN: 'Unclassified',
  }
  return labels[type] || type
}

function formatEdgeKind(kind: SystemEdgeKind): string {
  const labels: Record<SystemEdgeKind, string> = {
    CALLS: 'Function Calls',
    READS: 'Data Reads',
    WRITES: 'Data Writes',
    TRIGGERS: 'Event Triggers',
    CONFIGURES: 'Configuration',
  }
  return labels[kind] || kind
}

/**
 * Validate that a SystemGraph has proper structure
 */
export function validateSystemGraph(graph: unknown): graph is SystemGraph {
  if (!graph || typeof graph !== 'object') return false

  const g = graph as Record<string, unknown>
  if (typeof g.systemId !== 'string') return false
  if (typeof g.title !== 'string') return false
  if (!Array.isArray(g.nodes)) return false
  if (!Array.isArray(g.edges)) return false

  // Validate nodes
  for (const node of g.nodes) {
    if (!node || typeof node !== 'object') return false
    const n = node as Record<string, unknown>
    if (typeof n.id !== 'string') return false
    if (typeof n.type !== 'string') return false
    if (typeof n.label !== 'string') return false
    if (!Array.isArray(n.refs)) return false
  }

  // Validate edges
  for (const edge of g.edges) {
    if (!edge || typeof edge !== 'object') return false
    const e = edge as Record<string, unknown>
    if (typeof e.id !== 'string') return false
    if (typeof e.from !== 'string') return false
    if (typeof e.to !== 'string') return false
    if (typeof e.kind !== 'string') return false
    if (!Array.isArray(e.refs)) return false
  }

  return true
}
