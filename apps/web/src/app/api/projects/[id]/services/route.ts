/**
 * API Routes for listing service connections
 * GET /api/projects/[id]/services - List all service connections and recent sync runs
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Json } from '@/lib/supabase/types'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get all service connections for this project
  const { data: connections, error: connectionsError } = await supabase
    .from('project_service_connections')
    .select(`
      id,
      service,
      display_name,
      status,
      config_json,
      last_synced_at,
      last_sync_error,
      created_at,
      updated_at
    `)
    .eq('project_id', params.id)
    .order('service')

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 })
  }

  // Get recent sync runs for each connection
  const connectionIds = connections?.map((c) => c.id) || []
  let syncRuns: Array<{
    id: string
    connection_id: string
    status: string | null
    started_at: string | null
    finished_at: string | null
    stats_json: Json | null
    error: string | null
  }> = []

  if (connectionIds.length > 0) {
    const { data: runs } = await supabase
      .from('service_sync_runs')
      .select('id, connection_id, status, started_at, finished_at, stats_json, error')
      .in('connection_id', connectionIds)
      .order('started_at', { ascending: false })
      .limit(5)

    syncRuns = runs || []
  }

  // Get asset counts per connection
  const assetCounts: Record<string, { total: number; by_type: Record<string, number> }> = {}

  for (const connectionId of connectionIds) {
    const { data: assets } = await supabase
      .from('service_assets')
      .select('asset_type')
      .eq('connection_id', connectionId)

    if (assets) {
      const byType: Record<string, number> = {}
      for (const asset of assets) {
        byType[asset.asset_type] = (byType[asset.asset_type] || 0) + 1
      }
      assetCounts[connectionId] = {
        total: assets.length,
        by_type: byType,
      }
    }
  }

  // Build response with connections and their recent runs
  const connectionsWithRuns = connections?.map((connection) => ({
    ...connection,
    recent_runs: syncRuns.filter((r) => r.connection_id === connection.id),
    asset_counts: assetCounts[connection.id] || { total: 0, by_type: {} },
  }))

  return NextResponse.json({
    connections: connectionsWithRuns || [],
    user_role: membership.role,
  })
}
