// Architecture Map Types

export const ANALYZER_VERSION = '1.0.0'

// ===========================================
// Node Types
// ===========================================

export type NodeType =
  | 'repo'
  | 'app'
  | 'screen'
  | 'endpoint'
  | 'worker'
  | 'table'
  | 'function'
  | 'storage'
  | 'auth'
  | 'external_service'
  | 'deployment'
  | 'package'

export interface BaseNode {
  id: string
  type: NodeType
  label: string
  repoId?: string
  metadata: Record<string, unknown>
}

export interface RepoNode extends BaseNode {
  type: 'repo'
  metadata: {
    owner: string
    name: string
    provider: string
    defaultBranch: string
    framework?: string // next, express, etc.
    language?: string
  }
}

export interface AppNode extends BaseNode {
  type: 'app'
  metadata: {
    repoId: string
    appPath: string // e.g., 'apps/web'
    framework: string
    hasApiRoutes: boolean
    hasPages: boolean
  }
}

export interface ScreenNode extends BaseNode {
  type: 'screen'
  metadata: {
    route: string
    filePath: string
    dynamic: boolean
    layout?: string
    feature?: string
  }
}

export interface EndpointNode extends BaseNode {
  type: 'endpoint'
  metadata: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL'
    route: string
    filePath: string
    feature?: string
  }
}

export interface WorkerNode extends BaseNode {
  type: 'worker'
  metadata: {
    trigger: 'cron' | 'webhook' | 'queue' | 'manual'
    schedule?: string
    filePath: string
  }
}

export interface TableNode extends BaseNode {
  type: 'table'
  metadata: {
    schema: string
    columns: Array<{ name: string; type: string; nullable: boolean }>
    hasRls: boolean
    policies: string[]
    migrationFile?: string
  }
}

export interface FunctionNode extends BaseNode {
  type: 'function'
  metadata: {
    schema: string
    language: string
    securityDefiner: boolean
    migrationFile?: string
  }
}

export interface StorageNode extends BaseNode {
  type: 'storage'
  metadata: {
    provider: 'supabase' | 's3' | 'gcs'
    bucket?: string
    isPublic: boolean
  }
}

export interface AuthNode extends BaseNode {
  type: 'auth'
  metadata: {
    provider: 'supabase' | 'auth0' | 'nextauth'
    providers: string[] // oauth providers
    hasRoleSystem: boolean
  }
}

export interface ExternalServiceNode extends BaseNode {
  type: 'external_service'
  metadata: {
    domain: string
    apiType: 'rest' | 'graphql' | 'grpc' | 'unknown'
    envVar?: string
  }
}

export interface DeploymentNode extends BaseNode {
  type: 'deployment'
  metadata: {
    platform: 'vercel' | 'netlify' | 'railway' | 'fly' | 'aws' | 'unknown'
    region?: string
    envVars: string[]
  }
}

export interface PackageNode extends BaseNode {
  type: 'package'
  metadata: {
    name: string
    version: string
    isDevDep: boolean
    category: 'framework' | 'database' | 'ui' | 'utility' | 'testing' | 'other'
  }
}

export type ArchNode =
  | RepoNode
  | AppNode
  | ScreenNode
  | EndpointNode
  | WorkerNode
  | TableNode
  | FunctionNode
  | StorageNode
  | AuthNode
  | ExternalServiceNode
  | DeploymentNode
  | PackageNode

// ===========================================
// Edge Types
// ===========================================

export type EdgeType =
  | 'contains'        // repo contains app, app contains screen
  | 'navigates_to'    // screen navigates to screen
  | 'calls'           // screen/endpoint calls endpoint
  | 'reads'           // endpoint reads table
  | 'writes'          // endpoint writes table
  | 'uses_function'   // endpoint uses DB function
  | 'authenticates'   // screen/endpoint uses auth
  | 'stores'          // endpoint stores to storage
  | 'deploys_to'      // app deploys to deployment
  | 'depends_on'      // package dependency
  | 'calls_external'  // calls external service

export type Confidence = 'high' | 'medium' | 'low'

