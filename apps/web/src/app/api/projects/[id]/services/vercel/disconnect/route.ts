/**
 * Disconnect Vercel service
 * POST /api/projects/[id]/services/vercel/disconnect
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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
      { error: 'Only project owners and maintainers can manage service connections' },
      { status: 403 }
    )
  }

  // Find the Vercel connection
  const { data: connection } = await supabase
    .from('project_service_connections')
    .select('id')
    .eq('project_id', params.id)
    .eq('service', 'vercel')
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'No Vercel connection found for this project' },
      { status: 404 }
    )
  }

  // Delete all related assets first
  await serviceClient
    .from('service_assets')
    .delete()
    .eq('connection_id', connection.id)

  // Delete all sync runs
  await serviceClient
    .from('service_sync_runs')
    .delete()
    .eq('connection_id', connection.id)

  // Delete the connection
  const { error } = await serviceClient
    .from('project_service_connections')
    .delete()
    .eq('id', connection.id)

  if (error) {
    console.error('[Vercel Disconnect] Error deleting connection:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect service' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
