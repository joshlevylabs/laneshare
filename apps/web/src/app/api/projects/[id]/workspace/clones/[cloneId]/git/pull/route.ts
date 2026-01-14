/**
 * POST /api/projects/[id]/workspace/clones/[cloneId]/git/pull
 *
 * Pull changes from remote repository
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

const pullSchema = z.object({
  branch: z.string().optional(),
  rebase: z.boolean().default(false),
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
  const result = pullSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { branch, rebase } = result.data

  // Get clone info
  const { data: clone, error: cloneError } = await supabase
    .from('local_repo_clones')
    .select('id, local_server_host, clone_status, current_branch')
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
    // Send pull request to local server
    const response = await fetch(
      `http://${clone.local_server_host}/repos/${cloneId}/pull`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: branch || clone.current_branch,
          rebase,
        }),
        signal: AbortSignal.timeout(60000),
      }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'Failed to pull')
    }

    const pullResult = await response.json()

    // Update clone state
    await supabase
      .from('local_repo_clones')
      .update({
        current_sha: pullResult.new_sha,
        remote_sha: pullResult.new_sha,
        behind_count: 0,
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', cloneId)

    return NextResponse.json({
      success: true,
      new_sha: pullResult.new_sha,
      updated_files: pullResult.updated_files || [],
      message: pullResult.message || 'Pulled successfully',
    })
  } catch (error) {
    console.error('[GitPull] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to pull' },
      { status: 500 }
    )
  }
}
