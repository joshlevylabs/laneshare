import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSystemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
})

// GET /api/projects/[id]/systems/[systemId] - Get a single system with full details
export async function GET(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Fetch system with related data
  const { data: system, error } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        graph_json,
        generated_at,
        generated_by,
        notes
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'System not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get latest snapshot
  const latestSnapshot = system.system_flow_snapshots
    ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

  // Count nodes
  const graphJson = latestSnapshot?.graph_json as { nodes?: unknown[] } | undefined
  const nodeCount = graphJson?.nodes?.length || 0

  return NextResponse.json({
    ...system,
    node_count: nodeCount,
    latest_snapshot: latestSnapshot,
  })
}

// PATCH /api/projects/[id]/systems/[systemId] - Update a system
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Verify system exists
  const { data: existing } = await supabase
    .from('systems')
    .select('id, slug')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request body
  const body = await request.json()
  const result = updateSystemSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const input = result.data

  // Build update object
  const updateData: Record<string, unknown> = {}

  if (input.name !== undefined) {
    updateData.name = input.name
    // Update slug if name changes
    updateData.slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100)

    // Check for duplicate slug
    const { data: duplicate } = await supabase
      .from('systems')
      .select('id')
      .eq('project_id', params.id)
      .eq('slug', updateData.slug as string)
      .neq('id', params.systemId)
      .single()

    if (duplicate) {
      return NextResponse.json(
        { error: 'A system with this name already exists' },
        { status: 400 }
      )
    }
  }

  if (input.description !== undefined) updateData.description = input.description
  if (input.status !== undefined) updateData.status = input.status

  // Update system
  const { data: system, error } = await serviceClient
    .from('systems')
    .update(updateData)
    .eq('id', params.systemId)
    .select()
    .single()

  if (error) {
    console.error('Failed to update system:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(system)
}

// DELETE /api/projects/[id]/systems/[systemId] - Delete a system
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project owner access only for delete
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  }

  // Verify system exists
  const { data: existing } = await supabase
    .from('systems')
    .select('id')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Delete system (cascade will handle related tables)
  const { error } = await serviceClient
    .from('systems')
    .delete()
    .eq('id', params.systemId)

  if (error) {
    console.error('Failed to delete system:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
