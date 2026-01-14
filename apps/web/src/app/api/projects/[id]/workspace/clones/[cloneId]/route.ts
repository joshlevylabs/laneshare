/**
 * GET /api/projects/[id]/workspace/clones/[cloneId]
 * Get details of a specific local clone
 *
 * DELETE /api/projects/[id]/workspace/clones/[cloneId]
 * Remove a local clone
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

  // Fetch clone with repo info
  const { data: clone, error } = await supabase
    .from('local_repo_clones')
    .select(`
      *,
      repo:repos (
        id,
        owner,
        name,
        default_branch
      )
    `)
    .eq('id', cloneId)
    .eq('project_id', projectId)
    .single()

  if (error || !clone) {
    return NextResponse.json({ error: 'Clone not found' }, { status: 404 })
  }

  // Try to get updated status from local server
  try {
    const statusResponse = await fetch(
      `http://${clone.local_server_host}/repos/${cloneId}/status`,
      { signal: AbortSignal.timeout(3000) }
    )

    if (statusResponse.ok) {
      const status = await statusResponse.json()

      // Update clone state in database
      await supabase
        .from('local_repo_clones')
        .update({
          clone_status: 'CLONED',
          current_branch: status.current_branch,
          current_sha: status.current_sha,
          is_dirty: status.modified_files?.length > 0 || status.staged_files?.length > 0,
          ahead_count: status.ahead_count || 0,
          behind_count: status.behind_count || 0,
        })
        .eq('id', cloneId)

      return NextResponse.json({
        ...clone,
        current_branch: status.current_branch,
        current_sha: status.current_sha,
        is_dirty: status.modified_files?.length > 0,
        ahead_count: status.ahead_count || 0,
        behind_count: status.behind_count || 0,
        modified_files: status.modified_files || [],
        staged_files: status.staged_files || [],
        untracked_files: status.untracked_files || [],
      })
    }
  } catch {
    // Local server not available, return cached state
  }

  return NextResponse.json(clone)
}

export async function DELETE(
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

  // Check project membership (must be admin/maintainer)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const canDelete = ['admin', 'maintainer', 'owner'].includes(membership.role)
  if (!canDelete) {
    return NextResponse.json(
      { error: 'Only maintainers and admins can delete clones' },
      { status: 403 }
    )
  }

  // Get clone info
  const { data: clone, error: cloneError } = await supabase
    .from('local_repo_clones')
    .select('id, local_path, local_server_host')
    .eq('id', cloneId)
    .eq('project_id', projectId)
    .single()

  if (cloneError || !clone) {
    return NextResponse.json({ error: 'Clone not found' }, { status: 404 })
  }

  // Try to delete from local server
  try {
    await fetch(`http://${clone.local_server_host}/repos/${cloneId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Continue with database deletion even if local server fails
  }

  // Delete from database
  const { error: deleteError } = await supabase
    .from('local_repo_clones')
    .delete()
    .eq('id', cloneId)

  if (deleteError) {
    console.error('[WorkspaceClones] Error deleting clone:', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
