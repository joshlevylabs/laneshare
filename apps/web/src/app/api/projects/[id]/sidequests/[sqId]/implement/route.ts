// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const startImplementationSchema = z.object({
  start_from_ticket_id: z.string().uuid().optional(),
  auto_advance: z.boolean().optional().default(false),
  workspace_session_id: z.string().uuid().optional(),
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

  // Get active implementation session
  const { data: session, error } = await supabase
    .from('sidequest_implementation_sessions')
    .select(`
      *,
      current_ticket:sidequest_tickets!current_ticket_id(
        *,
        approver:profiles!approved_by(id, email, full_name, avatar_url)
      ),
      sidequest:sidequests!sidequest_id(
        id, title, description, status, total_tickets, completed_tickets
      ),
      starter:profiles!started_by(id, email, full_name, avatar_url)
    `)
    .eq('sidequest_id', params.sqId)
    .in('status', ['IMPLEMENTING', 'AWAITING_REVIEW', 'PAUSED'])
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(session || null)
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

  const body = await request.json().catch(() => ({}))
  const result = startImplementationSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  // Check for existing active session
  const { data: existingSession } = await supabase
    .from('sidequest_implementation_sessions')
    .select('id, status')
    .eq('sidequest_id', params.sqId)
    .in('status', ['IMPLEMENTING', 'AWAITING_REVIEW', 'PAUSED'])
    .single()

  if (existingSession) {
    return NextResponse.json(
      { error: 'An implementation session is already active', session_id: existingSession.id },
      { status: 409 }
    )
  }

  // Get the sidequest
  const { data: sidequest, error: sqError } = await supabase
    .from('sidequests')
    .select('*')
    .eq('id', params.sqId)
    .eq('project_id', params.id)
    .single()

  if (sqError || !sidequest) {
    return NextResponse.json({ error: 'Sidequest not found' }, { status: 404 })
  }

  // Check sidequest status
  if (sidequest.status !== 'READY' && sidequest.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: 'Sidequest must be in READY or IN_PROGRESS status to implement' },
      { status: 400 }
    )
  }

  // Find the first ticket to implement
  let firstTicketId = result.data.start_from_ticket_id

  if (!firstTicketId) {
    // Get the first approved ticket with a task that isn't completed
    const { data: firstTicket } = await supabase
      .from('sidequest_tickets')
      .select('id')
      .eq('sidequest_id', params.sqId)
      .in('status', ['APPROVED', 'IN_PROGRESS'])
      .not('task_id', 'is', null)
      .order('hierarchy_level', { ascending: true })
      .order('sprint_group', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .limit(1)
      .single()

    if (firstTicket) {
      firstTicketId = firstTicket.id
    }
  }

  if (!firstTicketId) {
    return NextResponse.json(
      { error: 'No approved tickets with tasks found to implement' },
      { status: 400 }
    )
  }

  // Create the implementation session
  const { data: session, error: sessionError } = await supabase
    .from('sidequest_implementation_sessions')
    .insert({
      sidequest_id: params.sqId,
      project_id: params.id,
      current_ticket_id: firstTicketId,
      workspace_session_id: result.data.workspace_session_id || null,
      status: 'IMPLEMENTING',
      auto_advance: result.data.auto_advance,
      started_by: user.id,
    })
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

  if (sessionError) {
    console.error('Session creation error:', sessionError)
    return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  // Update sidequest status
  await supabase
    .from('sidequests')
    .update({ status: 'IN_PROGRESS', current_ticket_id: firstTicketId })
    .eq('id', params.sqId)

  // Update ticket status
  await supabase
    .from('sidequest_tickets')
    .update({ status: 'IN_PROGRESS' })
    .eq('id', firstTicketId)

  return NextResponse.json(session, { status: 201 })
}
