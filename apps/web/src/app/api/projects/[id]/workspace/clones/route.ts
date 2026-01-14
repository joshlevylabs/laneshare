/**
 * GET /api/projects/[id]/workspace/clones
 * List all local repo clones for a project
 *
 * POST /api/projects/[id]/workspace/clones
 * Initiate a clone of a repository to the local server
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createCloneSchema = z.object({
  repoId: z.string().uuid(),
  branch: z.string().optional(),
  localServerHost: z.string().default('localhost:7890'),
})

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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

  // Fetch clones with repo info
  const { data: clones, error } = await supabase
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
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[WorkspaceClones] Error fetching clones:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(clones || [])
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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

  const canClone = ['admin', 'maintainer', 'owner'].includes(membership.role)
  if (!canClone) {
    return NextResponse.json(
      { error: 'Only maintainers and admins can clone repositories' },
      { status: 403 }
    )
  }

  // Parse and validate request body
  const body = await request.json()
  const result = createCloneSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { repoId, branch, localServerHost } = result.data

  // Get repo info
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch, github_installation_token')
    .eq('id', repoId)
    .eq('project_id', projectId)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check if clone already exists for this repo
  const { data: existingClone } = await supabase
    .from('local_repo_clones')
    .select('id')
    .eq('repo_id', repoId)
    .eq('project_id', projectId)
    .single()

  if (existingClone) {
    return NextResponse.json(
      { error: 'Clone already exists for this repository', cloneId: existingClone.id },
      { status: 409 }
    )
  }

  // Generate local path
  const localPath = `workspaces/${projectId}/${repo.owner}-${repo.name}`

  // Create clone record in PENDING status
  const { data: clone, error: createError } = await supabase
    .from('local_repo_clones')
    .insert({
      repo_id: repoId,
      project_id: projectId,
      local_path: localPath,
      local_server_host: localServerHost,
      clone_status: 'PENDING',
      current_branch: branch || repo.default_branch,
      created_by: user.id,
    })
    .select(`
      *,
      repo:repos (
        id,
        owner,
        name,
        default_branch
      )
    `)
    .single()

  if (createError) {
    console.error('[WorkspaceClones] Error creating clone:', createError)
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  // Initiate clone on local server (fire and forget)
  // The local server will update the status via webhook or polling
  try {
    const cloneResponse = await fetch(`http://${localServerHost}/repos/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: `https://github.com/${repo.owner}/${repo.name}.git`,
        target_path: localPath,
        branch: branch || repo.default_branch,
        clone_id: clone.id,
        // Note: In production, you'd pass a short-lived token here
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (cloneResponse.ok) {
      // Update status to CLONING
      await supabase
        .from('local_repo_clones')
        .update({ clone_status: 'CLONING' })
        .eq('id', clone.id)
    }
  } catch (error) {
    console.error('[WorkspaceClones] Error initiating clone on local server:', error)
    // Update with error status
    await supabase
      .from('local_repo_clones')
      .update({
        clone_status: 'ERROR',
        clone_error: 'Failed to connect to local server. Make sure it is running.',
      })
      .eq('id', clone.id)
  }

  return NextResponse.json(clone, { status: 201 })
}
