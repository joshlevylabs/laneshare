/**
 * GET /api/projects/[id]/tasks/[taskId]/implement/status
 *
 * Get the current implementation session status for a task.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ImplementationStatusResponse } from '@laneshare/shared'

export async function GET(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const projectId = params.id
  const taskId = params.taskId
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

    // Get latest session for task
    const { data: session, error: sessionError } = await supabase
      .from('agent_execution_sessions')
      .select(
        `
        *,
        task:tasks(id, key, title, status),
        repo:repos(id, owner, name),
        creator:profiles(id, email, full_name)
      `
      )
      .eq('task_id', taskId)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'No implementation session found' },
        { status: 404 }
      )
    }

    // Get iterations
    const { data: iterations } = await supabase
      .from('agent_iterations')
      .select('*')
      .eq('session_id', session.id)
      .order('iteration_number', { ascending: false })

    const currentIteration = iterations?.[0] || null

    // Get file operations
    const { data: fileOperations } = await supabase
      .from('agent_file_operations')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })

    // Get feedback
    const { data: feedback } = await supabase
      .from('agent_feedback')
      .select(
        `
        *,
        creator:profiles(id, email, full_name)
      `
      )
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })

    const response: ImplementationStatusResponse = {
      session: {
        ...session,
        iterations: (iterations || []) as any, // DB nulls vs TS undefined
      },
      currentIteration,
      fileOperations: fileOperations || [],
      feedback: feedback || [],
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[ImplementStatus] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
