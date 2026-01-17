// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const approveSchema = z.object({
  approve_children: z.boolean().optional().default(false),
})

export async function POST(
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

  const body = await request.json().catch(() => ({}))
  const result = approveSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get the ticket
  const { data: ticket, error: ticketError } = await supabase
    .from('sidequest_tickets')
    .select('*')
    .eq('id', params.ticketId)
    .eq('sidequest_id', params.sqId)
    .single()

  if (ticketError || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  }

  // Check if already approved
  if (ticket.status === 'APPROVED' || ticket.status === 'COMPLETED') {
    return NextResponse.json({ error: 'Ticket is already approved or completed' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Approve the ticket
  const { data: updatedTicket, error: updateError } = await supabase
    .from('sidequest_tickets')
    .update({
      status: 'APPROVED',
      approved_at: now,
      approved_by: user.id,
    })
    .eq('id', params.ticketId)
    .select(`
      *,
      approver:profiles!approved_by(id, email, full_name, avatar_url)
    `)
    .single()

  if (updateError) {
    console.error('Ticket approval error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // If approve_children is true, approve all descendants
  let approvedChildren = 0
  if (result.data.approve_children) {
    // Get all descendant ticket IDs recursively
    const descendantIds = await getDescendantIds(supabase, params.sqId, params.ticketId)

    if (descendantIds.length > 0) {
      const { error: childrenError, count } = await supabase
        .from('sidequest_tickets')
        .update({
          status: 'APPROVED',
          approved_at: now,
          approved_by: user.id,
        })
        .in('id', descendantIds)
        .eq('status', 'PENDING')

      if (childrenError) {
        console.error('Children approval error:', childrenError)
        // Don't fail the request, just log the error
      } else {
        approvedChildren = count || 0
      }
    }
  }

  return NextResponse.json({
    ticket: updatedTicket,
    approved_children_count: approvedChildren,
  })
}

// Helper to get all descendant ticket IDs
async function getDescendantIds(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sidequestId: string,
  parentId: string
): Promise<string[]> {
  const ids: string[] = []

  const { data: children } = await supabase
    .from('sidequest_tickets')
    .select('id')
    .eq('sidequest_id', sidequestId)
    .eq('parent_ticket_id', parentId)

  if (children && children.length > 0) {
    for (const child of children) {
      ids.push(child.id)
      const grandchildIds = await getDescendantIds(supabase, sidequestId, child.id)
      ids.push(...grandchildIds)
    }
  }

  return ids
}
