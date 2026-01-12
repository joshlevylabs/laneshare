/**
 * Service Documentation Generator
 * Generates documentation pages from connected service assets
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ServiceType,
  TableAssetData,
  PolicyAssetData,
  FunctionAssetData,
  BucketAssetData,
  VercelProjectAssetData,
  DeploymentAssetData,
  DomainAssetData,
  EnvVarAssetData,
  SupabaseSyncStats,
  VercelSyncStats,
} from '@/lib/supabase/types'

interface DocGenerationResult {
  pages: { slug: string; title: string; markdown: string }[]
  errors: string[]
}

/**
 * Main entry point for service documentation generation.
 * Called after a service sync completes successfully.
 */
export async function runServiceDocGeneration(
  projectId: string,
  serviceType: ServiceType,
  supabase: SupabaseClient
): Promise<DocGenerationResult> {
  const result: DocGenerationResult = { pages: [], errors: [] }

  console.log(`[ServiceDocGen] Starting documentation generation for ${serviceType}`)

  try {
    // Get the connection info
    const { data: connection } = await supabase
      .from('project_service_connections')
      .select('id, display_name, last_synced_at, config_json')
      .eq('project_id', projectId)
      .eq('service', serviceType)
      .single()

    if (!connection) {
      result.errors.push(`No ${serviceType} connection found`)
      return result
    }

    // Get all assets for this connection
    const { data: assets } = await supabase
      .from('service_assets')
      .select('asset_type, asset_key, name, data_json')
      .eq('connection_id', connection.id)
      .order('asset_type')
      .order('name')

    if (!assets || assets.length === 0) {
      result.errors.push('No assets found')
      return result
    }

    // Generate docs based on service type
    if (serviceType === 'supabase') {
      const supabaseDocs = generateSupabaseDocs(
        assets as Array<{
          asset_type: string
          asset_key: string
          name: string
          data_json: Record<string, unknown>
        }>,
        connection.display_name,
        connection.last_synced_at,
        connection.config_json as { supabase_url: string; project_ref?: string }
      )

      for (const doc of supabaseDocs) {
        await upsertDocPage(supabase, projectId, doc.slug, doc.title, doc.category, doc.markdown)
        result.pages.push({ slug: doc.slug, title: doc.title, markdown: doc.markdown })
      }
    } else if (serviceType === 'vercel') {
      const vercelDocs = generateVercelDocs(
        assets as Array<{
          asset_type: string
          asset_key: string
          name: string
          data_json: Record<string, unknown>
        }>,
        connection.display_name,
        connection.last_synced_at,
        connection.config_json as { team_id?: string; team_slug?: string }
      )

      for (const doc of vercelDocs) {
        await upsertDocPage(supabase, projectId, doc.slug, doc.title, doc.category, doc.markdown)
        result.pages.push({ slug: doc.slug, title: doc.title, markdown: doc.markdown })
      }
    }

    // Update the data model doc with Supabase tables
    if (serviceType === 'supabase') {
      const dataModelDoc = generateDataModelDoc(
        assets.filter((a) => a.asset_type === 'table') as Array<{
          asset_type: string
          asset_key: string
          name: string
          data_json: TableAssetData
        }>,
        connection.last_synced_at
      )

      await upsertDocPage(
        supabase,
        projectId,
        'architecture/data-model',
        'Data Model',
        'architecture',
        dataModelDoc
      )
      result.pages.push({
        slug: 'architecture/data-model',
        title: 'Data Model',
        markdown: dataModelDoc,
      })
    }

    // Trigger architecture map regeneration with debounce
    await triggerMapRegeneration(supabase, projectId, serviceType)

    console.log(`[ServiceDocGen] Generated ${result.pages.length} pages for ${serviceType}`)
    return result
  } catch (error) {
    const errorMsg = `Service doc generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    console.error(`[ServiceDocGen] ${errorMsg}`)
    result.errors.push(errorMsg)
    return result
  }
}

/**
 * Generate Supabase documentation pages
 */
function generateSupabaseDocs(
  assets: Array<{
    asset_type: string
    asset_key: string
    name: string
    data_json: Record<string, unknown>
  }>,
  displayName: string,
  lastSyncedAt: string | null,
  config: { supabase_url: string; project_ref?: string }
): Array<{ slug: string; title: string; category: 'architecture' | 'services'; markdown: string }> {
  const docs: Array<{
    slug: string
    title: string
    category: 'architecture' | 'services'
    markdown: string
  }> = []

  // Group assets by type
  const tables = assets.filter((a) => a.asset_type === 'table')
  const policies = assets.filter((a) => a.asset_type === 'policy')
  const functions = assets.filter((a) => a.asset_type === 'function')
  const triggers = assets.filter((a) => a.asset_type === 'trigger')
  const buckets = assets.filter((a) => a.asset_type === 'bucket')

  const syncDate = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Never'

  // Main Supabase overview doc
  let supabaseDoc = `# Supabase: ${displayName}

> Auto-generated from connected Supabase project. Last synced: ${syncDate}

## Connection Details

- **Project URL:** ${config.supabase_url}
${config.project_ref ? `- **Project Ref:** ${config.project_ref}` : ''}

## Summary

| Asset Type | Count |
|------------|-------|
| Tables | ${tables.length} |
| RLS Policies | ${policies.length} |
| Functions | ${functions.length} |
| Triggers | ${triggers.length} |
| Storage Buckets | ${buckets.length} |

## Tables

`

  for (const table of tables) {
    const data = table.data_json as unknown as TableAssetData
    const columnCount = data.columns?.length || 0
    supabaseDoc += `### ${data.schema}.${data.name}

- **Columns:** ${columnCount}
${data.primary_key ? `- **Primary Key:** ${data.primary_key.join(', ')}` : ''}
${data.foreign_keys && data.foreign_keys.length > 0 ? `- **Foreign Keys:** ${data.foreign_keys.length}` : ''}

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
${data.columns
  .map(
    (col) =>
      `| ${col.name}${col.is_primary_key ? ' 🔑' : ''} | ${col.type} | ${col.nullable ? 'Yes' : 'No'} | ${col.default_value || '-'} |`
  )
  .join('\n')}

`
  }

  // Add RLS policies section
  if (policies.length > 0) {
    supabaseDoc += `## Row Level Security Policies

| Policy | Table | Command | Roles |
|--------|-------|---------|-------|
`
    for (const policy of policies) {
      const data = policy.data_json as unknown as PolicyAssetData
      supabaseDoc += `| ${data.name} | ${data.schema}.${data.table_name} | ${data.command} | ${data.roles.join(', ') || 'public'} |\n`
    }
    supabaseDoc += '\n'
  }

  // Add functions section
  if (functions.length > 0) {
    supabaseDoc += `## Functions

| Function | Schema | Language | Returns |
|----------|--------|----------|---------|
`
    for (const func of functions) {
      const data = func.data_json as unknown as FunctionAssetData
      supabaseDoc += `| ${data.name} | ${data.schema} | ${data.language} | ${data.return_type} |\n`
    }
    supabaseDoc += '\n'
  }

  // Add triggers section
  if (triggers.length > 0) {
    supabaseDoc += `## Triggers

| Trigger | Table | Timing | Event |
|---------|-------|--------|-------|
`
    for (const trigger of triggers) {
      const data = trigger.data_json as Record<string, unknown>
      supabaseDoc += `| ${data.name || trigger.name} | ${data.table_name || '-'} | ${data.timing || '-'} | ${data.event || '-'} |\n`
    }
    supabaseDoc += '\n'
  }

  // Add storage buckets section
  if (buckets.length > 0) {
    supabaseDoc += `## Storage Buckets

| Bucket | Public | File Size Limit |
|--------|--------|-----------------|
`
    for (const bucket of buckets) {
      const data = bucket.data_json as unknown as BucketAssetData
      const sizeLimit = data.file_size_limit
        ? `${Math.round(data.file_size_limit / 1024 / 1024)}MB`
        : 'Default'
      supabaseDoc += `| ${data.name} | ${data.public ? 'Yes' : 'No'} | ${sizeLimit} |\n`
    }
    supabaseDoc += '\n'
  }

  docs.push({
    slug: 'architecture/supabase',
    title: `Supabase: ${displayName}`,
    category: 'architecture',
    markdown: supabaseDoc,
  })

  return docs
}

/**
 * Generate Vercel documentation pages
 */
function generateVercelDocs(
  assets: Array<{
    asset_type: string
    asset_key: string
    name: string
    data_json: Record<string, unknown>
  }>,
  displayName: string,
  lastSyncedAt: string | null,
  config: { team_id?: string; team_slug?: string }
): Array<{ slug: string; title: string; category: 'architecture' | 'services'; markdown: string }> {
  const docs: Array<{
    slug: string
    title: string
    category: 'architecture' | 'services'
    markdown: string
  }> = []

  // Group assets by type
  const projects = assets.filter((a) => a.asset_type === 'vercel_project')
  const deployments = assets.filter((a) => a.asset_type === 'deployment')
  const domains = assets.filter((a) => a.asset_type === 'domain')
  const envVars = assets.filter((a) => a.asset_type === 'env_var')

  const syncDate = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Never'

  // Main Vercel overview doc
  let vercelDoc = `# Vercel: ${displayName}

> Auto-generated from connected Vercel account. Last synced: ${syncDate}

## Connection Details

${config.team_slug ? `- **Team:** ${config.team_slug}` : '- **Account:** Personal'}

## Summary

| Asset Type | Count |
|------------|-------|
| Projects | ${projects.length} |
| Recent Deployments | ${deployments.length} |
| Domains | ${domains.length} |
| Environment Variables | ${envVars.length} |

## Projects

`

  for (const project of projects) {
    const data = project.data_json as unknown as VercelProjectAssetData
    vercelDoc += `### ${data.name}

- **ID:** \`${data.id}\`
${data.framework ? `- **Framework:** ${data.framework}` : ''}
${data.git_repo ? `- **Repository:** ${data.git_repo.repo} (${data.git_repo.type})` : ''}

`
  }

  // Add domains section
  if (domains.length > 0) {
    vercelDoc += `## Domains

| Domain | Project | Verified | Configured |
|--------|---------|----------|------------|
`
    for (const domain of domains) {
      const data = domain.data_json as unknown as DomainAssetData
      const projectName =
        projects.find((p) => (p.data_json as VercelProjectAssetData).id === data.project_id)
          ?.name || data.project_id
      vercelDoc += `| ${data.name} | ${projectName} | ${data.verified ? '✓' : '✗'} | ${data.configured ? '✓' : '✗'} |\n`
    }
    vercelDoc += '\n'
  }

  // Add environment variables section (names only!)
  if (envVars.length > 0) {
    vercelDoc += `## Environment Variables

> Note: Only variable names are shown. Values are never stored or displayed.

| Variable | Targets | Type |
|----------|---------|------|
`
    for (const envVar of envVars) {
      const data = envVar.data_json as unknown as EnvVarAssetData
      vercelDoc += `| \`${data.key}\` | ${data.target.join(', ')} | ${data.type} |\n`
    }
    vercelDoc += '\n'
  }

  // Add recent deployments section
  if (deployments.length > 0) {
    vercelDoc += `## Recent Deployments

| Deployment | State | Created | Target |
|------------|-------|---------|--------|
`
    for (const deployment of deployments.slice(0, 20)) {
      const data = deployment.data_json as unknown as DeploymentAssetData
      const created = new Date(data.created_at).toLocaleDateString()
      vercelDoc += `| [${data.name}](https://${data.url}) | ${data.state} | ${created} | ${data.target || '-'} |\n`
    }
    vercelDoc += '\n'
  }

  docs.push({
    slug: 'architecture/vercel',
    title: `Vercel: ${displayName}`,
    category: 'architecture',
    markdown: vercelDoc,
  })

  // Create deployment documentation
  let deploymentDoc = `# Deployment Architecture

> Auto-generated from connected services. Last synced: ${syncDate}

## Overview

This project is deployed using Vercel.

## Projects

`

  for (const project of projects) {
    const data = project.data_json as unknown as VercelProjectAssetData
    const projectDomains = domains.filter(
      (d) => (d.data_json as DomainAssetData).project_id === data.id
    )
    const projectDeployments = deployments.filter((d) => d.name.startsWith(data.name))

    deploymentDoc += `### ${data.name}

${data.framework ? `- **Framework:** ${data.framework}` : ''}
- **Domains:** ${projectDomains.map((d) => d.name).join(', ') || 'None'}
- **Latest Deployment:** ${projectDeployments.length > 0 ? (projectDeployments[0].data_json as DeploymentAssetData).state : 'N/A'}

`
  }

  // Add environment variable summary
  if (envVars.length > 0) {
    const envByTarget: Record<string, string[]> = {}
    for (const envVar of envVars) {
      const data = envVar.data_json as EnvVarAssetData
      for (const target of data.target) {
        if (!envByTarget[target]) envByTarget[target] = []
        envByTarget[target].push(data.key)
      }
    }

    deploymentDoc += `## Environment Configuration

`
    for (const [target, vars] of Object.entries(envByTarget)) {
      deploymentDoc += `### ${target.charAt(0).toUpperCase() + target.slice(1)}

${vars.map((v) => `- \`${v}\``).join('\n')}

`
    }
  }

  docs.push({
    slug: 'architecture/deployment',
    title: 'Deployment Architecture',
    category: 'architecture',
    markdown: deploymentDoc,
  })

  return docs
}

/**
 * Generate data model documentation from Supabase tables
 */
function generateDataModelDoc(
  tables: Array<{
    asset_type: string
    asset_key: string
    name: string
    data_json: TableAssetData
  }>,
  lastSyncedAt: string | null
): string {
  const syncDate = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Never'

  let doc = `# Data Model

> Auto-generated from connected Supabase database. Last synced: ${syncDate}

## Overview

This project uses a PostgreSQL database hosted on Supabase with ${tables.length} tables.

## Entity Relationship Summary

`

  // Group tables by schema
  const bySchema: Record<string, typeof tables> = {}
  for (const table of tables) {
    const schema = table.data_json.schema
    if (!bySchema[schema]) bySchema[schema] = []
    bySchema[schema].push(table)
  }

  // Generate ERD-like text summary
  for (const [schema, schemaTables] of Object.entries(bySchema)) {
    doc += `### Schema: ${schema}

`
    for (const table of schemaTables) {
      const data = table.data_json
      doc += `**${data.name}**\n`

      // List columns
      for (const col of data.columns.slice(0, 10)) {
        const pk = col.is_primary_key ? ' 🔑' : ''
        doc += `  - ${col.name}${pk}: ${col.type}${col.nullable ? '?' : ''}\n`
      }

      if (data.columns.length > 10) {
        doc += `  - ... and ${data.columns.length - 10} more columns\n`
      }

      // List foreign keys
      if (data.foreign_keys && data.foreign_keys.length > 0) {
        doc += `  \n  **References:**\n`
        for (const fk of data.foreign_keys) {
          doc += `  - ${fk.column} → ${fk.references_table}.${fk.references_column}\n`
        }
      }

      doc += '\n'
    }
  }

  // Add table details section
  doc += `## Table Details

`

  for (const table of tables) {
    const data = table.data_json
    doc += `### ${data.schema}.${data.name}

| Column | Type | Nullable | Key | Default |
|--------|------|----------|-----|---------|
`
    for (const col of data.columns) {
      const key = col.is_primary_key ? 'PK' : ''
      doc += `| ${col.name} | ${col.type} | ${col.nullable ? '✓' : ''} | ${key} | ${col.default_value || ''} |\n`
    }

    if (data.foreign_keys && data.foreign_keys.length > 0) {
      doc += `\n**Foreign Keys:**\n`
      for (const fk of data.foreign_keys) {
        doc += `- \`${fk.column}\` references \`${fk.references_table}(${fk.references_column})\`\n`
      }
    }

    doc += '\n'
  }

  return doc
}

