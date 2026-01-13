import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  deduplicateNodes,
  deduplicateEdges,
  type SystemGraph,
  type SystemNode,
  type SystemEdge,
} from '@laneshare/shared'

const regenerateSchema = z.object({
  includeAgentOutput: z.boolean().optional().default(true),
  forceRebuild: z.boolean().optional().default(false),
})

// POST /api/projects/[id]/systems/[systemId]/regenerate-flow - Regenerate flow snapshot
export async function POST(
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

  // Get system with artifacts
  const { data: system, error: systemError } = await supabase
    .from('systems')
    .select(`
      *,
      system_artifacts (
        id,
        kind,
        content_json,
        created_at
      ),
      system_flow_snapshots (
        id,
        version,
        graph_json
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (systemError || !system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request
  const body = await request.json().catch(() => ({}))
  const result = regenerateSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { includeAgentOutput, forceRebuild } = result.data

  try {
    // Get latest snapshot
    const latestSnapshot = system.system_flow_snapshots
      ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

    const previousGraph = latestSnapshot?.graph_json as SystemGraph | undefined

    // Collect all nodes and edges from artifacts
    let allNodes: SystemNode[] = []
    let allEdges: SystemEdge[] = []

    // Get SYSTEM_SPEC artifacts (user-confirmed specs)
    const specArtifacts = system.system_artifacts
      ?.filter((a: { kind: string }) => a.kind === 'SYSTEM_SPEC')
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ) || []

    for (const artifact of specArtifacts) {
      const spec = artifact.content_json as SystemGraph
      if (spec?.nodes) {
        allNodes = [...allNodes, ...spec.nodes]
      }
      if (spec?.edges) {
        allEdges = [...allEdges, ...spec.edges]
      }
    }

    // Include agent output if requested
    if (includeAgentOutput) {
      const agentArtifacts = system.system_artifacts
        ?.filter((a: { kind: string }) => a.kind === 'AGENT_OUTPUT')
        .sort((a: { created_at: string }, b: { created_at: string }) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ) || []

      for (const artifact of agentArtifacts) {
        const spec = artifact.content_json?.parsedSpec as SystemGraph | undefined
        if (spec?.nodes) {
          allNodes = [...allNodes, ...spec.nodes]
        }
        if (spec?.edges) {
          allEdges = [...allEdges, ...spec.edges]
        }
      }
    }

    // Deduplicate
    const deduplicatedNodes = deduplicateNodes(allNodes)
    const deduplicatedEdges = deduplicateEdges(allEdges)

    // Build new graph
    const newGraph: SystemGraph = {
      systemId: params.systemId,
      title: system.name,
      nodes: deduplicatedNodes,
      edges: deduplicatedEdges,
      openQuestions: [],
      notes: [`Regenerated at ${new Date().toISOString()}`],
    }

    // Calculate diff
    const previousNodeIds = new Set(previousGraph?.nodes?.map((n) => n.id) || [])
    const previousEdgeIds = new Set(previousGraph?.edges?.map((e) => e.id) || [])
    const newNodeIds = new Set(newGraph.nodes.map((n) => n.id))
    const newEdgeIds = new Set(newGraph.edges.map((e) => e.id))

    const nodesAdded = newGraph.nodes.filter((n) => !previousNodeIds.has(n.id)).length
    const nodesRemoved = previousGraph?.nodes?.filter((n) => !newNodeIds.has(n.id)).length || 0
    const edgesAdded = newGraph.edges.filter((e) => !previousEdgeIds.has(e.id)).length
    const edgesRemoved = previousGraph?.edges?.filter((e) => !newEdgeIds.has(e.id)).length || 0

    // Get next version
    const nextVersion = (latestSnapshot?.version || 0) + 1

    // Create new snapshot
    const { data: snapshot, error: snapshotError } = await serviceClient
      .from('system_flow_snapshots')
      .insert({
        project_id: params.id,
        system_id: params.systemId,
        version: nextVersion,
        graph_json: newGraph,
        generated_by: user.id,
        notes: `Regenerated flow. +${nodesAdded} nodes, -${nodesRemoved} nodes, +${edgesAdded} edges, -${edgesRemoved} edges`,
      })
      .select()
      .single()

    if (snapshotError) {
      console.error('Failed to create snapshot:', snapshotError)
      return NextResponse.json(
        { error: 'Failed to create flow snapshot' },
        { status: 500 }
      )
    }

    // Update system status if grounded
    const hasEvidence = newGraph.nodes.every((n) => n.refs.length > 0)
    if (hasEvidence) {
      await serviceClient
        .from('systems')
        .update({ status: 'GROUNDED' })
        .eq('id', params.systemId)
    }

    return NextResponse.json({
      snapshotId: snapshot.id,
      version: nextVersion,
      nodesAdded,
      nodesRemoved,
      edgesAdded,
      edgesRemoved,
      graph: newGraph,
    })
  } catch (error: unknown) {
    console.error('Flow regeneration error:', error)
    const message = error instanceof Error ? error.message : 'Regeneration failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
