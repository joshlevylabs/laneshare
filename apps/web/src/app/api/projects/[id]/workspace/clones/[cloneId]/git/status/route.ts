/**
 * GET /api/projects/[id]/workspace/clones/[cloneId]/git/status
 *
 * Get git status for a local clone
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
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
    // Fetch status from local server
    const response = await fetch(
      `http://${clone.local_server_host}/repos/${cloneId}/status`,
      { signal: AbortSignal.timeout(5000) }
    )

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'Failed to get git status')
    }

    const status = await response.json()

    // Update clone state in database
    await supabase
      .from('local_repo_clones')
      .update({
        current_branch: status.current_branch,
        current_sha: status.current_sha,
        is_dirty: (status.modified_files?.length || 0) > 0 || (status.staged_files?.length || 0) > 0,
        ahead_count: status.ahead_count || 0,
        behind_count: status.behind_count || 0,
      })
      .eq('id', cloneId)

    return NextResponse.json(status)
  } catch (error) {
    console.error('[GitStatus] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get git status' },
      { status: 500 }
    )
  }
}
