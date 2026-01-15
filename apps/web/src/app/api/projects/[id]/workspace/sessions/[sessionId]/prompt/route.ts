/**
 * Workspace Session Prompt API
 *
 * Queue a prompt for the bridge agent to process.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * POST /api/projects/[id]/workspace/sessions/[sessionId]/prompt
 * Queue a prompt for the bridge to process
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const { id: projectId, sessionId } = params
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
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify session exists and belongs to project
  const { data: session, error: sessionError } = await supabase
    .from('workspace_sessions')
    .select('id, project_id, bridge_connected')
    .eq('id', sessionId)
    .eq('project_id', projectId)
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (!session.bridge_connected) {
    return NextResponse.json({ error: 'Bridge agent is not connected' }, { status: 400 })
  }

  const body = await request.json()
  const { prompt } = body

  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Create user message
  const { data: userMessage, error: userMessageError } = await supabase
    .from('workspace_messages')
    .insert({
      session_id: sessionId,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    })
    .select()
    .single()

  if (userMessageError) {
    console.error('[Prompt] Error creating user message:', userMessageError)
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })
  }

  // Queue the prompt for the bridge
  const { data: queuedPrompt, error: queueError } = await supabase
    .from('bridge_prompt_queue')
    .insert({
      session_id: sessionId,
      prompt,
      session_message_id: userMessage.id,
      status: 'PENDING',
      created_by: user.id,
    })
    .select()
    .single()

  if (queueError) {
    console.error('[Prompt] Error queuing prompt:', queueError)
    return NextResponse.json({ error: 'Failed to queue prompt' }, { status: 500 })
  }

  return NextResponse.json({
    promptId: queuedPrompt.id,
    messageId: userMessage.id,
  })
}
