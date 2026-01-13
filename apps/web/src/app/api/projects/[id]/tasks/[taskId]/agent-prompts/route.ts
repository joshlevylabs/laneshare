import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createSessionSchema = z.object({
  repo_id: z.string().uuid(),
})

/**
 * GET /api/projects/[id]/tasks/[taskId]/agent-prompts
 * List all agent prompt sessions for a task (grouped by repo)
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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

  // Get all sessions for this task with their turns
  const { data: sessions, error } = await supabase
    .from('agent_prompt_sessions')
    .select(`
      *,
      repo:repos!repo_id(id, owner, name, default_branch),
      turns:agent_prompt_turns(*)
    `)
    .eq('task_id', params.taskId)
    .eq('project_id', params.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching agent prompt sessions:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sort turns by turn_number within each session
  const sessionsWithSortedTurns = sessions?.map((session) => ({
    ...session,
    turns: session.turns?.sort(
      (a: { turn_number: number }, b: { turn_number: number }) => a.turn_number - b.turn_number
    ),
  }))

  return NextResponse.json(sessionsWithSortedTurns || [])
}

/**
 * POST /api/projects/[id]/tasks/[taskId]/agent-prompts
 * Create a new agent prompt session for a specific repo
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
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

  // Verify the repo belongs to this project
  const { data: repo } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('id', result.data.repo_id)
    .eq('project_id', params.id)
    .single()

  if (!repo) {
    return NextResponse.json(
      { error: 'Repository not found in this project' },
      { status: 404 }
    )
  }

  // Check if session already exists for this task+repo
  const { data: existingSession } = await supabase
    .from('agent_prompt_sessions')
    .select('id')
    .eq('task_id', params.taskId)
    .eq('repo_id', result.data.repo_id)
    .single()

  if (existingSession) {
    return NextResponse.json(
      { error: 'Session already exists for this repo', sessionId: existingSession.id },
      { status: 409 }
    )
  }

  // Create the session
  const { data: session, error } = await supabase
    .from('agent_prompt_sessions')
    .insert({
      task_id: params.taskId,
      project_id: params.id,
      repo_id: result.data.repo_id,
      created_by: user.id,
      status: 'ACTIVE',
    })
    .select(`
      *,
      repo:repos!repo_id(id, owner, name, default_branch)
    `)
    .single()

  if (error) {
    console.error('Error creating agent prompt session:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(session, { status: 201 })
}
