/**
 * Supabase Service Adapter
 * Connects to an external Supabase project and discovers schema metadata
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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
} from '@/lib/supabase/types'
import type { ServiceAdapter, ValidationResult, SyncResult, DiscoveredAsset } from './types'

// SQL queries for introspection
const TABLES_QUERY = `
  SELECT
    t.table_schema,
    t.table_name,
    t.table_type
  FROM information_schema.tables t
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime')
    AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_schema, t.table_name
`

const COLUMNS_QUERY = `
  SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default,
    c.ordinal_position
  FROM information_schema.columns c
  WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime')
  ORDER BY c.table_schema, c.table_name, c.ordinal_position
`

const PRIMARY_KEYS_QUERY = `
  SELECT
    kcu.table_schema,
    kcu.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
  ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position
`

const FOREIGN_KEYS_QUERY = `
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
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions')
`

const POLICIES_QUERY = `
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
  WHERE nsp.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime')
  ORDER BY nsp.nspname, cls.relname, pol.polname
`

const FUNCTIONS_QUERY = `
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
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'realtime', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime')
    AND p.prokind = 'f'
  ORDER BY n.nspname, p.proname
  LIMIT 500
`

const TRIGGERS_QUERY = `
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
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'realtime', 'supabase_functions', 'supabase_migrations', 'vault', '_realtime')
  ORDER BY n.nspname, c.relname, t.tgname
`

export class SupabaseAdapter implements ServiceAdapter<SupabaseConfig, SupabaseSecrets, SupabaseSyncStats> {
  readonly serviceType = 'supabase' as const

  /**
   * Validate the Supabase connection
   */
  async validateConnection(
    config: SupabaseConfig,
    secrets: SupabaseSecrets
  ): Promise<ValidationResult> {
    try {
      const client = this.createClient(config.supabase_url, secrets.service_role_key)

      // Try a simple query to validate the connection
      const { error } = await client.from('_validation_check_').select('*').limit(1)

      // We expect an error (table doesn't exist), but it should be a specific type
      // If we get an auth error, the credentials are invalid
      if (error) {
        // If the error is about the table not existing, that's fine - credentials work
        if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
          return {
            valid: true,
            metadata: {
              supabase_url: config.supabase_url,
              validated_at: new Date().toISOString(),
            },
          }
        }

        // Auth/permission errors mean invalid credentials
        if (error.code === 'PGRST301' || error.message.includes('JWT') || error.message.includes('unauthorized')) {
          return {
            valid: false,
            error: 'Invalid service role key. Please check your credentials.',
          }
        }
      }

      // Connection successful
      return {
        valid: true,
        metadata: {
          supabase_url: config.supabase_url,
          validated_at: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      // Never log the actual key
      console.error('[SupabaseAdapter] Validation error:', this.redact({ error: message }))

      return {
        valid: false,
        error: `Connection failed: ${message}`,
      }
    }
  }

  /**
   * Sync all Supabase assets
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
    const warnings: string[] = []

    try {
      const client = this.createClient(config.supabase_url, secrets.service_role_key)

      // Check what introspection method is available
      const introspectionMethod = await this.checkIntrospectionAvailable(client)
      if (!introspectionMethod) {
        warnings.push(
          'Schema introspection requires setup. ' +
          'Tables, policies, and functions could not be discovered. ' +
          'Run the LaneShare setup SQL in your connected project. ' +
          'See documentation for instructions.'
        )
      }

      // Fetch tables and columns
      const tableAssets = await this.fetchTables(client, introspectionMethod)
      assets.push(...tableAssets)
      stats.tables = tableAssets.filter((a) => a.asset_type === 'table').length
      stats.columns = tableAssets
        .filter((a) => a.asset_type === 'table')
        .reduce((sum, t) => sum + ((t.data_json as unknown as TableAssetData).columns?.length || 0), 0)

      // Fetch RLS policies
      const policyAssets = await this.fetchPolicies(client, introspectionMethod)
      assets.push(...policyAssets)
      stats.policies = policyAssets.length

      // Fetch functions
      const functionAssets = await this.fetchFunctions(client, introspectionMethod)
      assets.push(...functionAssets)
      stats.functions = functionAssets.filter((a) => !(a.data_json as unknown as FunctionAssetData).is_trigger).length
      stats.triggers = functionAssets.filter((a) => (a.data_json as unknown as FunctionAssetData).is_trigger).length

      // Fetch storage buckets
      const bucketAssets = await this.fetchBuckets(client)
      assets.push(...bucketAssets)
      stats.buckets = bucketAssets.length

      // Fetch triggers
      const triggerAssets = await this.fetchTriggers(client, introspectionMethod)
      assets.push(...triggerAssets)
      stats.triggers += triggerAssets.length

      console.log('[SupabaseAdapter] Sync completed:', this.redact({ stats }))

      return {
        success: true,
        assets,
        stats,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[SupabaseAdapter] Sync error:', this.redact({ error: message }))

      return {
        success: false,
        assets,
        stats,
        error: message,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    }
  }

  /**
   * Check if introspection is available (views or RPC)
   */
  private async checkIntrospectionAvailable(client: SupabaseClient): Promise<'views' | 'rpc' | null> {
    // First try views (preferred - no schema cache issues)
    const { data: viewData, error: viewError } = await client
      .from('_laneshare_tables')
      .select('*')
      .limit(1)

    if (!viewError) {
      console.log('[SupabaseAdapter] Introspection views available')
      return 'views'
    }
    console.log('[SupabaseAdapter] Views not available:', viewError.message)

    // Fall back to RPC
    const { data: rpcData, error: rpcError } = await client.rpc('exec_sql', {
      query: 'SELECT 1 as test',
    }).maybeSingle()

    if (!rpcError) {
      console.log('[SupabaseAdapter] RPC function available')
      return 'rpc'
    }
    console.log('[SupabaseAdapter] RPC check failed:', rpcError.message, 'Code:', rpcError.code)

    return null
  }

  /**
   * Redact sensitive information for safe logging
   */
  redact<T extends Record<string, unknown>>(obj: T): T {
    const redacted = { ...obj }
    const sensitiveKeys = ['service_role_key', 'key', 'token', 'secret', 'password', 'apiKey', 'api_key']

    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
        redacted[key as keyof T] = '[REDACTED]' as T[keyof T]
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key as keyof T] = this.redact(redacted[key] as Record<string, unknown>) as T[keyof T]
      }
    }

    return redacted
  }

  /**
   * Create a Supabase client for the external project
   */
  private createClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  /**
   * Fetch tables with their columns, primary keys, and foreign keys
   */
  private async fetchTables(client: SupabaseClient, method: 'views' | 'rpc' | null): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    if (!method) {
      console.log('[SupabaseAdapter] No introspection method available for tables')
      return assets
    }

    let tableRows: Array<{ table_schema: string; table_name: string }> = []

    if (method === 'views') {
      // Use views approach
      const { data: tables, error } = await client
        .from('_laneshare_tables')
        .select('*')

      if (error) {
        console.log('[SupabaseAdapter] Error fetching tables via view:', error.message)
        return assets
      }
      tableRows = tables || []
    } else {
      // Use RPC approach
      const { data: tables, error: tablesError } = await client.rpc('exec_sql', {
        query: TABLES_QUERY,
      }).maybeSingle()

      if (tablesError || !tables) {
        console.log('[SupabaseAdapter] RPC not available for tables')
        return assets
      }

      if (Array.isArray(tables)) {
        tableRows = tables
      } else if (tables && typeof tables === 'object' && 'rows' in tables) {
        tableRows = (tables as { rows: Array<{ table_schema: string; table_name: string }> }).rows
      }
    }

    // Fetch columns
    let columnRows: Array<{
      table_schema: string
      table_name: string
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
    }> = []

    if (method === 'views') {
      const { data } = await client.from('_laneshare_columns').select('*')
      columnRows = data || []
    } else {
      const { data: columnsData } = await client.rpc('exec_sql', {
        query: COLUMNS_QUERY,
      }).maybeSingle()
      columnRows = Array.isArray(columnsData) ? columnsData :
        (columnsData && typeof columnsData === 'object' && 'rows' in columnsData)
          ? (columnsData as { rows: typeof columnRows }).rows
          : []
    }

    // Fetch primary keys
    let pkRows: Array<{
      table_schema: string
      table_name: string
      column_name: string
    }> = []

    if (method === 'views') {
      const { data } = await client.from('_laneshare_primary_keys').select('*')
      pkRows = data || []
    } else {
      const { data: pkData } = await client.rpc('exec_sql', {
        query: PRIMARY_KEYS_QUERY,
      }).maybeSingle()
      pkRows = Array.isArray(pkData) ? pkData :
        (pkData && typeof pkData === 'object' && 'rows' in pkData)
          ? (pkData as { rows: typeof pkRows }).rows
          : []
    }

    // Fetch foreign keys
    let fkRows: Array<{
      table_schema: string
      table_name: string
      column_name: string
      foreign_table_schema: string
      foreign_table_name: string
      foreign_column_name: string
    }> = []

    if (method === 'views') {
      const { data } = await client.from('_laneshare_foreign_keys').select('*')
      fkRows = data || []
    } else {
      const { data: fkData } = await client.rpc('exec_sql', {
        query: FOREIGN_KEYS_QUERY,
      }).maybeSingle()
      fkRows = Array.isArray(fkData) ? fkData :
        (fkData && typeof fkData === 'object' && 'rows' in fkData)
          ? (fkData as { rows: typeof fkRows }).rows
          : []
    }

    // Build table assets with columns
    for (const table of tableRows) {
      const tableKey = `${table.table_schema}.${table.table_name}`

      // Get columns for this table
      const tableColumns = columnRows.filter(
        (c) => c.table_schema === table.table_schema && c.table_name === table.table_name
      )

      // Get primary keys for this table
      const tablePks = pkRows
        .filter((pk) => pk.table_schema === table.table_schema && pk.table_name === table.table_name)
        .map((pk) => pk.column_name)

      // Get foreign keys for this table
      const tableFks: ForeignKeyInfo[] = fkRows
        .filter((fk) => fk.table_schema === table.table_schema && fk.table_name === table.table_name)
        .map((fk) => ({
          column: fk.column_name,
          references_table: `${fk.foreign_table_schema}.${fk.foreign_table_name}`,
          references_column: fk.foreign_column_name,
        }))

      // Build column info
      const columns: ColumnInfo[] = tableColumns.map((col) => ({
        name: col.column_name,
        type: col.udt_name || col.data_type,
        nullable: col.is_nullable === 'YES',
        default_value: col.column_default || undefined,
        is_primary_key: tablePks.includes(col.column_name),
      }))

      const tableData: TableAssetData = {
        schema: table.table_schema,
        name: table.table_name,
        columns,
        primary_key: tablePks.length > 0 ? tablePks : undefined,
        foreign_keys: tableFks.length > 0 ? tableFks : undefined,
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
   * Fetch RLS policies
   */
  private async fetchPolicies(client: SupabaseClient, method: 'views' | 'rpc' | null): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    if (!method) return assets

    let rows: Array<{
      policy_name: string
      schema_name: string
      table_name: string
      command: string
      definition: string | null
      with_check: string | null
      roles: string[]
    }> = []

    if (method === 'views') {
      const { data, error } = await client.from('_laneshare_policies').select('*')
      if (error) {
        console.log('[SupabaseAdapter] Could not fetch policies via view:', error.message)
        return assets
      }
      rows = data || []
    } else {
      const { data, error } = await client.rpc('exec_sql', {
        query: POLICIES_QUERY,
      }).maybeSingle()

      if (error) {
        console.log('[SupabaseAdapter] Could not fetch policies:', error.message)
        return assets
      }

      rows = Array.isArray(data) ? data :
        (data && typeof data === 'object' && 'rows' in data)
          ? (data as { rows: typeof rows }).rows
          : []
    }

    for (const row of rows) {
      const policyKey = `${row.schema_name}.${row.table_name}.${row.policy_name}`

      const policyData: PolicyAssetData = {
        name: row.policy_name,
        table_name: row.table_name,
        schema: row.schema_name,
        command: row.command,
        definition: row.definition || '',
        check: row.with_check || undefined,
        roles: row.roles || [],
      }

      assets.push({
        asset_type: 'policy',
        asset_key: policyKey,
        name: row.policy_name,
        data_json: policyData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Fetch functions (including trigger functions)
   */
  private async fetchFunctions(client: SupabaseClient, method: 'views' | 'rpc' | null): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    if (!method) return assets

    let rows: Array<{
      function_name: string
      schema_name: string
      language: string
      return_type: string
      arguments: string
      is_trigger: boolean
    }> = []

    if (method === 'views') {
      const { data, error } = await client.from('_laneshare_functions').select('*')
      if (error) {
        console.log('[SupabaseAdapter] Could not fetch functions via view:', error.message)
        return assets
      }
      rows = data || []
    } else {
      const { data, error } = await client.rpc('exec_sql', {
        query: FUNCTIONS_QUERY,
      }).maybeSingle()

      if (error) {
        console.log('[SupabaseAdapter] Could not fetch functions:', error.message)
        return assets
      }

      rows = Array.isArray(data) ? data :
        (data && typeof data === 'object' && 'rows' in data)
          ? (data as { rows: typeof rows }).rows
          : []
    }

    for (const row of rows) {
      const funcKey = `${row.schema_name}.${row.function_name}(${row.arguments})`

      const funcData: FunctionAssetData = {
        name: row.function_name,
        schema: row.schema_name,
        language: row.language,
        return_type: row.return_type,
        arguments: row.arguments,
        is_trigger: row.is_trigger,
      }

      assets.push({
        asset_type: row.is_trigger ? 'trigger' : 'function',
        asset_key: funcKey,
        name: row.function_name,
        data_json: funcData as unknown as Record<string, unknown>,
      })
    }

    return assets
  }

  /**
   * Fetch triggers
   */
  private async fetchTriggers(client: SupabaseClient, method: 'views' | 'rpc' | null): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    if (!method) return assets

    let rows: Array<{
      trigger_name: string
      schema_name: string
      table_name: string
      function_name: string
      timing: string
      event: string
    }> = []

    if (method === 'views') {
      const { data, error } = await client.from('_laneshare_triggers').select('*')
      if (error) {
        console.log('[SupabaseAdapter] Could not fetch triggers via view:', error.message)
        return assets
      }
      rows = data || []
    } else {
      const { data, error } = await client.rpc('exec_sql', {
        query: TRIGGERS_QUERY,
      }).maybeSingle()

      if (error) {
        console.log('[SupabaseAdapter] Could not fetch triggers:', error.message)
        return assets
      }

      rows = Array.isArray(data) ? data :
        (data && typeof data === 'object' && 'rows' in data)
        ? (data as { rows: typeof rows }).rows
        : []
    }

    for (const row of rows) {
      const triggerKey = `${row.schema_name}.${row.table_name}.${row.trigger_name}`

      assets.push({
        asset_type: 'trigger',
        asset_key: triggerKey,
        name: row.trigger_name,
        data_json: {
          name: row.trigger_name,
          schema: row.schema_name,
          table_name: row.table_name,
          function_name: row.function_name,
          timing: row.timing,
          event: row.event,
        },
      })
    }

    return assets
  }

  /**
   * Fetch storage buckets
   */
  private async fetchBuckets(client: SupabaseClient): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = []

    try {
      const { data: buckets, error } = await client.storage.listBuckets()

      if (error) {
        console.log('[SupabaseAdapter] Could not fetch buckets:', error.message)
        return assets
      }

      for (const bucket of buckets || []) {
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
    } catch (error) {
      console.log('[SupabaseAdapter] Bucket access not available')
    }

    return assets
  }
}

/**
 * Factory function to create a new SupabaseAdapter instance
 */
export function createSupabaseAdapter(): SupabaseAdapter {
  return new SupabaseAdapter()
}
