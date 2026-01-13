// ===========================================
// SYSTEM MAP TYPES
// Types for the hierarchical system documentation feature
// ===========================================

// ===========================================
// ENUMS
// ===========================================

export type SystemStatus = 'DRAFT' | 'NEEDS_AGENT_OUTPUT' | 'GROUNDED' | 'NEEDS_REVIEW'

export type ArtifactKind =
  | 'USER_BRIEF'
  | 'GROUNDED_FINDINGS'
  | 'AGENT_PROMPT'
  | 'AGENT_OUTPUT'
  | 'SYSTEM_SPEC'
  | 'FLOW_SNAPSHOT'
  | 'DOC_UPDATE'

export type EvidenceSourceType = 'DOC' | 'REPO' | 'AGENT'

export type EvidenceConfidence = 'HIGH' | 'MED' | 'LOW'

export type SystemNodeType =
  | 'UI'
  | 'API'
  | 'SERVICE'
  | 'DATA'
  | 'WORKER'
  | 'EXTERNAL'
  | 'DOC'
  | 'UNKNOWN'

export type SystemEdgeKind =
  | 'CALLS'
  | 'READS'
  | 'WRITES'
  | 'TRIGGERS'
  | 'CONFIGURES'

// ===========================================
// DATABASE ENTITIES
// ===========================================

export interface System {
  id: string
  project_id: string
  name: string
  slug: string
  description?: string
  in_scope?: string
  out_of_scope?: string
  keywords: string[]
  repo_ids: string[]
  status: SystemStatus
  created_by: string
  created_at: string
  updated_at: string
  // Computed/joined fields
  node_count?: number
  verified_count?: number
  latest_snapshot?: SystemFlowSnapshot
}

export interface SystemArtifact {
  id: string
  project_id: string
  system_id: string
  kind: ArtifactKind
  content: string
  content_json?: Record<string, unknown>
  created_by: string
  created_at: string
}

export interface SystemEvidence {
  id: string
  project_id: string
  system_id: string
  source_type: EvidenceSourceType
  source_ref: string
  excerpt: string
  metadata: EvidenceMetadata
  confidence: EvidenceConfidence
  created_at: string
}

export interface EvidenceMetadata {
  file_path?: string
  symbol?: string
  line_start?: number
  line_end?: number
  url?: string
  doc_slug?: string
  doc_title?: string
  repo_name?: string
  artifact_id?: string
}

export interface SystemFlowSnapshot {
  id: string
  project_id: string
  system_id: string
  version: number
  graph_json: SystemGraph
  generated_at: string
  generated_by: string
  notes?: string
}

export interface SystemNodeVerification {
  id: string
  project_id: string
  system_id: string
  node_id: string
  is_verified: boolean
  verified_by?: string
  verified_at?: string
  notes?: string
}

// ===========================================
// SYSTEM SPEC (GROUNDED GRAPH)
// ===========================================

export interface SystemGraph {
  systemId: string
  title: string
  nodes: SystemNode[]
  edges: SystemEdge[]
  layout?: GraphLayout
  notes?: string[]
  openQuestions?: string[]
}

export interface SystemNode {
  id: string
  type: SystemNodeType
  label: string
  details?: string
  children?: string[] // IDs of child nodes for hierarchy
  refs: EvidenceRef[]
  confidence: EvidenceConfidence
  position?: NodePosition
  collapsed?: boolean
}

export interface SystemEdge {
  id: string
  from: string
  to: string
  kind: SystemEdgeKind
  label?: string
  refs: EvidenceRef[]
  confidence: EvidenceConfidence
}

export interface EvidenceRef {
  evidenceId: string
}

export interface NodePosition {
  x: number
  y: number
}

export interface GraphLayout {
  direction: 'TB' | 'LR' | 'BT' | 'RL'
  swimlanes?: SwimlaneDef[]
}

export interface SwimlaneDef {
  id: string
  label: string
  nodeTypes: SystemNodeType[]
}

// ===========================================
// API TYPES
// ===========================================

export interface CreateSystemInput {
  name: string
  description?: string
  in_scope?: string
  out_of_scope?: string
  keywords?: string[]
  repo_ids?: string[]
}

export interface UpdateSystemInput {
  name?: string
  description?: string
  in_scope?: string
  out_of_scope?: string
  keywords?: string[]
  repo_ids?: string[]
  status?: SystemStatus
}

