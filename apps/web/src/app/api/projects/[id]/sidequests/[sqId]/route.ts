// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSidequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  repo_ids: z.array(z.string().uuid()).min(1).optional(),
  status: z.enum(['PLANNING', 'READY', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; sqId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get sidequest with all related data
  const { data: sidequest, error } = await supabase
    .from('sidequests')
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url),
      current_ticket:sidequest_tickets!sidequests_current_ticket_id_fkey(
        id, title, ticket_type, status
      )
    `)
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch repo details
  let repos: Array<{ id: string; owner: string; name: string; default_branch?: string }> = []
  if (sidequest.repo_ids && sidequest.repo_ids.length > 0) {
    const { data: repoData } = await supabase
      .from('repos')
      .select('id, owner, name, default_branch')
      .in('id', sidequest.repo_ids)
    repos = repoData || []
  }

  // Fetch all tickets (hierarchical)
  const { data: tickets } = await supabase
    .from('sidequest_tickets')
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .eq('sidequest_id', params.sqId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({
    ...sidequest,
    repos,
    tickets: tickets || [],
  })
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string; sqId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = await request.json()
  const result = updateSidequestSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // If updating repo_ids, verify they belong to this project
  if (result.data.repo_ids) {
    const { data: repos, error: repoError } = await supabase
      .from('repos')
      .select('id')
      .eq('project_id', params.id)
      .in('id', result.data.repo_ids)

    if (repoError) {
      return NextResponse.json({ error: repoError.message }, { status: 500 })
    }

    if (!repos || repos.length !== result.data.repo_ids.length) {
      return NextResponse.json(
        { error: 'One or more repositories do not belong to this project' },
        { status: 400 }
      )
    }
  }

  // Build update object
  const updateData: Record<string, unknown> = {}
  if (result.data.title !== undefined) updateData.title = result.data.title
  if (result.data.description !== undefined) updateData.description = result.data.description
  if (result.data.repo_ids !== undefined) updateData.repo_ids = result.data.repo_ids
  if (result.data.status !== undefined) updateData.status = result.data.status

  // Increment version on every update
  const { data: sidequest, error } = await supabase
    .from('sidequests')
    .update({
      ...updateData,
      version: supabase.rpc('increment_version'),
    })
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .select(`
      *,
      creator:profiles!created_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    // Try without the version increment (RPC might not exist)
    const { data: fallbackSidequest, error: fallbackError } = await supabase
      .from('sidequests')
      .update(updateData)
      .eq('id', params.sqId)
      .eq('project_id', params.id)
      .select(`
        *,
        creator:profiles!created_by(id, email, full_name, avatar_url)
      `)
      .single()

    if (fallbackError) {
      console.error('Sidequest update error:', fallbackError)
      return NextResponse.json({ error: fallbackError.message }, { status: 500 })
    }

    return NextResponse.json(fallbackSidequest)
  }

  return NextResponse.json(sidequest)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; sqId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check membership (only OWNER and MAINTAINER can delete)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Delete the sidequest (cascades to tickets, chat messages, etc.)
  const { error } = await supabase
    .from('sidequests')
    .delete()
    .eq('id', params.sqId)
    .eq('project_id', params.id)

  if (error) {
    console.error('Sidequest deletion error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
