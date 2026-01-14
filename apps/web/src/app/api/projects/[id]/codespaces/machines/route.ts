/**
 * Codespace Machines API Route
 *
 * List available machine types for creating codespaces.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'

/**
 * GET /api/projects/[id]/codespaces/machines?repoId=xxx
 * List available machine types for a repository
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id: projectId } = params
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

  const { searchParams } = new URL(request.url)
  const repoId = searchParams.get('repoId')

  if (!repoId) {
    return NextResponse.json({ error: 'repoId is required' }, { status: 400 })
  }

  // Get repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, github_token_encrypted')
    .eq('id', repoId)
    .eq('project_id', projectId)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  if (!repo.github_token_encrypted) {
    return NextResponse.json({ error: 'Repository has no GitHub token configured' }, { status: 400 })
  }

  try {
    const github = await GitHubClient.fromEncryptedToken(repo.github_token_encrypted)
    const { machines } = await github.listCodespaceMachines(repo.owner, repo.name)

    return NextResponse.json({ machines })
  } catch (error) {
    console.error('[Codespaces] Error listing machines:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list machines' },
      { status: 500 }
    )
  }
}
