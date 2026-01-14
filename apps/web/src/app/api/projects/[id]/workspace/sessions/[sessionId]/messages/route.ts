import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createMessageSchema = z.object({
  localMessageId: z.string().optional(),
  role: z.enum(['user', 'assistant', 'tool_use', 'tool_result', 'system']),
  content: z.string(),
  toolName: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
  toolResult: z.string().optional(),
  timestamp: z.string().datetime().optional(),
})

/**
 * GET /api/projects/[id]/workspace/sessions/[sessionId]/messages
 * Get all messages for a workspace session
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
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
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Verify session belongs to project
  const { data: session } = await supabase
    .from('workspace_sessions')
    .select('id')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Get pagination params
  const url = new URL(request.url)
  const limit = parseInt(url.searchParams.get('limit') || '100')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  const { data: messages, error } = await supabase
    .from('workspace_messages')
    .select('*')
    .eq('session_id', params.sessionId)
    .order('timestamp', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching workspace messages:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform to frontend format
  const transformedMessages = messages.map((msg) => ({
    id: msg.id,
    localMessageId: msg.local_message_id,
    role: msg.role,
    content: msg.content,
    toolName: msg.tool_name,
    toolInput: msg.tool_input,
    toolResult: msg.tool_result,
    timestamp: msg.timestamp,
  }))

  return NextResponse.json(transformedMessages)
}

/**
 * POST /api/projects/[id]/workspace/sessions/[sessionId]/messages
 * Add a message to a workspace session (for caching from local server)
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
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
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Verify session belongs to project
  const { data: session } = await supabase
    .from('workspace_sessions')
    .select('id')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const body = await request.json()
  const result = createMessageSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { localMessageId, role, content, toolName, toolInput, toolResult, timestamp } = result.data

  const { data: message, error } = await supabase
    .from('workspace_messages')
    .insert({
      session_id: params.sessionId,
      local_message_id: localMessageId || null,
      role,
      content,
      tool_name: toolName || null,
      tool_input: toolInput || null,
      tool_result: toolResult || null,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating workspace message:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    id: message.id,
    localMessageId: message.local_message_id,
    role: message.role,
    content: message.content,
    toolName: message.tool_name,
    toolInput: message.tool_input,
    toolResult: message.tool_result,
    timestamp: message.timestamp,
  }, { status: 201 })
}

/**
 * DELETE /api/projects/[id]/workspace/sessions/[sessionId]/messages
 * Clear all messages from a session
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if user owns the session or is admin
  const { data: session } = await supabase
    .from('workspace_sessions')
    .select('id, created_by')
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.created_by !== user.id) {
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', params.id)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from('workspace_messages')
    .delete()
    .eq('session_id', params.sessionId)

  if (error) {
    console.error('Error deleting workspace messages:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
