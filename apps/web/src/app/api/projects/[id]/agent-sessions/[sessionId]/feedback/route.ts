/**
 * POST /api/projects/[id]/agent-sessions/[sessionId]/feedback
 *
 * Submit human feedback for an agent implementation session.
 * Used when the agent is stuck or waiting for input.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  SubmitFeedbackRequest,
  AgentFeedback,
  AgentExecutionStatus,
} from '@laneshare/shared'

export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const projectId = params.id
  const sessionId = params.sessionId
  const supabase = createServerSupabaseClient()

  try {
    // Authenticate
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
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse request body
    const body: SubmitFeedbackRequest = await request.json()

    if (!body.feedbackType || !body.content) {
      return NextResponse.json(
        { error: 'feedbackType and content are required' },
        { status: 400 }
      )
    }

    // Validate feedback type
    const validTypes = ['guidance', 'approval', 'rejection', 'abort']
    if (!validTypes.includes(body.feedbackType)) {
      return NextResponse.json(
        { error: `Invalid feedbackType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Verify session exists and belongs to this project
    const { data: session, error: sessionError } = await supabase
      .from('agent_execution_sessions')
      .select('id, status, current_iteration')
      .eq('id', sessionId)
      .eq('project_id', projectId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Check if session is in a state that accepts feedback
    const acceptableFeedbackStatuses: AgentExecutionStatus[] = [
      'WAITING_FEEDBACK',
      'STUCK',
      'RUNNING',
    ]
    if (!acceptableFeedbackStatuses.includes(session.status as AgentExecutionStatus)) {
      return NextResponse.json(
        {
          error: `Cannot submit feedback for session in ${session.status} status. ` +
            `Feedback is only accepted when status is: ${acceptableFeedbackStatuses.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Get current iteration if iterationId not provided
    let iterationId = body.iterationId
    if (!iterationId) {
      const { data: currentIteration } = await supabase
        .from('agent_iterations')
        .select('id')
        .eq('session_id', sessionId)
        .order('iteration_number', { ascending: false })
        .limit(1)
        .single()

      iterationId = currentIteration?.id
    }

    // Insert feedback
    const { data: feedback, error: feedbackError } = await supabase
      .from('agent_feedback')
      .insert({
        session_id: sessionId,
        iteration_id: iterationId,
        feedback_type: body.feedbackType,
        content: body.content,
        created_by: user.id,
      })
      .select(
        `
        *,
        creator:profiles(id, email, full_name)
      `
      )
      .single()

    if (feedbackError) {
      console.error('[AgentFeedback] Insert error:', feedbackError)
      return NextResponse.json(
        { error: 'Failed to save feedback' },
        { status: 500 }
      )
    }

    // Handle special feedback types
    if (body.feedbackType === 'abort') {
      // Cancel the session
      await supabase
        .from('agent_execution_sessions')
        .update({
          status: 'CANCELLED',
          completed_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
    } else if (body.feedbackType === 'approval') {
      // If approved while stuck/waiting, mark as succeeded
      if (session.status === 'WAITING_FEEDBACK' || session.status === 'STUCK') {
        await supabase
          .from('agent_execution_sessions')
          .update({
            status: 'SUCCEEDED',
            completed_at: new Date().toISOString(),
          })
          .eq('id', sessionId)
      }
    } else if (body.feedbackType === 'guidance' || body.feedbackType === 'rejection') {
      // Resume the agent by setting status back to RUNNING
      // The agent loop will pick up the feedback on its next iteration
      if (session.status === 'WAITING_FEEDBACK' || session.status === 'STUCK') {
        await supabase
          .from('agent_execution_sessions')
          .update({
            status: 'RUNNING',
          })
          .eq('id', sessionId)
      }
    }

    return NextResponse.json({
      success: true,
      feedback: feedback as AgentFeedback,
    })
  } catch (error) {
    console.error('[AgentFeedback] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
