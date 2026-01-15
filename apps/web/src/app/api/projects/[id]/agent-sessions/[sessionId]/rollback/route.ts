/**
 * POST /api/projects/[id]/agent-sessions/[sessionId]/rollback
 *
 * Rollback an agent implementation session.
 * Deletes the implementation branch and cancels the session.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubCodeEditor } from '@/lib/github-code-editor'
import type { RollbackRequest } from '@laneshare/shared'

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

    // Check project membership - only maintainers/admins can rollback
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const canRollback = ['admin', 'maintainer', 'owner'].includes(membership.role)
    if (!canRollback) {
      return NextResponse.json(
        { error: 'Only maintainers and admins can rollback sessions' },
        { status: 403 }
      )
    }

    // Parse request body
    const body: RollbackRequest = await request.json()

    if (!body.reason) {
      return NextResponse.json(
        { error: 'reason is required' },
        { status: 400 }
      )
    }

    // Get session with repo info
    const { data: session, error: sessionError } = await supabase
      .from('agent_execution_sessions')
      .select(
        `
        *,
        repo:repos(id, owner, name, github_token_encrypted)
      `
      )
      .eq('id', sessionId)
      .eq('project_id', projectId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      )
    }

    // Check if session can be rolled back
    const nonRollbackStatuses = ['CANCELLED']
    if (nonRollbackStatuses.includes(session.status)) {
      return NextResponse.json(
        { error: `Cannot rollback session with status: ${session.status}` },
        { status: 400 }
      )
    }

    const repo = session.repo as {
      id: string
      owner: string
      name: string
      github_token_encrypted: string | null
    }

    if (!repo.github_token_encrypted) {
      return NextResponse.json(
        { error: 'Repository does not have a valid GitHub token' },
        { status: 400 }
      )
    }

    // Initialize GitHub editor
    const github = await GitHubCodeEditor.fromEncryptedToken(repo.github_token_encrypted)

    // Try to delete the implementation branch
    let branchDeleted = false
    try {
      const branchExists = await github.branchExists(
        repo.owner,
        repo.name,
        session.implementation_branch
      )

      if (branchExists) {
        await github.deleteBranch(repo.owner, repo.name, session.implementation_branch)
        branchDeleted = true
      }
    } catch (branchError) {
      console.error('[Rollback] Error deleting branch:', branchError)
      // Continue with rollback even if branch deletion fails
    }

    // If rolling back to a specific iteration, update the session accordingly
    if (body.toIterationNumber !== undefined) {
      // Mark iterations after the target as rolled back (soft delete)
      const { data: iterationsToRollback } = await supabase
        .from('agent_iterations')
        .select('id')
        .eq('session_id', sessionId)
        .gt('iteration_number', body.toIterationNumber)

      if (iterationsToRollback && iterationsToRollback.length > 0) {
        const iterationIds = iterationsToRollback.map((i) => i.id)

        // Delete file operations for these iterations
        await supabase
          .from('agent_file_operations')
          .delete()
          .in('iteration_id', iterationIds)

        // Delete the iterations
        await supabase.from('agent_iterations').delete().in('id', iterationIds)
      }

      // Update session to reflect the rollback
      await supabase
        .from('agent_execution_sessions')
        .update({
          current_iteration: body.toIterationNumber,
          status: 'RUNNING',
          error_message: null,
          stuck_reason: null,
        })
        .eq('id', sessionId)

      // Record feedback about the rollback
      await supabase.from('agent_feedback').insert({
        session_id: sessionId,
        feedback_type: 'guidance',
        content: `Rolled back to iteration ${body.toIterationNumber}. Reason: ${body.reason}`,
        created_by: user.id,
      })

      return NextResponse.json({
        success: true,
        message: `Rolled back to iteration ${body.toIterationNumber}`,
        branchDeleted,
        sessionCancelled: false,
      })
    }

    // Full rollback - cancel the session entirely
    await supabase
      .from('agent_execution_sessions')
      .update({
        status: 'CANCELLED',
        error_message: `Rolled back by user: ${body.reason}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    // Record feedback about the full rollback
    await supabase.from('agent_feedback').insert({
      session_id: sessionId,
      feedback_type: 'abort',
      content: `Full rollback. Reason: ${body.reason}`,
      created_by: user.id,
    })

    // Record task activity
    const { data: task } = await supabase
      .from('agent_execution_sessions')
      .select('task_id')
      .eq('id', sessionId)
      .single()

    if (task) {
      await supabase.from('task_activity').insert({
        task_id: task.task_id,
        actor_id: user.id,
        project_id: projectId,
        kind: 'AGENT_IMPLEMENTATION_FAILED',
        after_value: {
          session_id: sessionId,
          reason: 'rollback',
          message: body.reason,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Session cancelled and branch deleted',
      branchDeleted,
      sessionCancelled: true,
    })
  } catch (error) {
    console.error('[Rollback] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
