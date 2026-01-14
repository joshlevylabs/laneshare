/**
 * Disconnect OpenAPI service
 * POST /api/projects/[id]/services/openapi/disconnect
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const disconnectSchema = z.object({
  keep_assets: z.boolean().optional().default(false),
})

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

  // Parse request body
  const body = await request.json().catch(() => ({}))
  const validation = disconnectSchema.safeParse(body)
  const { keep_assets } = validation.success ? validation.data : { keep_assets: false }

  // Find the OpenAPI connection
  const { data: connection } = await supabase
    .from('project_service_connections')
    .select('id, display_name')
    .eq('project_id', params.id)
    .eq('service', 'openapi')
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'No OpenAPI connection found for this project' },
      { status: 404 }
    )
  }

  // If not keeping assets, delete them
  if (!keep_assets) {
    await serviceClient
      .from('service_assets')
      .delete()
      .eq('connection_id', connection.id)
  }

  // Delete sync runs
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
    console.error('[OpenAPI Disconnect] Error:', error)
    return NextResponse.json(
      { error: 'Failed to disconnect' },
      { status: 500 }
    )
  }

  // Optionally clean up generated docs
  // For now, we leave docs intact as they may still be useful

  return NextResponse.json({
    success: true,
    message: `OpenAPI connection "${connection.display_name}" disconnected`,
    assets_deleted: !keep_assets,
  })
}
