import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createSessionSchema = z.object({
  taskId: z.string().uuid().optional(),
  repoId: z.string().uuid().optional(),
  codespaceName: z.string().optional(),
  localSessionId: z.string().optional(),
  connectionConfig: z.object({
    serverUrl: z.string().url(),
    projectPath: z.string().optional(),
  }).optional(),
}).refine(
  (data) => data.taskId || data.codespaceName,
  { message: 'Either taskId or codespaceName is required' }
)

/**
 * GET /api/projects/[id]/workspace/sessions
 * List all workspace sessions for a project
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
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

  // Fetch sessions with task info
  const { data: sessions, error } = await supabase
    .from('workspace_sessions')
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
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching workspace sessions:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(sessions)
}

/**
 * POST /api/projects/[id]/workspace/sessions
 * Create a new workspace session
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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
  const result = createSessionSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { taskId, repoId, codespaceName, localSessionId, connectionConfig } = result.data

  // If taskId provided, verify it belongs to this project
  if (taskId) {
    const { data: task } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', taskId)
      .eq('project_id', params.id)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
  }

  // Check if session already exists based on provided identifiers
  let existingQuery = supabase
    .from('workspace_sessions')
    .select('id, status')
    .eq('project_id', params.id)
    .eq('created_by', user.id)

  if (codespaceName) {
    existingQuery = existingQuery.eq('codespace_name', codespaceName)
  } else if (taskId) {
    existingQuery = existingQuery.eq('task_id', taskId)
  }

  const { data: existingSession } = await existingQuery.maybeSingle()

  if (existingSession) {
    // If session exists but is disconnected, reactivate it
    if (existingSession.status === 'DISCONNECTED') {
      const { data: reactivated, error: reactivateError } = await supabase
        .from('workspace_sessions')
        .update({
          status: 'CONNECTED',
          local_session_id: localSessionId || null,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', existingSession.id)
        .select(`
          *,
          task:tasks (
            id,
            key,
            title,
            type,
            status
          ),
          repo:repos (
            id,
            owner,
            name
          )
        `)
        .single()

      if (reactivateError) {
        return NextResponse.json({ error: reactivateError.message }, { status: 500 })
      }
      return NextResponse.json(reactivated, { status: 200 })
    }

    return NextResponse.json(
      { error: 'Session already exists', sessionId: existingSession.id },
      { status: 409 }
    )
  }

  // Create new session
  const { data: session, error } = await supabase
    .from('workspace_sessions')
    .insert({
      project_id: params.id,
      task_id: taskId || null,
      repo_id: repoId || null,
      codespace_name: codespaceName || null,
      local_session_id: localSessionId || null,
      status: 'CONNECTED',
      connection_config: connectionConfig || {},
      created_by: user.id,
      last_activity_at: new Date().toISOString(),
    })
    .select(`
      *,
      task:tasks (
        id,
        key,
        title,
        type,
        status
      ),
      repo:repos (
        id,
        owner,
        name
      )
    `)
    .single()

  if (error) {
    console.error('Error creating workspace session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(session, { status: 201 })
}