export interface AnalyzeSystemInput {
  include_repos?: boolean
  include_docs?: boolean
  keywords_override?: string[]
}

export interface AnalyzeSystemResult {
  groundedFindings: GroundedFinding[]
  openQuestions: string[]
  agentPrompt: string
  evidence: Omit<SystemEvidence, 'id' | 'project_id' | 'system_id' | 'created_at'>[]
  artifactIds: {
    findings: string
    prompt: string
  }
}

export interface GroundedFinding {
  statement: string
  confidence: EvidenceConfidence
  citations: Citation[]
}

export interface Citation {
  type: EvidenceSourceType
  ref: string
  excerpt: string
}

export interface AgentOutputInput {
  agentTool: 'cursor' | 'claude-code' | 'copilot' | 'aider' | 'windsurf' | 'other'
  output: string
}

export interface AgentOutputResult {
  artifactId: string
  systemSpec: SystemGraph
  snapshotId: string
  docPageId?: string
  candidateNodes: CandidateNode[]
  candidateEdges: CandidateEdge[]
}

export interface CandidateNode {
  id: string
  type: SystemNodeType
  label: string
  details?: string
  source: 'agent' | 'doc' | 'repo'
  confidence: EvidenceConfidence
  evidenceIds: string[]
  accepted: boolean
}

export interface CandidateEdge {
  id: string
  from: string
  to: string
  kind: SystemEdgeKind
  label?: string
  source: 'agent' | 'doc' | 'repo'
  confidence: EvidenceConfidence
  evidenceIds: string[]
  accepted: boolean
}

export interface RegenerateFlowInput {
  includeAgentOutput?: boolean
  forceRebuild?: boolean
}

export interface RegenerateFlowResult {
  snapshotId: string
  version: number
  nodesAdded: number
  nodesRemoved: number
  edgesAdded: number
  edgesRemoved: number
  graph: SystemGraph
}

export interface VerifyNodeInput {
  nodeId: string
  isVerified: boolean
  notes?: string
}

export interface SystemDiff {
  fromVersion: number
  toVersion: number
  nodesAdded: SystemNode[]
  nodesRemoved: SystemNode[]
  nodesModified: { before: SystemNode; after: SystemNode }[]
  edgesAdded: SystemEdge[]
  edgesRemoved: SystemEdge[]
  edgesModified: { before: SystemEdge; after: SystemEdge }[]
}

// ===========================================
// VALIDATION HELPERS
// ===========================================

/**
 * Validate that a node has at least one evidence reference
 */
export function isNodeGrounded(node: SystemNode): boolean {
  return node.refs.length > 0
}

/**
 * Validate that an edge has at least one evidence reference
 */
export function isEdgeGrounded(edge: SystemEdge): boolean {
  return edge.refs.length > 0
}

/**
 * Validate an entire system graph for grounding
 */
export function validateGraphGrounding(graph: SystemGraph): {
  valid: boolean
  ungroundedNodes: string[]
  ungroundedEdges: string[]
} {
  const ungroundedNodes = graph.nodes
    .filter((n) => !isNodeGrounded(n))
    .map((n) => n.id)

  const ungroundedEdges = graph.edges
    .filter((e) => !isEdgeGrounded(e))
    .map((e) => e.id)

  return {
    valid: ungroundedNodes.length === 0 && ungroundedEdges.length === 0,
    ungroundedNodes,
    ungroundedEdges,
  }
}

/**
 * Normalize a node ID to be consistent across generations
 */
export function normalizeNodeId(type: SystemNodeType, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50)
  return `node_${type.toLowerCase()}_${slug}`
}

/**
 * Normalize an edge ID
 */
export function normalizeEdgeId(from: string, to: string, kind: SystemEdgeKind): string {
  return `edge_${from}_${kind.toLowerCase()}_${to}`
}

/**
 * Calculate confidence score based on evidence sources
 */
export function calculateConfidence(
  sources: Array<{ type: EvidenceSourceType; confidence?: EvidenceConfidence }>
): EvidenceConfidence {
  if (sources.length === 0) return 'LOW'

  const hasRepoHigh = sources.some(
    (s) => s.type === 'REPO' && (s.confidence === 'HIGH' || !s.confidence)
  )
  const hasDocHigh = sources.some(
    (s) => s.type === 'DOC' && (s.confidence === 'HIGH' || !s.confidence)
  )
  const hasAgentOnly = sources.every((s) => s.type === 'AGENT')

  if (hasRepoHigh) return 'HIGH'
  if (hasDocHigh && !hasAgentOnly) return 'HIGH'
  if (hasDocHigh) return 'MED'
  if (hasAgentOnly) return 'LOW'

  return 'MED'
}

