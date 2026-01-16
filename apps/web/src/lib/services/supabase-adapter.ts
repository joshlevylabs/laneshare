/**
 * Supabase Service Adapter
 * Connects to an external Supabase project using the Management API
 * and discovers schema metadata (tables, policies, functions, etc.)
 *
 * Uses the SQL query endpoint to introspect the database schema.
 */

import type {
  SupabaseConfig,
  SupabaseSecrets,
  SupabaseSyncStats,
  TableAssetData,
  ColumnInfo,
  ForeignKeyInfo,
  PolicyAssetData,
  FunctionAssetData,
  BucketAssetData,
} from '@/lib/supabase/supabase-service-types'
import type { ServiceAdapter, ValidationResult, SyncResult, DiscoveredAsset } from './types'

// Supabase Management API base URL
const SUPABASE_API_URL = 'https://api.supabase.com'

// System schemas to exclude from introspection
const SYSTEM_SCHEMAS = [
  'pg_catalog', 'information_schema', 'pg_toast', 'extensions',
  'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks',
  'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'vault', '_realtime', 'auth'
]

// Types for SQL query results
interface TableRow {
  table_schema: string
  table_name: string
}

interface ColumnRow {
  table_schema: string
  table_name: string
  column_name: string
  data_type: string
  udt_name: string
  is_nullable: string
  column_default: string | null
  ordinal_position: number
}

interface PrimaryKeyRow {
  table_schema: string
  table_name: string
  column_name: string
}

interface ForeignKeyRow {
  table_schema: string
  table_name: string
  column_name: string
  foreign_table_schema: string
  foreign_table_name: string
  foreign_column_name: string
}

interface PolicyRow {
  policy_name: string
  schema_name: string
  table_name: string
  command: string
  definition: string | null
  with_check: string | null
  roles: string[]
}

interface FunctionRow {
  function_name: string
  schema_name: string
  language: string
  return_type: string
  arguments: string
  is_trigger: boolean
}

interface TriggerRow {
  trigger_name: string
  schema_name: string
  table_name: string
  function_name: string
  timing: string
  event: string
}

interface BucketRow {
  id: string
  name: string
  public: boolean
  file_size_limit: number | null
  allowed_mime_types: string[] | null
}

// SQL query response type
interface QueryResponse {
  result?: unknown[]
  error?: string
}

export class SupabaseAdapter implements ServiceAdapter<SupabaseConfig, SupabaseSecrets, SupabaseSyncStats> {
  readonly serviceType = 'supabase' as const

