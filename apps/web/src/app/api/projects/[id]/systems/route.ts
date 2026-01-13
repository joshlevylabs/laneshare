import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { System, CreateSystemInput } from '@laneshare/shared'

const createSystemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  in_scope: z.string().max(2000).optional(),
  out_of_scope: z.string().max(2000).optional(),
  keywords: z.array(z.string()).max(50).optional(),
  repo_ids: z.array(z.string().uuid()).max(20).optional(),
})

// GET /api/projects/[id]/systems - List all systems for a project
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

  // Fetch systems with computed fields
  const { data: systems, error } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        generated_at,
        graph_json
      )
    `)
    .eq('project_id', params.id)
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform to include computed fields
  const systemsWithCounts = await Promise.all(
    (systems || []).map(async (system) => {
      // Get latest snapshot
      const latestSnapshot = system.system_flow_snapshots
        ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

      // Count nodes and verified nodes if snapshot exists
      let nodeCount = 0
      let verifiedCount = 0

      if (latestSnapshot?.graph_json?.nodes) {
        nodeCount = latestSnapshot.graph_json.nodes.length

        const { count } = await supabase
          .from('system_node_verifications')
          .select('*', { count: 'exact', head: true })
          .eq('system_id', system.id)
          .eq('is_verified', true)

        verifiedCount = count || 0
      }

      const { system_flow_snapshots, ...systemData } = system

      return {
        ...systemData,
        node_count: nodeCount,
        verified_count: verifiedCount,
        latest_snapshot: latestSnapshot ? {
          id: latestSnapshot.id,
          version: latestSnapshot.version,
          generated_at: latestSnapshot.generated_at,
        } : undefined,
      }
    })
  )

  return NextResponse.json(systemsWithCounts)
}

// POST /api/projects/[id]/systems - Create a new system
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

  // Parse request body
  const body = await request.json()
  const result = createSystemSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const input = result.data as CreateSystemInput

  // Generate slug from name
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)

  // Check for duplicate slug
  const { data: existing } = await supabase
    .from('systems')
    .select('id')
    .eq('project_id', params.id)
    .eq('slug', slug)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'A system with this name already exists' },
      { status: 400 }
    )
  }

  // Create system
  const { data: system, error } = await serviceClient
    .from('systems')
    .insert({
      project_id: params.id,
      name: input.name,
      slug,
      description: input.description,
      in_scope: input.in_scope,
      out_of_scope: input.out_of_scope,
      keywords: input.keywords || [],
      repo_ids: input.repo_ids || [],
      status: 'DRAFT',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create system:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(system, { status: 201 })
}
