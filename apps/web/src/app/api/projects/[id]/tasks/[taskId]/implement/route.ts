/**
 * POST /api/projects/[id]/tasks/[taskId]/implement
 *
 * Start an AI implementation session for a task.
 * Creates a new branch and begins the implementation loop.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { runImplementationLoop } from '@/lib/agent-implementation-runner'
import {
  extractAcceptanceCriteria,
  generateBranchName,
} from '@laneshare/shared'
import type {
  AgentExecutionStatus,
  StartImplementationResponse,
  Task,
} from '@laneshare/shared'

const StartRequestSchema = z.object({
  repoId: z.string().uuid(),
  sourceBranch: z.string().optional(),
  maxIterations: z.number().min(1).max(20).optional().default(10),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const projectId = params.id
  const taskId = params.taskId
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  try {
    // Authenticate
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership (maintainer or higher)
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Only maintainers can start AI implementation' },
        { status: 403 }
      )
    }

    // Parse request
    const body = await request.json()
    const result = StartRequestSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: result.error.flatten() },
        { status: 400 }
      )
    }
    const { repoId, sourceBranch, maxIterations } = result.data

    // Get task
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('project_id', projectId)
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Get repo
    const { data: repo, error: repoError } = await supabase
      .from('repos')
      .select('*')
      .eq('id', repoId)
      .eq('project_id', projectId)
      .single()

    if (repoError || !repo) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    if (repo.status !== 'SYNCED') {
      return NextResponse.json(
        { error: 'Repository must be synced before implementation' },
        { status: 400 }
      )
    }

    // Check for existing active session
    const { data: existingSession } = await supabase
      .from('agent_execution_sessions')
      .select('id, status')
      .eq('task_id', taskId)
      .in('status', ['PENDING', 'RUNNING', 'WAITING_FEEDBACK'])
      .single()

    if (existingSession) {
      return NextResponse.json(
        {
          error: 'An implementation session is already active for this task',
          sessionId: existingSession.id,
        },
        { status: 409 }
      )
    }

    // Extract acceptance criteria
    const acceptanceCriteria = extractAcceptanceCriteria(task as Task)
    if (acceptanceCriteria.length === 0) {
      return NextResponse.json(
        { error: 'Task has no acceptance criteria. Add criteria to the description.' },
        { status: 400 }
      )
    }

    // Generate branch name
    const branch = sourceBranch || repo.selected_branch || repo.default_branch
    const implementationBranch = generateBranchName(task as Task)

    // Create session record
    const { data: session, error: sessionError } = await serviceClient
      .from('agent_execution_sessions')
      .insert({
        task_id: taskId,
        project_id: projectId,
        repo_id: repoId,
        created_by: user.id,
        status: 'PENDING' as AgentExecutionStatus,
        source_branch: branch,
        implementation_branch: implementationBranch,
        max_iterations: maxIterations,
        progress_json: {
          stage: 'INITIALIZING',
          message: 'Starting implementation...',
          filesModified: 0,
          criteriaChecked: 0,
          criteriaPassed: 0,
          criteriaTotal: acceptanceCriteria.length,
          lastUpdated: new Date().toISOString(),
        },
      })
      .select()
      .single()

    if (sessionError || !session) {
      console.error('[Implement] Failed to create session:', sessionError)
      return NextResponse.json(
        { error: 'Failed to create implementation session' },
        { status: 500 }
      )
    }

    // Update task status to IN_PROGRESS
    await serviceClient
      .from('tasks')
      .update({ status: 'IN_PROGRESS' })
      .eq('id', taskId)

    // Log activity
    await serviceClient.from('task_activity').insert({
      task_id: taskId,
      project_id: projectId,
      actor_id: user.id,
      kind: 'AGENT_IMPLEMENTATION_STARTED',
      after_value: {
        session_id: session.id,
        implementation_branch: implementationBranch,
        acceptance_criteria_count: acceptanceCriteria.length,
      },
    })

    // Start implementation loop in background
    runImplementationLoop(
      session.id,
      projectId,
      taskId,
      repoId,
      user.id,
      serviceClient
    ).catch(error => {
      console.error('[Implement] Background loop failed:', error)
    })

    const response: StartImplementationResponse = {
      sessionId: session.id,
      implementationBranch,
      status: 'PENDING',
      message: 'Implementation session started',
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    console.error('[Implement] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