  /**
   * Extract project ref from Supabase URL
   */
  private extractProjectRef(supabaseUrl: string): string | null {
    try {
      const hostname = new URL(supabaseUrl).hostname
      const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Make a request to the Supabase Management API
   */
  private async managementApiRequest<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<{ data: T | null; error: string | null }> {
    try {
      const response = await fetch(`${SUPABASE_API_URL}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        let errorMessage = `API error: ${response.status}`
        try {
          const errorJson = JSON.parse(errorText)
          errorMessage = errorJson.message || errorJson.error || errorMessage
        } catch {
          if (errorText) errorMessage = errorText
        }
        return { data: null, error: errorMessage }
      }

      const data = await response.json()
      return { data, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { data: null, error: message }
    }
  }

  /**
   * Execute a SQL query via the Management API
   */
  private async executeQuery<T>(
    projectRef: string,
    accessToken: string,
    sql: string
  ): Promise<{ data: T[] | null; error: string | null }> {
    const { data, error } = await this.managementApiRequest<QueryResponse>(
      `/v1/projects/${projectRef}/database/query`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ query: sql }),
      }
    )

    if (error) {
      return { data: null, error }
    }

    if (data?.error) {
      return { data: null, error: data.error }
    }

    return { data: (data?.result as T[]) || [], error: null }
  }

  /**
   * Validate the Supabase connection using Management API
   */
  async validateConnection(
    config: SupabaseConfig,
    secrets: SupabaseSecrets
  ): Promise<ValidationResult> {
    try {
      if (!secrets.access_token) {
        return {
          valid: false,
          error: 'Access token is required',
        }
      }

      const projectRef = this.extractProjectRef(config.supabase_url)
      if (!projectRef) {
        return {
          valid: false,
          error: 'Invalid Supabase URL. Expected format: https://[project-ref].supabase.co',
        }
      }

      // Validate by fetching project info
      const { data, error } = await this.managementApiRequest<{ id: string; name: string }>(
        `/v1/projects/${projectRef}`,
        secrets.access_token
      )

      if (error) {
        // Check for common auth errors
        if (error.includes('401') || error.includes('Unauthorized') || error.includes('invalid')) {
          return {
            valid: false,
            error: 'Invalid access token. Please check your Supabase access token.',
          }
        }
        if (error.includes('404') || error.includes('not found')) {
          return {
            valid: false,
            error: 'Project not found. Please check your Supabase URL or ensure you have access to this project.',
          }
        }
        return {
          valid: false,
          error: `Connection failed: ${error}`,
        }
      }

      return {
        valid: true,
        metadata: {
          supabase_url: config.supabase_url,
          project_ref: projectRef,
          project_name: data?.name,
          validated_at: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[SupabaseAdapter] Validation error:', this.redact({ error: message }))

      return {
        valid: false,
        error: `Connection failed: ${message}`,
      }
    }
  }

  /**
   * Sync all Supabase assets using Management API SQL queries
   */
  async sync(config: SupabaseConfig, secrets: SupabaseSecrets): Promise<SyncResult> {
    const assets: DiscoveredAsset[] = []
    const stats: SupabaseSyncStats = {
      tables: 0,
      columns: 0,
      policies: 0,
      functions: 0,
      triggers: 0,
      buckets: 0,
      auth_providers: 0,
    }

    try {
      if (!secrets.access_token) {
        return {
          success: false,
          assets,
          stats,
          error: 'Access token is required',
        }
      }

      const projectRef = this.extractProjectRef(config.supabase_url)
      if (!projectRef) {
        return {
          success: false,
          assets,
          stats,
          error: 'Invalid Supabase URL',
        }
      }

      console.log('[SupabaseAdapter] Syncing project:', projectRef)

      // Fetch tables and columns via SQL
      const tableAssets = await this.fetchTables(projectRef, secrets.access_token)
      assets.push(...tableAssets)
      stats.tables = tableAssets.filter((a) => a.asset_type === 'table').length
      stats.columns = tableAssets
        .filter((a) => a.asset_type === 'table')
        .reduce((sum, t) => sum + ((t.data_json as unknown as TableAssetData).columns?.length || 0), 0)

      // Fetch RLS policies via SQL
      const policyAssets = await this.fetchPolicies(projectRef, secrets.access_token)
      assets.push(...policyAssets)
      stats.policies = policyAssets.length

      // Fetch functions via SQL
      const functionAssets = await this.fetchFunctions(projectRef, secrets.access_token)
      assets.push(...functionAssets)
      stats.functions = functionAssets.length

      // Fetch triggers via SQL
      const triggerAssets = await this.fetchTriggers(projectRef, secrets.access_token)
      assets.push(...triggerAssets)
      stats.triggers = triggerAssets.length

      // Fetch storage buckets (this endpoint works)
      const bucketAssets = await this.fetchBuckets(projectRef, secrets.access_token)
      assets.push(...bucketAssets)
      stats.buckets = bucketAssets.length

      console.log('[SupabaseAdapter] Sync completed:', this.redact({ stats }))

      return {
        success: true,
        assets,
        stats,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[SupabaseAdapter] Sync error:', this.redact({ error: message }))

      return {
        success: false,
        assets,
        stats,
        error: message,
      }
    }
  }

  /**
   * Fetch tables with their columns using SQL queries
   */
  private async fetchTables(projectRef: string, accessToken: string): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []
    const schemaFilter = SYSTEM_SCHEMAS.map(s => `'${s}'`).join(', ')

    // Fetch tables
    const tablesQuery = `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN (${schemaFilter})
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `

    const { data: tables, error: tablesError } = await this.executeQuery<TableRow>(
      projectRef, accessToken, tablesQuery
    )

    if (tablesError || !tables) {
      console.log('[SupabaseAdapter] Could not fetch tables:', tablesError)
      return assets
    }

    // Fetch columns
    const columnsQuery = `
      SELECT table_schema, table_name, column_name, data_type, udt_name,
             is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema NOT IN (${schemaFilter})
      ORDER BY table_schema, table_name, ordinal_position
    `

    const { data: columns } = await this.executeQuery<ColumnRow>(
      projectRef, accessToken, columnsQuery
    )

    // Fetch primary keys
    const pkQuery = `
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN (${schemaFilter})
      ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position
    `

    const { data: primaryKeys } = await this.executeQuery<PrimaryKeyRow>(
      projectRef, accessToken, pkQuery
    )

    // Fetch foreign keys
    const fkQuery = `
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN (${schemaFilter})
    `

    const { data: foreignKeys } = await this.executeQuery<ForeignKeyRow>(
      projectRef, accessToken, fkQuery
    )

    // Build column map by table
    const columnMap = new Map<string, ColumnRow[]>()
    for (const col of columns || []) {
      const key = `${col.table_schema}.${col.table_name}`
      if (!columnMap.has(key)) columnMap.set(key, [])
      columnMap.get(key)!.push(col)
    }

    // Build primary key map by table
    const pkMap = new Map<string, string[]>()
    for (const pk of primaryKeys || []) {
      const key = `${pk.table_schema}.${pk.table_name}`
      if (!pkMap.has(key)) pkMap.set(key, [])
      pkMap.get(key)!.push(pk.column_name)
    }

    // Build foreign key map by table
    const fkMap = new Map<string, ForeignKeyRow[]>()
    for (const fk of foreignKeys || []) {
      const key = `${fk.table_schema}.${fk.table_name}`
      if (!fkMap.has(key)) fkMap.set(key, [])
      fkMap.get(key)!.push(fk)
    }

    // Build table assets
    for (const table of tables) {
      const tableKey = `${table.table_schema}.${table.table_name}`
      const tableCols = columnMap.get(tableKey) || []
      const tablePks = pkMap.get(tableKey) || []
      const tableFks = fkMap.get(tableKey) || []

      const columnInfos: ColumnInfo[] = tableCols.map((col, index) => ({
        name: col.column_name,
        data_type: col.udt_name || col.data_type,
        udt_name: col.udt_name,
        is_nullable: col.is_nullable === 'YES',
        column_default: col.column_default || undefined,
        ordinal_position: col.ordinal_position ?? index + 1,
        is_primary_key: tablePks.includes(col.column_name),
      }))

      const foreignKeyInfos: ForeignKeyInfo[] = tableFks.map((fk) => ({
        column: fk.column_name,
        references_table: `${fk.foreign_table_schema}.${fk.foreign_table_name}`,
        references_column: fk.foreign_column_name,
      }))

      const tableData: TableAssetData = {
        schema: table.table_schema,
        name: table.table_name,
        columns: columnInfos,
        primary_key: tablePks.length > 0 ? tablePks : undefined,
        foreign_keys: foreignKeyInfos.length > 0 ? foreignKeyInfos : undefined,
      }

      assets.push({
        asset_type: 'table',
        asset_key: tableKey,
        name: table.table_name,
        data_json: tableData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Fetch RLS policies using SQL query
   */
  private async fetchPolicies(projectRef: string, accessToken: string): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []
    const schemaFilter = SYSTEM_SCHEMAS.map(s => `'${s}'`).join(', ')

    const query = `
      SELECT
        pol.polname AS policy_name,
        nsp.nspname AS schema_name,
        cls.relname AS table_name,
        CASE pol.polcmd
          WHEN 'r' THEN 'SELECT'
          WHEN 'a' THEN 'INSERT'
          WHEN 'w' THEN 'UPDATE'
          WHEN 'd' THEN 'DELETE'
          WHEN '*' THEN 'ALL'
        END AS command,
        pg_get_expr(pol.polqual, pol.polrelid, true) AS definition,
        pg_get_expr(pol.polwithcheck, pol.polrelid, true) AS with_check,
        ARRAY(
          SELECT rolname
          FROM pg_roles
          WHERE oid = ANY(pol.polroles)
        ) AS roles
      FROM pg_policy pol
      JOIN pg_class cls ON pol.polrelid = cls.oid
      JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
      WHERE nsp.nspname NOT IN (${schemaFilter})
      ORDER BY nsp.nspname, cls.relname, pol.polname
    `

    const { data: policies, error } = await this.executeQuery<PolicyRow>(
      projectRef, accessToken, query
    )

    if (error || !policies) {
      console.log('[SupabaseAdapter] Could not fetch policies:', error)
      return assets
    }

    for (const policy of policies) {
      const policyKey = `${policy.schema_name}.${policy.table_name}.${policy.policy_name}`

      const policyData: PolicyAssetData = {
        name: policy.policy_name,
        table_name: policy.table_name,
        schema: policy.schema_name,
        command: policy.command,
        permissive: true, // Default to permissive
        roles: policy.roles || [],
        using_expression: policy.definition || undefined,
        check_expression: policy.with_check || undefined,
      }

      assets.push({
        asset_type: 'policy',
        asset_key: policyKey,
        name: policy.policy_name,
        data_json: policyData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Fetch functions using SQL query
   */
  private async fetchFunctions(projectRef: string, accessToken: string): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []
    const schemaFilter = SYSTEM_SCHEMAS.map(s => `'${s}'`).join(', ')

    const query = `
      SELECT
        p.proname AS function_name,
        n.nspname AS schema_name,
        l.lanname AS language,
        pg_get_function_result(p.oid) AS return_type,
        pg_get_function_identity_arguments(p.oid) AS arguments,
        CASE
          WHEN p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype THEN true
          ELSE false
        END AS is_trigger
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname NOT IN (${schemaFilter})
        AND p.prokind = 'f'
      ORDER BY n.nspname, p.proname
      LIMIT 500
    `

    const { data: functions, error } = await this.executeQuery<FunctionRow>(
      projectRef, accessToken, query
    )

    if (error || !functions) {
      console.log('[SupabaseAdapter] Could not fetch functions:', error)
      return assets
    }

    for (const func of functions) {
      const funcKey = `${func.schema_name}.${func.function_name}(${func.arguments || ''})`

      const funcData: FunctionAssetData = {
        name: func.function_name,
        schema: func.schema_name,
        language: func.language,
        return_type: func.return_type,
        argument_types: func.arguments || undefined,
      }

      assets.push({
        asset_type: func.is_trigger ? 'trigger' : 'function',
        asset_key: funcKey,
        name: func.function_name,
        data_json: funcData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Fetch triggers using SQL query
   */
  private async fetchTriggers(projectRef: string, accessToken: string): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []
    const schemaFilter = SYSTEM_SCHEMAS.map(s => `'${s}'`).join(', ')

    const query = `
      SELECT
        t.tgname AS trigger_name,
        n.nspname AS schema_name,
        c.relname AS table_name,
        p.proname AS function_name,
        CASE t.tgtype & 66
          WHEN 2 THEN 'BEFORE'
          WHEN 64 THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END AS timing,
        CASE t.tgtype & 28
          WHEN 4 THEN 'INSERT'
          WHEN 8 THEN 'DELETE'
          WHEN 16 THEN 'UPDATE'
          WHEN 20 THEN 'INSERT OR UPDATE'
          WHEN 12 THEN 'INSERT OR DELETE'
          WHEN 24 THEN 'UPDATE OR DELETE'
          WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
        END AS event
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE NOT t.tgisinternal
        AND n.nspname NOT IN (${schemaFilter})
      ORDER BY n.nspname, c.relname, t.tgname
    `

    const { data: triggers, error } = await this.executeQuery<TriggerRow>(
      projectRef, accessToken, query
    )

    if (error || !triggers) {
      console.log('[SupabaseAdapter] Could not fetch triggers:', error)
      return assets
    }

    for (const trigger of triggers) {
      const triggerKey = `${trigger.schema_name}.${trigger.table_name}.${trigger.trigger_name}`

      assets.push({
        asset_type: 'trigger',
        asset_key: triggerKey,
        name: trigger.trigger_name,
        data_json: {
          name: trigger.trigger_name,
          schema: trigger.schema_name,
          table_name: trigger.table_name,
          function_name: trigger.function_name,
          timing: trigger.timing,
          event: trigger.event,
        },
      })
    }

    return assets
  }

  /**
   * Fetch storage buckets using Management API
   */
  private async fetchBuckets(projectRef: string, accessToken: string): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    const { data: buckets, error } = await this.managementApiRequest<BucketRow[]>(
      `/v1/projects/${projectRef}/storage/buckets`,
      accessToken
    )

    if (error || !buckets) {
      console.log('[SupabaseAdapter] Could not fetch buckets:', error)
      return assets
    }

    for (const bucket of buckets) {
      const bucketData: BucketAssetData = {
        id: bucket.id,
        name: bucket.name,
        public: bucket.public,
        file_size_limit: bucket.file_size_limit || undefined,
        allowed_mime_types: bucket.allowed_mime_types || undefined,
      }

      assets.push({
        asset_type: 'bucket',
        asset_key: `bucket:${bucket.id}`,
        name: bucket.name,
        data_json: bucketData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Redact sensitive information for safe logging
   */
  redact<T extends Record<string, unknown>>(obj: T): T {
    const redacted = { ...obj }
    const sensitiveKeys = ['access_token', 'service_role_key', 'key', 'token', 'secret', 'password', 'apiKey', 'api_key']

    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        redacted[key as keyof T] = '[REDACTED]' as T[keyof T]
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key as keyof T] = this.redact(redacted[key] as Record<string, unknown>) as T[keyof T]
      }
    }

    return redacted
  }
}

/**
 * Factory function to create a new SupabaseAdapter instance
 */
export function createSupabaseAdapter(): SupabaseAdapter {
  return new SupabaseAdapter()
}
