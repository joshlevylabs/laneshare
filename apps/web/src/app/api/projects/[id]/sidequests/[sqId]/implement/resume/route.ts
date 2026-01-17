// @ts-nocheck
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

  // Get paused session
  const { data: session, error: sessionError } = await supabase
    .from('sidequest_implementation_sessions')
    .select('id, status, auto_advance')
    .eq('sidequest_id', params.sqId)
    .eq('status', 'PAUSED')
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'No paused implementation session found' }, { status: 404 })
  }

  // Resume the session
  const newStatus = session.auto_advance ? 'IMPLEMENTING' : 'AWAITING_REVIEW'

  const { data: updatedSession, error: updateError } = await supabase
    .from('sidequest_implementation_sessions')
    .update({ status: newStatus })
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
    console.error('Session resume error:', updateError)
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Update sidequest status
  await supabase
    .from('sidequests')
    .update({ status: 'IN_PROGRESS' })
    .eq('id', params.sqId)

  return NextResponse.json(updatedSession)
}
