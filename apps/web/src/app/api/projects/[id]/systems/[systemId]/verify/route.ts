import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const verifySchema = z.object({
  nodeId: z.string().min(1),
  isVerified: z.boolean(),
  notes: z.string().max(1000).optional(),
})

// POST /api/projects/[id]/systems/[systemId]/verify - Verify a node
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

  // Verify system exists
  const { data: system } = await supabase
    .from('systems')
    .select('id')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (!system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request
  const body = await request.json()
  const result = verifySchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { nodeId, isVerified, notes } = result.data

  try {
    // Check if verification record exists
    const { data: existing } = await supabase
      .from('system_node_verifications')
      .select('id')
      .eq('system_id', params.systemId)
      .eq('node_id', nodeId)
      .single()

    if (existing) {
      // Update existing
      const { data: verification, error } = await serviceClient
        .from('system_node_verifications')
        .update({
          is_verified: isVerified,
          verified_by: isVerified ? user.id : null,
          verified_at: isVerified ? new Date().toISOString() : null,
          notes,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(verification)
    } else {
      // Create new
      const { data: verification, error } = await serviceClient
        .from('system_node_verifications')
        .insert({
          project_id: params.id,
          system_id: params.systemId,
          node_id: nodeId,
          is_verified: isVerified,
          verified_by: isVerified ? user.id : null,
          verified_at: isVerified ? new Date().toISOString() : null,
          notes,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(verification, { status: 201 })
    }
  } catch (error: unknown) {
    console.error('Verification error:', error)
    const message = error instanceof Error ? error.message : 'Verification failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET /api/projects/[id]/systems/[systemId]/verify - Get all verifications for a system
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

  // Get verifications
  const { data: verifications, error } = await supabase
    .from('system_node_verifications')
    .select(`
      *,
      verifier:verified_by (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('system_id', params.systemId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(verifications || [])
}
