// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateTicketSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable().optional(),
  story_points: z.number().int().min(1).max(13).nullable().optional(),
  sprint_group: z.number().int().min(1).nullable().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'SKIPPED']).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string; sqId: string; ticketId: string } }
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

  // Get the ticket with related data
  const { data: ticket, error } = await supabase
    .from('sidequest_tickets')
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get parent ticket if exists
  let parent = null
  if (ticket.parent_ticket_id) {
    const { data: parentData } = await supabase
      .from('sidequest_tickets')
      .select('id, title, ticket_type, status')
      .eq('id', ticket.parent_ticket_id)
      .single()
    parent = parentData
  }

  // Get children tickets
  const { data: children } = await supabase
    .from('sidequest_tickets')
    .select('id, title, ticket_type, status, sort_order')
    .eq('parent_ticket_id', params.ticketId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({
    ...ticket,
    parent,
    children: children || [],
  })
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string; sqId: string; ticketId: string } }
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
  const result = updateTicketSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Build update object
  const updateData: Record<string, unknown> = {}
  if (result.data.title !== undefined) updateData.title = result.data.title
  if (result.data.description !== undefined) updateData.description = result.data.description
  if (result.data.acceptance_criteria !== undefined) updateData.acceptance_criteria = result.data.acceptance_criteria
  if (result.data.priority !== undefined) updateData.priority = result.data.priority
  if (result.data.story_points !== undefined) updateData.story_points = result.data.story_points
  if (result.data.sprint_group !== undefined) updateData.sprint_group = result.data.sprint_group
  if (result.data.status !== undefined) {
    updateData.status = result.data.status
    // Track approval
    if (result.data.status === 'APPROVED') {
      updateData.approved_at = new Date().toISOString()
      updateData.approved_by = user.id
    }
  }

  const { data: ticket, error } = await supabase
    .from('sidequest_tickets')
    .update(updateData)
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (error) {
    console.error('Ticket update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(ticket)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; sqId: string; ticketId: string } }
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

  // Delete the ticket (cascades to children due to ON DELETE CASCADE)
  const { error } = await supabase
    .from('sidequest_tickets')
    .delete()
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)

  if (error) {
    console.error('Ticket deletion error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