/**
 * Upsert a doc page in the database
 */
async function upsertDocPage(
  supabase: SupabaseClient,
  projectId: string,
  slug: string,
  title: string,
  category: 'architecture' | 'features' | 'decisions' | 'status' | 'services',
  markdown: string
): Promise<void> {
  // Map 'services' to a valid category (use 'architecture' for now)
  const validCategory = category === 'services' ? 'architecture' : category

  const { error } = await supabase.from('doc_pages').upsert(
    {
      project_id: projectId,
      slug,
      title,
      category: validCategory,
      markdown,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,slug' }
  )

  if (error) {
    throw new Error(`Failed to upsert doc page: ${error.message}`)
  }
}

/**
 * Trigger architecture map regeneration with debounce
 */
async function triggerMapRegeneration(
  supabase: SupabaseClient,
  projectId: string,
  reason: string
): Promise<void> {
  // Check if we've regenerated recently (within 1 minute)
  const { data: project } = await supabase
    .from('projects')
    .select('last_map_regen_at')
    .eq('id', projectId)
    .single()

  const lastRegen = project?.last_map_regen_at
    ? new Date(project.last_map_regen_at).getTime()
    : 0
  const now = Date.now()
  const oneMinute = 60 * 1000

  if (now - lastRegen < oneMinute) {
    console.log('[ServiceDocGen] Skipping map regeneration (debounced)')
    return
  }

  // Update the last regen timestamp
  await supabase
    .from('projects')
    .update({ last_map_regen_at: new Date().toISOString() })
    .eq('id', projectId)

  console.log(`[ServiceDocGen] Map regeneration triggered (reason: ${reason})`)

  // Note: Actual map regeneration would be implemented here
  // For now, we just update the timestamp to track when it should happen
}
