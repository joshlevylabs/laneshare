/**
 * Supabase Service Adapter Types
 * These types define the structure of data stored in service_assets for Supabase connections
 * (connecting to external Supabase projects via the Management API)
 */

// Supabase Configuration stored in project_service_connections.config_json
export interface SupabaseConfig {
  supabase_url: string
  project_name?: string
  project_ref?: string
}

// Supabase Secrets stored in project_service_connections.secret_encrypted
export interface SupabaseSecrets {
  service_role_key?: string
  access_token?: string
}

// Sync statistics for Supabase connections
export interface SupabaseSyncStats {
  tables: number
  columns: number
  policies: number
  functions: number
  triggers: number
  buckets: number
  auth_providers: number
}

// Column information for table assets
export interface ColumnInfo {
  name: string
  data_type: string
  udt_name?: string
  is_nullable: boolean
  column_default?: string | null
  ordinal_position: number
  is_primary_key?: boolean
  foreign_key?: ForeignKeyInfo
}

// Foreign key information
export interface ForeignKeyInfo {
  references_table: string
  references_column: string
  references_schema?: string
}

// Asset data for table type (stored in service_assets.data_json)
export interface TableAssetData {
  schema: string
  name: string
  columns?: ColumnInfo[]
  primary_key?: string[]
  row_count?: number
  has_rls?: boolean
}

// Asset data for policy type (stored in service_assets.data_json)
export interface PolicyAssetData {
  name: string
  table_name: string
  schema: string
  command: string
  permissive: boolean
  roles: string[]
  using_expression?: string
  check_expression?: string
}

// Asset data for function type (stored in service_assets.data_json)
export interface FunctionAssetData {
  name: string
  schema: string
  return_type: string
  argument_types?: string
  language: string
  volatility?: string
  security_definer?: boolean
}

// Asset data for bucket type (stored in service_assets.data_json)
export interface BucketAssetData {
  name: string
  id: string
  public: boolean
  file_size_limit?: number
  allowed_mime_types?: string[]
  created_at?: string
}

// Vercel types for the service adapter

// Vercel Configuration stored in project_service_connections.config_json
export interface VercelConfig {
  project_id?: string
  project_ids?: string[]
  project_name?: string
  team_id?: string
  team_slug?: string
}

// Vercel Secrets stored in project_service_connections.secret_encrypted
export interface VercelSecrets {
  access_token?: string
  token?: string
}

// Sync statistics for Vercel connections
export interface VercelSyncStats {
  deployments: number
  domains: number
  env_vars: number
}

// Asset data for Vercel project type
export interface VercelProjectAssetData {
  name: string
  framework?: string
  node_version?: string
  build_command?: string
  output_directory?: string
  root_directory?: string
  created_at?: string
  updated_at?: string
}

// Asset data for deployment type
export interface DeploymentAssetData {
  id: string
  url?: string
  state: string
  ready_state?: string
  created_at?: string
  building_at?: string
  ready?: string
  target?: string
  meta?: Record<string, unknown>
}

// Asset data for domain type
export interface DomainAssetData {
  name: string
  verified: boolean
  created_at?: string
  configured_by?: string
}

// Asset data for environment variable type
export interface EnvVarAssetData {
  key: string
  target: string[]
  type: string
  created_at?: string
  updated_at?: string
}

// Service type union
export type ServiceType = 'supabase' | 'vercel' | 'openapi' | 'github'
