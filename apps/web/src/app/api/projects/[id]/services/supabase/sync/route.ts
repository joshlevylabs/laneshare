/**
 * Sync Supabase service
 * POST /api/projects/[id]/services/supabase/sync
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createSupabaseAdapter } from '@/lib/services'
import { decrypt } from '@/lib/encryption'
// Legacy auto-doc generation disabled - documents are now user-created via Document Builder
// import { runServiceDocGeneration } from '@/lib/service-doc-generator'
import { NextResponse } from 'next/server'
import type { SupabaseConfig, SupabaseSecrets, SupabaseSyncStats } from '@/lib/supabase/types'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify project admin access (OWNER or MAINTAINER)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can trigger syncs' },
      { status: 403 }
    )
  }

  // Find the Supabase connection
  const { data: connection } = await supabase
    .from('project_service_connections')
    .select('id, config_json, secret_encrypted')
    .eq('project_id', params.id)
    .eq('service', 'supabase')
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'No Supabase connection found for this project' },
      { status: 404 }
    )
  }

  // Create a sync run record
  const { data: syncRun, error: syncRunError } = await serviceClient
    .from('service_sync_runs')
    .insert({
      project_id: params.id,
      connection_id: connection.id,
      triggered_by: user.id,
      status: 'RUNNING',
    })
    .select()
    .single()

  if (syncRunError) {
    console.error('[Supabase Sync] Error creating sync run:', syncRunError)
    return NextResponse.json(
      { error: 'Failed to start sync' },
      { status: 500 }
    )
  }

  // Start sync in background
  performSync(
    params.id,
    connection.id,
    syncRun.id,
    connection.config_json as SupabaseConfig,
    connection.secret_encrypted,
    serviceClient
  ).catch((error) => {
    console.error('[Supabase Sync] Background sync error:', error)
  })

  return NextResponse.json({
    sync_run_id: syncRun.id,
    status: 'RUNNING',
    message: 'Sync started',
  })
}

/**
 * Perform the actual sync in the background
 */
async function performSync(
  projectId: string,
  connectionId: string,
  syncRunId: string,
  config: SupabaseConfig,
  encryptedSecrets: string,
  supabase: ReturnType<typeof createServiceRoleClient>
) {
  let stats: SupabaseSyncStats | null = null

  try {
    // Decrypt secrets
    const decryptedSecrets = await decrypt(encryptedSecrets)
    const secrets: SupabaseSecrets = JSON.parse(decryptedSecrets)

    // Run sync using adapter
    const adapter = createSupabaseAdapter()
    const result = await adapter.sync(config, secrets)

    if (!result.success) {
      throw new Error(result.error || 'Sync failed')
    }

    stats = result.stats as SupabaseSyncStats
    const warnings = result.warnings || []

    // Delete existing assets for this connection
    await supabase
      .from('service_assets')
      .delete()
      .eq('connection_id', connectionId)

    // Insert new assets
    if (result.assets.length > 0) {
      const assetsToInsert = result.assets.map((asset) => ({
        project_id: projectId,
        connection_id: connectionId,
        service: 'supabase' as const,
        asset_type: asset.asset_type,
        asset_key: asset.asset_key,
        name: asset.name,
        data_json: asset.data_json,
        updated_at: new Date().toISOString(),
      }))

      // Insert in batches of 100
      const batchSize = 100
      for (let i = 0; i < assetsToInsert.length; i += batchSize) {
        const batch = assetsToInsert.slice(i, i + batchSize)
        await supabase.from('service_assets').insert(batch)
      }
    }

    // Update connection status (set warning if we have warnings but it succeeded)
    const connectionStatus = warnings.length > 0 ? 'WARNING' : 'CONNECTED'
    await supabase
      .from('project_service_connections')
      .update({
        status: connectionStatus,
        last_synced_at: new Date().toISOString(),
        last_sync_error: warnings.length > 0 ? warnings.join('\n') : null,
      })
      .eq('id', connectionId)

    // Update sync run status
    await supabase
      .from('service_sync_runs')
      .update({
        status: warnings.length > 0 ? 'WARNING' : 'SUCCESS',
        finished_at: new Date().toISOString(),
        stats_json: { ...stats, warnings },
      })
      .eq('id', syncRunId)

    console.log('[Supabase Sync] Completed successfully:', stats)
    if (warnings.length > 0) {
      console.log('[Supabase Sync] Warnings:', warnings)
    }

    // Legacy auto-doc generation disabled - documents are now user-created via Document Builder
    // Users can create documentation using the /documents/new wizard

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Supabase Sync] Error:', errorMessage)

    // Update connection status
    await supabase
      .from('project_service_connections')
      .update({
        status: 'ERROR',
        last_sync_error: errorMessage,
      })
      .eq('id', connectionId)

    // Update sync run status
    await supabase
      .from('service_sync_runs')
      .update({
        status: 'ERROR',
        finished_at: new Date().toISOString(),
        error: errorMessage,
        stats_json: stats || {},
      })
      .eq('id', syncRunId)
  }
}
