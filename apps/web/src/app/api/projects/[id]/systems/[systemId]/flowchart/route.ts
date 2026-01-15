import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SystemGraph, SystemNode, SystemEdge } from '@laneshare/shared'
import type { Json } from '@/lib/supabase/types'

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(['UI', 'API', 'SERVICE', 'DATA', 'WORKER', 'EXTERNAL']),
  label: z.string().min(1).max(200),
  details: z.string().max(1000).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
})

const edgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(['CALLS', 'READS', 'WRITES', 'TRIGGERS', 'CONFIGURES']),
  label: z.string().max(100).optional(),
})

const saveFlowchartSchema = z.object({
  nodes: z.array(nodeSchema).max(100),
  edges: z.array(edgeSchema).max(200),
})

// GET /api/projects/[id]/systems/[systemId]/flowchart - Get current flowchart
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

  // Check project access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get system with latest snapshot
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        graph_json,
        generated_at
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Get latest snapshot
  const snapshots = system.system_flow_snapshots || []
  const latestSnapshot = snapshots.sort(
    (a: { version: number }, b: { version: number }) => b.version - a.version
  )[0]

  return NextResponse.json({
    system: {
      id: system.id,
      name: system.name,
      description: system.description,
      status: system.status,
    },
    graph: latestSnapshot?.graph_json || {
      systemId: system.id,
      title: system.name,
      nodes: [],
      edges: [],
    },
    version: latestSnapshot?.version || 0,
  })
}

// PUT /api/projects/[id]/systems/[systemId]/flowchart - Save flowchart
export async function PUT(
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

  // Get system
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select('id, name')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request body
  const body = await request.json()
  const result = saveFlowchartSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { nodes, edges } = result.data

  // Build system graph
  const graph: SystemGraph = {
    systemId: params.systemId,
    title: system.name,
    nodes: nodes as SystemNode[],
    edges: edges as SystemEdge[],
  }

  try {
    // Get current version
    const { data: latestSnapshot } = await supabase
      .from('system_flow_snapshots')
      .select('version')
      .eq('system_id', params.systemId)
      .order('version', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (latestSnapshot?.version || 0) + 1

    // Create new snapshot
    const { data: snapshot, error: snapshotError } = await serviceClient
      .from('system_flow_snapshots')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        version: nextVersion,
        graph_json: graph as unknown as Json,
        generated_by: user.id,
        notes: 'Manual save',
      })
      .select()
      .single()

    if (snapshotError) {
      console.error('Failed to create snapshot:', snapshotError)
      return NextResponse.json(
        { error: 'Failed to save flowchart' },
        { status: 500 }
      )
    }

    // Update system status to GROUNDED if it has nodes
    const newStatus = nodes.length > 0 ? 'GROUNDED' : 'DRAFT'
    await serviceClient
      .from('systems')
      .update({ status: newStatus })
      .eq('id', params.systemId)

    return NextResponse.json({
      snapshotId: snapshot.id,
      version: nextVersion,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    })
  } catch (error) {
    console.error('Flowchart save error:', error)
    const message = error instanceof Error ? error.message : 'Save failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
