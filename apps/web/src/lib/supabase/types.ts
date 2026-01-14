export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          is_pro: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          is_pro?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          is_pro?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      projects: {
        Row: {
          id: string
          owner_id: string
          name: string
          description: string | null
          settings: ProjectSettings | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          description?: string | null
          settings?: ProjectSettings | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          description?: string | null
          settings?: ProjectSettings | null
          created_at?: string
          updated_at?: string
        }
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          user_id: string
          role: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
          role?: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
          role?: 'OWNER' | 'MAINTAINER' | 'MEMBER'
          created_at?: string
        }
      }
      github_connections: {
        Row: {
          id: string
          user_id: string
          provider: string
          access_token_encrypted: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider?: string
          access_token_encrypted: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          access_token_encrypted?: string
          created_at?: string
          updated_at?: string
        }
      }
      repos: {
        Row: {
          id: string
          project_id: string
          provider: string
          owner: string
          name: string
          default_branch: string
          installed_at: string
          last_synced_at: string | null
          status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error: string | null
        }
        Insert: {
          id?: string
          project_id: string
          provider?: string
          owner: string
          name: string
          default_branch?: string
          installed_at?: string
          last_synced_at?: string | null
          status?: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          provider?: string
          owner?: string
          name?: string
          default_branch?: string
          installed_at?: string
          last_synced_at?: string | null
          status?: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'
          sync_error?: string | null
        }
      }
      repo_files: {
        Row: {
          id: string
          repo_id: string
          path: string
          sha: string
          size: number
          language: string | null
          last_indexed_at: string | null
        }
        Insert: {
          id?: string
          repo_id: string
          path: string
          sha: string
          size: number
          language?: string | null
          last_indexed_at?: string | null
        }
        Update: {
          id?: string
          repo_id?: string
          path?: string
          sha?: string
          size?: number
          language?: string | null
          last_indexed_at?: string | null
        }
      }
      chunks: {
        Row: {
          id: string
          repo_id: string
          file_path: string
          chunk_index: number
          content: string
          token_count: number
          embedding: number[] | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          repo_id: string
          file_path: string
          chunk_index: number
          content: string
          token_count: number
          embedding?: number[] | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          repo_id?: string
          file_path?: string
          chunk_index?: number
          content?: string
          token_count?: number
          embedding?: number[] | null
          metadata?: Json
          created_at?: string
        }
      }
      sprints: {
        Row: {
          id: string
          project_id: string
          name: string
          start_date: string | null
          end_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          name: string
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          name?: string
          start_date?: string | null
          end_date?: string | null
          created_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id: string | null
          repo_scope: string[] | null
          priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          description?: string | null
          status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id?: string | null
          repo_scope?: string[] | null
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          description?: string | null
          status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE'
          assignee_id?: string | null
          repo_scope?: string[] | null
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
          sprint_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
      }
      task_updates: {
        Row: {
          id: string
          task_id: string
          content: string
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          task_id: string
          content: string
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          content?: string
          source?: string
          created_by?: string | null
          created_at?: string
        }
      }
      chat_threads: {
        Row: {
          id: string
          project_id: string
          created_by: string
          title: string
          task_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          created_by: string
          title?: string
          task_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          created_by?: string
          title?: string
          task_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      chat_messages: {
        Row: {
          id: string
          thread_id: string
          sender: 'USER' | 'LANEPILOT'
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          sender: 'USER' | 'LANEPILOT'
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          thread_id?: string
          sender?: 'USER' | 'LANEPILOT'
          content?: string
          created_at?: string
        }
      }
      prompt_artifacts: {
        Row: {
          id: string
          project_id: string
          task_id: string | null
          thread_id: string | null
          kind: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          task_id?: string | null
          thread_id?: string | null
          kind: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          task_id?: string | null
          thread_id?: string | null
          kind?: 'CONTEXT_PACK' | 'AGENT_PROMPT' | 'DOC_UPDATE'
          content?: string
          created_by?: string
          created_at?: string
        }
      }
      doc_pages: {
        Row: {
          id: string
          project_id: string
          slug: string
          title: string
          markdown: string
          category: 'architecture' | 'features' | 'decisions' | 'status'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          slug: string
          title: string
          markdown?: string
          category: 'architecture' | 'features' | 'decisions' | 'status'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          slug?: string
          title?: string
          markdown?: string
          category?: 'architecture' | 'features' | 'decisions' | 'status'
          created_at?: string
          updated_at?: string
        }
      }
      decision_logs: {
        Row: {
          id: string
          project_id: string
          title: string
          context: string
          decision: string
          consequences: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          context: string
          decision: string
          consequences?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          context?: string
          decision?: string
          consequences?: string | null
          created_by?: string | null
          created_at?: string
        }
      }
      project_invitations: {
        Row: {
          id: string
          project_id: string
          token: string
          role: 'MAINTAINER' | 'MEMBER'
          created_by: string
          accepted_by: string | null
          status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
          expires_at: string
          created_at: string
          accepted_at: string | null
        }
        Insert: {
          id?: string
          project_id: string
          token: string
          role?: 'MAINTAINER' | 'MEMBER'
          created_by: string
          accepted_by?: string | null
          status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
          expires_at: string
          created_at?: string
          accepted_at?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          token?: string
          role?: 'MAINTAINER' | 'MEMBER'
          created_by?: string
          accepted_by?: string | null
          status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
          expires_at?: string
          created_at?: string
          accepted_at?: string | null
        }
      }
      project_service_connections: {
        Row: {
          id: string
          project_id: string
          service: 'supabase' | 'vercel'
          display_name: string
          status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'WARNING'
          config_json: Json
          secret_encrypted: string
          last_synced_at: string | null
          last_sync_error: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          service: 'supabase' | 'vercel'
          display_name: string
          status?: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'WARNING'
          config_json?: Json
          secret_encrypted: string
          last_synced_at?: string | null
          last_sync_error?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          service?: 'supabase' | 'vercel'
          display_name?: string
          status?: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'WARNING'
          config_json?: Json
          secret_encrypted?: string
          last_synced_at?: string | null
          last_sync_error?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      service_assets: {
        Row: {
          id: string
          project_id: string
          connection_id: string
          service: 'supabase' | 'vercel'
          asset_type: string
          asset_key: string
          name: string
          data_json: Json
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          connection_id: string
          service: 'supabase' | 'vercel'
          asset_type: string
          asset_key: string
          name: string
          data_json?: Json
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          connection_id?: string
          service?: 'supabase' | 'vercel'
          asset_type?: string
          asset_key?: string
          name?: string
          data_json?: Json
          updated_at?: string
        }
      }
      service_sync_runs: {
        Row: {
          id: string
          project_id: string
          connection_id: string
          started_at: string
          finished_at: string | null
          status: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'WARNING'
          stats_json: Json
          error: string | null
          triggered_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          connection_id: string
          started_at?: string
          finished_at?: string | null
          status?: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'WARNING'
          stats_json?: Json
          error?: string | null
          triggered_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          connection_id?: string
          started_at?: string
          finished_at?: string | null
          status?: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'WARNING'
          stats_json?: Json
          error?: string | null
          triggered_by?: string | null
          created_at?: string
        }
      }
    }
    Functions: {
      is_project_member: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_project_admin: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      search_chunks: {
        Args: {
          p_project_id: string
          p_query_embedding: number[]
          p_match_count?: number
          p_match_threshold?: number
        }
        Returns: {
          id: string
          repo_id: string
          file_path: string
          content: string
          chunk_index: number
          similarity: number
          repo_owner: string
          repo_name: string
        }[]
      }
      keyword_search_chunks: {
        Args: {
          p_project_id: string
          p_query: string
          p_match_count?: number
        }
        Returns: {
          id: string
          repo_id: string
          file_path: string
          content: string
          chunk_index: number
          repo_owner: string
          repo_name: string
        }[]
      }
      get_valid_invitation: {
        Args: { p_token: string }
        Returns: {
          id: string
          project_id: string
          role: 'MAINTAINER' | 'MEMBER'
          project_name: string
        }[]
      }
      is_service_connection_admin: {
        Args: { p_connection_id: string }
        Returns: boolean
      }
    }
  }
}

// ===============================================
// CONNECTED SERVICES TYPES
// ===============================================

export type ServiceType = 'supabase' | 'vercel' | 'openapi'
export type ServiceConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'WARNING'
export type ServiceSyncStatus = 'RUNNING' | 'SUCCESS' | 'ERROR' | 'WARNING'

// Supabase-specific asset types
export type SupabaseAssetType =
  | 'table'
  | 'column'
  | 'policy'
  | 'function'
  | 'trigger'
  | 'bucket'
  | 'auth_provider'

// Vercel-specific asset types
export type VercelAssetType =
  | 'vercel_project'
  | 'deployment'
  | 'domain'
  | 'env_var'

// OpenAPI-specific asset types
export type OpenApiAssetType =
  | 'openapi_spec'
  | 'endpoint'
  | 'schema'
  | 'security_scheme'

export type ServiceAssetType = SupabaseAssetType | VercelAssetType | OpenApiAssetType

// Configuration types for each service
export interface SupabaseConfig {
  supabase_url: string
  project_ref?: string
}

export interface VercelConfig {
  team_id?: string
  team_slug?: string
  project_ids?: string[]
}

export interface OpenApiConfig {
  openapi_url: string
  api_name?: string
  api_slug?: string
  format_hint?: 'json' | 'yaml' | 'auto'
  normalize_base_url?: boolean
  spec_fingerprint?: string
  spec_version?: string
  spec_title?: string
}

export type ServiceConfig = SupabaseConfig | VercelConfig | OpenApiConfig

// Secret types for each service (what gets encrypted)
export interface SupabaseSecrets {
  access_token: string
}

export interface VercelSecrets {
  token: string
}

export interface OpenApiSecrets {
  headers?: Record<string, string>
}

export type ServiceSecrets = SupabaseSecrets | VercelSecrets | OpenApiSecrets

// Stats from sync operations
export interface SupabaseSyncStats {
  tables: number
  columns: number
  policies: number
  functions: number
  triggers: number
  buckets: number
  auth_providers: number
}

export interface VercelSyncStats {
  projects: number
  deployments: number
  domains: number
  env_vars: number
}

export interface OpenApiSyncStats {
  endpoints: number
  schemas: number
  tags: number
  security_schemes: number
  spec_version?: string
  spec_title?: string
  base_url?: string
  spec_fingerprint?: string
}

export type ServiceSyncStats = SupabaseSyncStats | VercelSyncStats | OpenApiSyncStats

// Asset data payloads
export interface TableAssetData {
  schema: string
  name: string
  columns: ColumnInfo[]
  primary_key?: string[]
  foreign_keys?: ForeignKeyInfo[]
  row_count?: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default_value?: string
  is_primary_key?: boolean
}

export interface ForeignKeyInfo {
  column: string
  references_table: string
  references_column: string
}

export interface PolicyAssetData {
  name: string
  table_name: string
  schema: string
  command: string // SELECT, INSERT, UPDATE, DELETE, ALL
  definition: string
  check?: string
  roles: string[]
}

export interface FunctionAssetData {
  name: string
  schema: string
  language: string
  return_type: string
  arguments: string
  definition?: string
  is_trigger: boolean
}

export interface BucketAssetData {
  id: string
  name: string
  public: boolean
  file_size_limit?: number
  allowed_mime_types?: string[]
}

export interface AuthProviderAssetData {
  provider: string
  enabled: boolean
}

export interface VercelProjectAssetData {
  id: string
  name: string
  framework?: string
  git_repo?: {
    repo: string
    type: string
  }
}

export interface DeploymentAssetData {
  uid: string
  name: string
  url: string
  state: string
  created_at: string
  ready_at?: string
  source?: string
  target?: string
}

export interface DomainAssetData {
  name: string
  project_id: string
  verified: boolean
  configured: boolean
}

export interface EnvVarAssetData {
  key: string
  target: string[] // production, preview, development
  type: string // plain, encrypted, secret
  // Never store the value!
}

// ===============================================
// OPENAPI ASSET DATA TYPES
// ===============================================

export interface OpenApiSpecAssetData {
  title: string
  version: string
  description?: string
  base_url?: string
  servers?: Array<{ url: string; description?: string }>
  openapi_version: string // '3.0.0', '3.1.0', '2.0' (swagger)
  spec_fingerprint: string
  endpoint_count: number
  schema_count: number
  tag_count: number
  security_scheme_count: number
  tags?: Array<{ name: string; description?: string }>
}

export interface OpenApiEndpointAssetData {
  method: string // GET, POST, PUT, DELETE, PATCH, etc.
  path: string
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
  security?: Array<Record<string, string[]>>
}

export interface OpenApiParameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiSchemaRef
  deprecated?: boolean
}

export interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchemaRef }>
}

export interface OpenApiResponse {
  description?: string
  content?: Record<string, { schema?: OpenApiSchemaRef }>
}

export interface OpenApiSchemaRef {
  type?: string
  format?: string
  $ref?: string
  items?: OpenApiSchemaRef
  properties?: Record<string, OpenApiSchemaRef>
  required?: string[]
  description?: string
  enum?: string[]
  example?: unknown
}

export interface OpenApiSchemaAssetData {
  name: string
  type?: string
  description?: string
  properties?: Record<string, OpenApiSchemaRef>
  required?: string[]
  enum?: string[]
}

export interface OpenApiSecuritySchemeAssetData {
  name: string
  type: string // apiKey, http, oauth2, openIdConnect
  description?: string
  in?: string // query, header, cookie (for apiKey)
  scheme?: string // bearer, basic (for http)
  bearerFormat?: string
}

// ===============================================
// PROJECT SETTINGS
// ===============================================

export type AIModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-5' | 'o1' | 'o1-mini'

export interface ProjectSettings {
  ai_model: AIModel
}
