// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SIDEQUEST_TICKET_HIERARCHY, SIDEQUEST_VALID_PARENT_TYPES } from '@laneshare/shared'
import type { SidequestTicketType } from '@laneshare/shared'

const createTicketSchema = z.object({
  parent_ticket_id: z.string().uuid().nullable().optional(),
  ticket_type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK']),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).nullable().optional(),
  acceptance_criteria: z.array(z.string()).optional().default([]),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable().optional(),
  story_points: z.number().int().min(1).max(13).nullable().optional(),
  sprint_group: z.number().int().min(1).nullable().optional(),
})

const reorderTicketsSchema = z.object({
  ticket_id: z.string().uuid(),
  new_parent_id: z.string().uuid().nullable().optional(),
  new_sort_order: z.number().int().min(0),
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

  // Get all tickets for the sidequest
  const { data: tickets, error } = await supabase
    .from('sidequest_tickets')
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .eq('sidequest_id', params.sqId)
    .order('hierarchy_level', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build hierarchical tree structure
  const ticketMap = new Map<string, typeof tickets[0] & { children: typeof tickets }>()
  const roots: Array<typeof tickets[0] & { children: typeof tickets }> = []

  // First pass: create map and add children array
  for (const ticket of tickets || []) {
    ticketMap.set(ticket.id, { ...ticket, children: [] })
  }

  // Second pass: build tree
  for (const ticket of tickets || []) {
    const ticketWithChildren = ticketMap.get(ticket.id)!
    if (ticket.parent_ticket_id && ticketMap.has(ticket.parent_ticket_id)) {
      ticketMap.get(ticket.parent_ticket_id)!.children.push(ticketWithChildren)
    } else {
      roots.push(ticketWithChildren)
    }
  }

  // Sort children by sort_order
  const sortChildren = (items: typeof roots) => {
    items.sort((a, b) => a.sort_order - b.sort_order)
    for (const item of items) {
      if (item.children.length > 0) {
        sortChildren(item.children)
      }
    }
  }
  sortChildren(roots)

  return NextResponse.json({
    tickets: tickets || [],
    tree: roots,
  })
}

export async function POST(
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
  const result = createTicketSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Verify sidequest exists
  const { data: sidequest, error: sqError } = await supabase
    .from('sidequests')
    .select('id, status')
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single()

  if (sqError || !sidequest) {
    return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
  }

  // Validate parent if provided
  if (result.data.parent_ticket_id) {
    const { data: parent, error: parentError } = await supabase
      .from('sidequest_tickets')
      .select('id, ticket_type')
      .eq('id', result.data.parent_ticket_id)
      .eq('sidequest_id', params.sqId)
      .single()

    if (parentError || !parent) {
      return NextResponse.json({ error: 'Parent ticket not found' }, { status: 400 })
    }

    // Validate hierarchy
    const validParents = SIDEQUEST_VALID_PARENT_TYPES[result.data.ticket_type as SidequestTicketType]
    if (!validParents.includes(parent.ticket_type as SidequestTicketType)) {
      return NextResponse.json(
        { error: `${result.data.ticket_type} cannot be a child of ${parent.ticket_type}` },
        { status: 400 }
      )
    }
  } else if (result.data.ticket_type !== 'EPIC') {
    // Non-epics require a parent
    return NextResponse.json(
      { error: `${result.data.ticket_type} requires a parent ticket` },
      { status: 400 }
    )
  }

  // Get the max sort_order for this parent
  const { data: existingTickets } = await supabase
    .from('sidequest_tickets')
    .select('sort_order')
    .eq('sidequest_id', params.sqId)
    .eq('parent_ticket_id', result.data.parent_ticket_id || null)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSortOrder =
    existingTickets && existingTickets.length > 0 ? existingTickets[0].sort_order + 1 : 0

  const hierarchyLevel = SIDEQUEST_TICKET_HIERARCHY[result.data.ticket_type as SidequestTicketType]

  // Create the ticket
  const { data: ticket, error } = await supabase
    .from('sidequest_tickets')
    .insert({
      sidequest_id: params.sqId,
      project_id: params.id,
      parent_ticket_id: result.data.parent_ticket_id || null,
      ticket_type: result.data.ticket_type,
      hierarchy_level: hierarchyLevel,
      sort_order: nextSortOrder,
      title: result.data.title,
      description: result.data.description,
      acceptance_criteria: result.data.acceptance_criteria,
      priority: result.data.priority,
      story_points: result.data.story_points,
      sprint_group: result.data.sprint_group,
      status: 'PENDING',
    })
    .select()
    .single()

  if (error) {
    console.error('Ticket creation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(ticket, { status: 201 })
}

// Reorder tickets endpoint
export async function PATCH(
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
  const result = reorderTicketsSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get the ticket being moved
  const { data: ticket, error: ticketError } = await supabase
    .from('sidequest_tickets')
    .select('*')
    .eq('id', result.data.ticket_id)
    .eq('sidequest_id', params.sqId)
    .single()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // If changing parent, validate the new hierarchy
  if (result.data.new_parent_id !== undefined && result.data.new_parent_id !== ticket.parent_ticket_id) {
    if (result.data.new_parent_id) {
      const { data: newParent, error: parentError } = await supabase
        .from('sidequest_tickets')
        .select('id, ticket_type')
        .eq('id', result.data.new_parent_id)
        .eq('sidequest_id', params.sqId)
        .single()

      if (parentError || !newParent) {
        return NextResponse.json({ error: 'New parent ticket not found' }, { status: 400 })
      }

      // Validate hierarchy
      const validParents = SIDEQUEST_VALID_PARENT_TYPES[ticket.ticket_type as SidequestTicketType]
      if (!validParents.includes(newParent.ticket_type as SidequestTicketType)) {
        return NextResponse.json(
          { error: `${ticket.ticket_type} cannot be a child of ${newParent.ticket_type}` },
          { status: 400 }
        )
      }
    } else if (ticket.ticket_type !== 'EPIC') {
      return NextResponse.json(
        { error: `${ticket.ticket_type} requires a parent ticket` },
        { status: 400 }
      )
    }
  }

  const newParentId = result.data.new_parent_id !== undefined
    ? result.data.new_parent_id
    : ticket.parent_ticket_id

  // Get all siblings at the new position
  const { data: siblings } = await supabase
    .from('sidequest_tickets')
    .select('id, sort_order')
    .eq('sidequest_id', params.sqId)
    .eq('parent_ticket_id', newParentId || null)
    .neq('id', ticket.id)
    .order('sort_order', { ascending: true })

  // Update sort orders
  const updates: Array<{ id: string; sort_order: number }> = []
  let currentOrder = 0

  for (const sibling of siblings || []) {
    if (currentOrder === result.data.new_sort_order) {
      currentOrder++ // Skip the position where the moved ticket will go
    }
    if (sibling.sort_order !== currentOrder) {
      updates.push({ id: sibling.id, sort_order: currentOrder })
    }
    currentOrder++
  }

  // Update siblings in batch
  for (const update of updates) {
    await supabase
      .from('sidequest_tickets')
      .update({ sort_order: update.sort_order })
      .eq('id', update.id)
  }

  // Update the moved ticket
  const { data: updatedTicket, error: updateError } = await supabase
    .from('sidequest_tickets')
    .update({
      parent_ticket_id: newParentId,
      sort_order: result.data.new_sort_order,
    })
    .eq('id', ticket.id)
    .select()
    .single()

  if (updateError) {
    console.error('Ticket reorder error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json(updatedTicket)
}
