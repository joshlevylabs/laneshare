import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSessionSchema = z.object({
  status: z.enum(['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR']).optional(),
  localSessionId: z.string().optional(),
  errorMessage: z.string().optional(),
  lastActivityAt: z.string().datetime().optional(),
  connectionConfig: z.object({
    serverUrl: z.string().url(),
    projectPath: z.string().optional(),
  }).optional(),
})

/**
 * GET /api/projects/[id]/workspace/sessions/[sessionId]
 * Get a specific workspace session
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

  const { data: session, error } = await supabase
    .from('workspace_sessions')
    .select(`
      *,
      task:tasks (
        id,
        key,
        title,
        type,
        status,
        description
      )
    `)
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json(session)
}

/**
 * PATCH /api/projects/[id]/workspace/sessions/[sessionId]
 * Update a workspace session
 */
export async function PATCH(
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

  const body = await request.json()
  const result = updateSessionSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const updateData: Record<string, unknown> = {}
  if (result.data.status) updateData.status = result.data.status
  if (result.data.localSessionId !== undefined) updateData.local_session_id = result.data.localSessionId
  if (result.data.errorMessage !== undefined) updateData.error_message = result.data.errorMessage
  if (result.data.lastActivityAt) updateData.last_activity_at = result.data.lastActivityAt
  if (result.data.connectionConfig) updateData.connection_config = result.data.connectionConfig

  const { data: session, error } = await supabase
    .from('workspace_sessions')
    .update(updateData)
    .eq('id', params.sessionId)
    .eq('project_id', params.id)
    .select(`
      *,
      task:tasks (
        id,
        key,
        title,
        type,
        status
      )
    `)
    .single()

  if (error) {
    console.error('Error updating workspace session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json(session)
}

/**
 * DELETE /api/projects/[id]/workspace/sessions/[sessionId]
 * Delete a workspace session
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

  // Check if user created this session
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
    // Check if user is admin/owner
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
    .from('workspace_sessions')
    .delete()
    .eq('id', params.sessionId)

  if (error) {
    console.error('Error deleting workspace session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
