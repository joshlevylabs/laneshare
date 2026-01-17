/**
 * Cross-Session Response API
 *
 * Allows Claude Code sessions to respond to cross-session queries/commands.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

interface CrossSessionResponseBody {
  requestId: string
  sessionId: string              // The responding session
  response: string
  responseData?: Record<string, any>
  status: 'completed' | 'failed'
}

/**
 * POST - Respond to a cross-session request
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: CrossSessionResponseBody = await request.json()

  if (!body.requestId) {
    return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
  }

  if (!body.sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  if (!body.response) {
    return NextResponse.json({ error: 'response is required' }, { status: 400 })
  }

  // Verify session belongs to user
  const { data: session, error: sessionError } = await supabase
    .from('workspace_sessions')
    .select('id, created_by, project_id')
    .eq('id', body.sessionId)
    .eq('project_id', projectId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    return NextResponse.json({ error: 'Not your session' }, { status: 403 })
  }

  // Find the request and verify it's targeted at this session
  const { data: crossRequest, error: requestError } = await supabase
    .from('workspace_cross_session_messages')
    .select('*')
    .eq('request_id', body.requestId)
    .eq('target_session_id', body.sessionId)
    .in('status', ['pending', 'delivered', 'processing'])
    .single()

  if (requestError || !crossRequest) {
    return NextResponse.json(
      { error: 'Request not found or not targeted at your session' },
      { status: 404 }
    )
  }

  // Check if request has expired
  if (new Date(crossRequest.expires_at) < new Date()) {
    await supabase
      .from('workspace_cross_session_messages')
      .update({ status: 'timeout', completed_at: new Date().toISOString() })
      .eq('id', crossRequest.id)

    return NextResponse.json({ error: 'Request has expired' }, { status: 410 })
  }

  // Update the request with the response
  const { error: updateError } = await supabase
    .from('workspace_cross_session_messages')
    .update({
      response: body.response,
      response_data: body.responseData || null,
      status: body.status || 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', crossRequest.id)

  if (updateError) {
    console.error('[CrossSession Response] Update error:', updateError)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  // Create an event for the source session to notify them of the response
  await supabase.from('workspace_events').insert({
    project_id: projectId,
    target_session_id: crossRequest.source_session_id,
    event_type: 'cross_session_response',
    event_data: {
      requestId: body.requestId,
      response: body.response,
      responseData: body.responseData,
      status: body.status || 'completed',
      respondedBy: {
        sessionId: body.sessionId,
      },
    },
  })

  return NextResponse.json({
    success: true,
    requestId: body.requestId,
    status: body.status || 'completed',
  })
}
