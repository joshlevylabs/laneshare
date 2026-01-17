import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

const advanceSchema = z.object({
  action: z.enum(['approve', 'modify', 'skip']),
  modifications: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    acceptance_criteria: z.array(z.string()).optional(),
  }).optional(),
  notes: z.string().max(1000).optional(),
  implementation_result: z.object({
    success: z.boolean(),
    pr_url: z.string().url().optional(),
    pr_number: z.number().int().optional(),
    commit_sha: z.string().optional(),
    branch_name: z.string().optional(),
    files_changed: z.number().int().optional(),
    error: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
})

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
  const result = advanceSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Get active session (using type cast for sidequest tables)
  const { data: session, error: sessionError } = await (supabase as AnySupabase)
    .from('sidequest_implementation_sessions')
    .select(`
      *,
      current_ticket:sidequest_tickets!current_ticket_id(*)
    `)
    .eq('sidequest_id', params.sqId)
    .in('status', ['IMPLEMENTING', 'AWAITING_REVIEW'])
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'No active implementation session found' }, { status: 404 })
  }

  if (!session.current_ticket) {
    return NextResponse.json({ error: 'No current ticket in session' }, { status: 400 })
  }

  const currentTicket = session.current_ticket
  const now = new Date().toISOString()

  // Handle the action
  let newTicketStatus: string
  let ticketsImplemented = session.tickets_implemented
  let ticketsSkipped = session.tickets_skipped

  switch (result.data.action) {
    case 'approve':
      newTicketStatus = 'COMPLETED'
      ticketsImplemented++
      break
    case 'skip':
      newTicketStatus = 'SKIPPED'
      ticketsSkipped++
      break
    case 'modify':
      // For modify, we update the ticket but keep it in progress
      if (result.data.modifications) {
        await (supabase as AnySupabase)
          .from('sidequest_tickets')
          .update({
            title: result.data.modifications.title || currentTicket.title,
            description: result.data.modifications.description || currentTicket.description,
            acceptance_criteria: result.data.modifications.acceptance_criteria || currentTicket.acceptance_criteria,
          })
          .eq('id', currentTicket.id)
      }
      // Continue implementation
      return NextResponse.json({
        message: 'Ticket modified, continuing implementation',
        session,
      })
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Update current ticket
  const implementationResult = result.data.implementation_result
    ? { ...result.data.implementation_result, completed_at: now }
    : null

  await (supabase as AnySupabase)
    .from('sidequest_tickets')
    .update({
      status: newTicketStatus,
      implementation_result: implementationResult,
    })
    .eq('id', currentTicket.id)

  // Find next ticket
  const { data: nextTicket } = await (supabase as AnySupabase)
    .from('sidequest_tickets')
    .select('id')
    .eq('sidequest_id', params.sqId)
    .in('status', ['APPROVED', 'IN_PROGRESS'])
    .neq('id', currentTicket.id)
    .not('task_id', 'is', null)
    .order('hierarchy_level', { ascending: true })
    .order('sprint_group', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true })
    .limit(1)
    .single()

  let sessionStatus: string
  let nextTicketId: string | null = null

  if (nextTicket) {
    // More tickets to implement
    nextTicketId = nextTicket.id
    sessionStatus = session.auto_advance ? 'IMPLEMENTING' : 'AWAITING_REVIEW'

    // Update next ticket to IN_PROGRESS
    await (supabase as AnySupabase)
      .from('sidequest_tickets')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', nextTicketId)
  } else {
    // All tickets done
    sessionStatus = 'COMPLETED'
  }

  // Update session
  const { data: updatedSession, error: updateError } = await (supabase as AnySupabase)
    .from('sidequest_implementation_sessions')
    .update({
      current_ticket_id: nextTicketId,
      status: sessionStatus,
      tickets_implemented: ticketsImplemented,
      tickets_skipped: ticketsSkipped,
      completed_at: sessionStatus === 'COMPLETED' ? now : null,
    })
    .eq('id', session.id)
    .select(`
      *,
      current_ticket:sidequest_tickets!current_ticket_id(
        *,
        approver:profiles!approved_by(id, email, full_name, avatar_url)
      ),
      sidequest:sidequests!sidequest_id(
        id, title, description, status, total_tickets, completed_tickets
      )
    `)
    .single()

  if (updateError) {
    console.error('Session update error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Update sidequest
  if (sessionStatus === 'COMPLETED') {
    await (supabase as AnySupabase)
      .from('sidequests')
      .update({
        status: 'COMPLETED',
        current_ticket_id: null,
      })
      .eq('id', params.sqId)
  } else {
    await (supabase as AnySupabase)
      .from('sidequests')
      .update({
        current_ticket_id: nextTicketId,
        completed_tickets: ticketsImplemented,
      })
      .eq('id', params.sqId)
  }

  return NextResponse.json({
    session: updatedSession,
    previous_ticket: {
      id: currentTicket.id,
      title: currentTicket.title,
      action: result.data.action,
    },
    is_complete: sessionStatus === 'COMPLETED',
  })
}
