// ===========================================
// SYSTEM MAP TYPES
// Types for the manual flowchart builder feature
// ===========================================

// ===========================================
// ENUMS
// ===========================================

export type SystemStatus = 'DRAFT' | 'ACTIVE'

export type SystemNodeType =
  | 'UI'
  | 'API'
  | 'SERVICE'
  | 'DATA'
  | 'WORKER'
  | 'EXTERNAL'

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
  status: SystemStatus
  created_by: string
  created_at: string
  updated_at: string
  // Computed/joined fields
  node_count?: number
  latest_snapshot?: SystemFlowSnapshot
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

// ===========================================
// SYSTEM GRAPH
// ===========================================

export interface SystemGraph {
  systemId: string
  title: string
  nodes: SystemNode[]
  edges: SystemEdge[]
}

export interface SystemNode {
  id: string
  type: SystemNodeType
  label: string
  details?: string
  position?: NodePosition
}

export interface SystemEdge {
  id: string
  from: string
  to: string
  kind: SystemEdgeKind
  label?: string
}

export interface NodePosition {
  x: number
  y: number
}

// ===========================================
// API TYPES
// ===========================================

export interface CreateSystemInput {
  name: string
  description?: string
}

export interface UpdateSystemInput {
  name?: string
  description?: string
}

export interface SaveFlowchartInput {
  nodes: SystemNode[]
  edges: SystemEdge[]
}

// ===========================================
// HELPERS
// ===========================================

/**
 * Generate a unique node ID
 */
export function generateNodeId(type: SystemNodeType, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50)
  const timestamp = Date.now().toString(36)
  return `node_${type.toLowerCase()}_${slug}_${timestamp}`
}

/**
 * Generate a unique edge ID
 */
export function generateEdgeId(from: string, to: string, kind: SystemEdgeKind): string {
  const timestamp = Date.now().toString(36)
  return `edge_${from}_${kind.toLowerCase()}_${to}_${timestamp}`
}

/**
 * Normalize a node ID (for compatibility)
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
 * Normalize an edge ID (for compatibility)
 */
export function normalizeEdgeId(from: string, to: string, kind: SystemEdgeKind): string {
  return `edge_${from}_${kind.toLowerCase()}_${to}`
}

// ===========================================
// CONSTANTS
// ===========================================

export const NODE_TYPE_CONFIG: Record<SystemNodeType, { label: string; color: string; icon: string; description: string }> = {
  UI: {
    label: 'User Interface',
    color: '#3b82f6',
    icon: 'Monitor',
    description: 'Pages, screens, and frontend components'
  },
  API: {
    label: 'API Endpoint',
    color: '#10b981',
    icon: 'Server',
    description: 'REST/GraphQL endpoints and handlers'
  },
  SERVICE: {
    label: 'Service',
    color: '#8b5cf6',
    icon: 'Layers',
    description: 'Business logic and service modules'
  },
  DATA: {
    label: 'Data Store',
    color: '#ef4444',
    icon: 'Database',
    description: 'Databases, caches, and storage'
  },
  WORKER: {
    label: 'Background Worker',
    color: '#f59e0b',
    icon: 'Cog',
    description: 'Background jobs and scheduled tasks'
  },
  EXTERNAL: {
    label: 'External Service',
    color: '#6b7280',
    icon: 'Cloud',
    description: 'Third-party APIs and services'
  },
}

export const EDGE_KIND_CONFIG: Record<SystemEdgeKind, { label: string; color: string; dashed: boolean; description: string }> = {
  CALLS: {
    label: 'Calls',
    color: '#3b82f6',
    dashed: false,
    description: 'Makes a function call or API request'
  },
  READS: {
    label: 'Reads',
    color: '#10b981',
    dashed: false,
    description: 'Reads data from a source'
  },
  WRITES: {
    label: 'Writes',
    color: '#f59e0b',
    dashed: false,
    description: 'Writes data to a destination'
  },
  TRIGGERS: {
    label: 'Triggers',
    color: '#8b5cf6',
    dashed: true,
    description: 'Triggers an event or action'
  },
  CONFIGURES: {
    label: 'Configures',
    color: '#6b7280',
    dashed: true,
    description: 'Provides configuration to'
  },
}
