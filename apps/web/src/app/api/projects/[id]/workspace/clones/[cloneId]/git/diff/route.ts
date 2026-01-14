/**
 * GET /api/projects/[id]/workspace/clones/[cloneId]/git/diff
 *
 * Get file diffs for a local clone
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

  // Get optional file_path query param
  const { searchParams } = new URL(request.url)
  const filePath = searchParams.get('file_path')

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
    // Fetch diff from local server
    const url = new URL(`http://${clone.local_server_host}/repos/${cloneId}/diff`)
    if (filePath) {
      url.searchParams.set('file_path', filePath)
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.message || 'Failed to get diff')
    }

    const diffResult = await response.json()

    return NextResponse.json(diffResult)
  } catch (error) {
    console.error('[GitDiff] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get diff' },
      { status: 500 }
    )
  }
}
