/**
 * Sync Vercel service
 * POST /api/projects/[id]/services/vercel/sync
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createVercelAdapter } from '@/lib/services'
import { decrypt } from '@/lib/encryption'
import { runServiceDocGeneration } from '@/lib/service-doc-generator'
import { NextResponse } from 'next/server'
import type { VercelConfig, VercelSecrets, VercelSyncStats } from '@/lib/supabase/types'

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

  // Find the Vercel connection
  const { data: connection } = await supabase
    .from('project_service_connections')
    .select('id, config_json, secret_encrypted')
    .eq('project_id', params.id)
    .eq('service', 'vercel')
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'No Vercel connection found for this project' },
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
    console.error('[Vercel Sync] Error creating sync run:', syncRunError)
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
    connection.config_json as VercelConfig,
    connection.secret_encrypted,
    serviceClient
  ).catch((error) => {
    console.error('[Vercel Sync] Background sync error:', error)
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
  config: VercelConfig,
  encryptedSecrets: string,
  supabase: ReturnType<typeof createServiceRoleClient>
) {
  let stats: VercelSyncStats | null = null

  try {
    // Decrypt secrets
    const decryptedSecrets = await decrypt(encryptedSecrets)
    const secrets: VercelSecrets = JSON.parse(decryptedSecrets)

    // Run sync using adapter
    const adapter = createVercelAdapter()
    const result = await adapter.sync(config, secrets)

    if (!result.success) {
      throw new Error(result.error || 'Sync failed')
    }

    stats = result.stats as VercelSyncStats

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
        service: 'vercel' as const,
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

    // Update connection status
    await supabase
      .from('project_service_connections')
      .update({
        status: 'CONNECTED',
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      })
      .eq('id', connectionId)

    // Update sync run status
    await supabase
      .from('service_sync_runs')
      .update({
        status: 'SUCCESS',
        finished_at: new Date().toISOString(),
        stats_json: stats,
      })
      .eq('id', syncRunId)

    console.log('[Vercel Sync] Completed successfully:', stats)

    // Trigger documentation generation in background
    runServiceDocGeneration(projectId, 'vercel', supabase)
      .then((result) => {
        if (result.errors.length > 0) {
          console.log('[ServiceDocGen] Completed with errors:', result.errors)
        } else {
          console.log('[ServiceDocGen] Successfully generated service documentation')
        }
      })
      .catch((error) => {
        console.error('[ServiceDocGen] Failed:', error)
      })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Vercel Sync] Error:', errorMessage)

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