/**
 * Deduplicate nodes by normalized ID
 */
export function deduplicateNodes(nodes: SystemNode[]): SystemNode[] {
  const seen = new Map<string, SystemNode>()

  for (const node of nodes) {
    const normalizedId = normalizeNodeId(node.type, node.label)
    const existing = seen.get(normalizedId)

    if (!existing) {
      seen.set(normalizedId, { ...node, id: normalizedId })
    } else {
      // Merge refs and keep higher confidence
      const mergedRefs = [...existing.refs]
      for (const ref of node.refs) {
        if (!mergedRefs.some((r) => r.evidenceId === ref.evidenceId)) {
          mergedRefs.push(ref)
        }
      }

      const confOrder = { HIGH: 3, MED: 2, LOW: 1 }
      const newConf =
        confOrder[node.confidence] > confOrder[existing.confidence]
          ? node.confidence
          : existing.confidence

      seen.set(normalizedId, {
        ...existing,
        refs: mergedRefs,
        confidence: newConf,
        details: existing.details || node.details,
        children: Array.from(new Set([...(existing.children || []), ...(node.children || [])])),
      })
    }
  }

  return Array.from(seen.values())
}

/**
 * Deduplicate edges by normalized ID
 */
export function deduplicateEdges(edges: SystemEdge[]): SystemEdge[] {
  const seen = new Map<string, SystemEdge>()

  for (const edge of edges) {
    const normalizedId = normalizeEdgeId(edge.from, edge.to, edge.kind)
    const existing = seen.get(normalizedId)

    if (!existing) {
      seen.set(normalizedId, { ...edge, id: normalizedId })
    } else {
      // Merge refs and keep higher confidence
      const mergedRefs = [...existing.refs]
      for (const ref of edge.refs) {
        if (!mergedRefs.some((r) => r.evidenceId === ref.evidenceId)) {
          mergedRefs.push(ref)
        }
      }

      const confOrder = { HIGH: 3, MED: 2, LOW: 1 }
      const newConf =
        confOrder[edge.confidence] > confOrder[existing.confidence]
          ? edge.confidence
          : existing.confidence

      seen.set(normalizedId, {
        ...existing,
        refs: mergedRefs,
        confidence: newConf,
        label: existing.label || edge.label,
      })
    }
  }

  return Array.from(seen.values())
}

// ===========================================
// CONSTANTS
// ===========================================

export const NODE_TYPE_CONFIG: Record<SystemNodeType, { label: string; color: string; icon: string }> = {
  UI: { label: 'User Interface', color: '#3b82f6', icon: 'Monitor' },
  API: { label: 'API Endpoint', color: '#10b981', icon: 'Server' },
  SERVICE: { label: 'Service', color: '#8b5cf6', icon: 'Layers' },
  DATA: { label: 'Data Store', color: '#ef4444', icon: 'Database' },
  WORKER: { label: 'Background Worker', color: '#f59e0b', icon: 'Cog' },
  EXTERNAL: { label: 'External Service', color: '#6b7280', icon: 'Cloud' },
  DOC: { label: 'Documentation', color: '#06b6d4', icon: 'FileText' },
  UNKNOWN: { label: 'Needs Verification', color: '#9ca3af', icon: 'HelpCircle' },
}

export const EDGE_KIND_CONFIG: Record<SystemEdgeKind, { label: string; color: string; dashed: boolean }> = {
  CALLS: { label: 'Calls', color: '#3b82f6', dashed: false },
  READS: { label: 'Reads', color: '#10b981', dashed: false },
  WRITES: { label: 'Writes', color: '#f59e0b', dashed: false },
  TRIGGERS: { label: 'Triggers', color: '#8b5cf6', dashed: true },
  CONFIGURES: { label: 'Configures', color: '#6b7280', dashed: true },
}

export const CONFIDENCE_CONFIG: Record<EvidenceConfidence, { label: string; color: string }> = {
  HIGH: { label: 'High Confidence', color: '#10b981' },
  MED: { label: 'Medium Confidence', color: '#f59e0b' },
  LOW: { label: 'Low Confidence', color: '#ef4444' },
}