export interface ArchEdge {
  id: string
  source: string // node ID
  target: string // node ID
  type: EdgeType
  label?: string
  confidence: Confidence
  evidenceIds: string[]
  metadata: Record<string, unknown>
}

// ===========================================
// Evidence Types
// ===========================================

export type EvidenceKind =
  | 'ROUTE_DEF'
  | 'API_HANDLER'
  | 'PAGE_COMPONENT'
  | 'DB_TABLE'
  | 'DB_FUNCTION'
  | 'SQL_MIGRATION'
  | 'ENV_VAR'
  | 'FETCH_CALL'
  | 'SUPABASE_CLIENT'
  | 'VERCEL_CONFIG'
  | 'PACKAGE_DEP'
  | 'IMPORT_STMT'
  | 'EXTERNAL_API'
  | 'COMPONENT_USAGE'
  | 'RLS_POLICY'

export interface Evidence {
  id: string
  kind: EvidenceKind
  nodeId: string
  edgeId?: string
  repoId?: string
  filePath?: string
  symbol?: string
  lineStart?: number
  lineEnd?: number
  excerpt?: string
  url?: string
  confidence: Confidence
  metadata: Record<string, unknown>
}

// ===========================================
// Feature Types
// ===========================================

export interface FlowStep {
  order: number
  type: 'screen' | 'action' | 'api_call' | 'db_operation' | 'external_call'
  nodeId: string
  label: string
  description?: string
  evidenceIds: string[]
}

export interface Feature {
  slug: string
  name: string
  description?: string
  flow: FlowStep[]
  screens: string[]   // node IDs
  endpoints: string[] // node IDs
  tables: string[]    // node IDs
  services: string[]  // node IDs
}

// ===========================================
// Graph Types
// ===========================================

export interface ArchitectureGraph {
  version: string
  generatedAt: string
  nodes: ArchNode[]
  edges: ArchEdge[]
  features: Feature[]
}

export interface ArchitectureSummary {
  nodeCount: {
    total: number
    byType: Record<NodeType, number>
  }
  edgeCount: {
    total: number
    byType: Record<EdgeType, number>
    byConfidence: Record<Confidence, number>
  }
  featureCount: number
  coverageStats: {
    screensWithEndpoints: number
    endpointsWithTables: number
    tablesWithRls: number
  }
  repos: Array<{ id: string; name: string; nodeCount: number }>
}

// ===========================================
// Snapshot Types (DB representations)
// ===========================================

export interface ArchitectureSnapshot {
  id: string
  project_id: string
  generated_at: string
  analyzer_version: string
  source_fingerprint: string
  graph_json: ArchitectureGraph
  summary_json: ArchitectureSummary
  status: 'pending' | 'analyzing' | 'completed' | 'error'
  error_message?: string
  created_by?: string
  created_at: string
}

export interface ArchitectureEvidence {
  id: string
  project_id: string
  snapshot_id: string
  kind: EvidenceKind
  node_id: string
  edge_id?: string
  repo_id?: string
  file_path?: string
  symbol?: string
  line_start?: number
  line_end?: number
  excerpt?: string
  url?: string
  confidence: Confidence
  metadata: Record<string, unknown>
  created_at: string
}

export interface ArchitectureFeatureRow {
  id: string
  snapshot_id: string
  project_id: string
  feature_slug: string
  feature_name: string
  description?: string
  flow_json: FlowStep[]
  screens: string[]
  endpoints: string[]
  tables: string[]
  services: string[]
  created_at: string
}

// ===========================================
// Analysis Context Types
// ===========================================

export interface RepoContext {
  id: string
  projectId: string
  owner: string
  name: string
  provider: string
  defaultBranch: string
  files: Array<{
    path: string
    sha: string
    language?: string
  }>
}

export interface AnalysisContext {
  projectId: string
  repos: RepoContext[]
  existingChunks: Map<string, string> // filePath -> content
}

export interface AnalyzerPassResult {
  nodes: ArchNode[]
  edges: ArchEdge[]
  evidence: Evidence[]
}
