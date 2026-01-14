/**
 * POST /api/projects/[id]/workspace/clones/[cloneId]/git/push
 *
 * Push commits to remote repository
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

const pushSchema = z.object({
  remote: z.string().default('origin'),
  branch: z.string().optional(),
  force: z.boolean().default(false),
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
  const body = await request.json().catch(() => ({}))
  const result = pushSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { remote, branch, force } = result.data

  // Get clone info with repo token
  const { data: clone, error: cloneError } = await supabase
    .from('local_repo_clones')
    .select(`
      id,
      local_server_host,
      clone_status,
      current_branch,
      repo:repos (
        id,
        owner,
        name,
        github_installation_token
      )
    `)
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
    // Send push request to local server
    const response = await fetch(
      `http://${clone.local_server_host}/repos/${cloneId}/push`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remote,
          branch: branch || clone.current_branch,
          force,
          // The local server should have the token from the clone operation
        }),
        signal: AbortSignal.timeout(60000),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'Failed to push')
    }

    const pushResult = await response.json()

    // Update clone state
    await supabase
      .from('local_repo_clones')
      .update({
        remote_sha: pushResult.pushed_sha,
        ahead_count: 0,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', cloneId)

    return NextResponse.json({
      success: true,
      pushed_sha: pushResult.pushed_sha,
      message: pushResult.message || 'Pushed successfully',
    })
  } catch (error) {
    console.error('[GitPush] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push' },
      { status: 500 }
    )
  }
}
