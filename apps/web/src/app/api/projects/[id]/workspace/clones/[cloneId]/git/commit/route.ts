/**
 * POST /api/projects/[id]/workspace/clones/[cloneId]/git/commit
 *
 * Commit changes in a local clone
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

const commitSchema = z.object({
  message: z.string().min(1, 'Commit message is required').max(500),
  files: z.array(z.string()).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string; cloneId: string } }
) {
  const { id: projectId, cloneId } = params
  const supabase = createServerSupabaseClient()

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
  const body = await request.json()
  const result = commitSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { message, files } = result.data

  // Get clone info
  const { data: clone, error: cloneError } = await supabase
    .from('local_repo_clones')
    .select('id, local_server_host, clone_status')
    .eq('id', cloneId)
    .eq('project_id', projectId)
    .single()

  if (cloneError || !clone) {
    return NextResponse.json({ error: 'Clone not found' }, { status: 404 })
  }

  if (clone.clone_status !== 'CLONED') {
    return NextResponse.json(
      { error: `Clone is not ready (status: ${clone.clone_status})` },
      { status: 400 }
    )
  }

  try {
    // Send commit request to local server
    const response = await fetch(
      `http://${clone.local_server_host}/repos/${cloneId}/commit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, files }),
        signal: AbortSignal.timeout(30000),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'Failed to commit')
    }

    const result = await response.json()

    // Update clone state
    await supabase
      .from('local_repo_clones')
      .update({
        current_sha: result.commit_sha,
        is_dirty: false,
        ahead_count: (clone as { ahead_count?: number }).ahead_count || 0 + 1,
      })
      .eq('id', cloneId)

    return NextResponse.json({
      success: true,
      commit_sha: result.commit_sha,
      message: result.message || `Committed: ${message}`,
    })
  } catch (error) {
    console.error('[GitCommit] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to commit' },
      { status: 500 }
    )
  }
}
