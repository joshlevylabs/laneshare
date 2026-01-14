/**
 * Codespaces API Routes
 *
 * Manages GitHub Codespaces for workspace sessions.
 * Allows listing, creating, starting, and stopping codespaces.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'

/**
 * GET /api/projects/[id]/codespaces
 * List codespaces for project repositories
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

  // Get project repos
  const { data: repos, error: reposError } = await supabase
    .from('repos')
    .select('id, owner, name, github_token_encrypted')
    .eq('project_id', projectId)

  if (reposError || !repos || repos.length === 0) {
    return NextResponse.json({ codespaces: [], repos: [] })
  }

  // Get codespaces for each repo
  const allCodespaces: Array<{
    codespace: Awaited<ReturnType<GitHubClient['getCodespace']>>
    repoId: string
    repoFullName: string
  }> = []

  for (const repo of repos) {
    if (!repo.github_token_encrypted) continue

    try {
      const github = await GitHubClient.fromEncryptedToken(repo.github_token_encrypted)
      const { codespaces } = await github.listRepoCodespaces(repo.owner, repo.name)

      for (const cs of codespaces) {
        allCodespaces.push({
          codespace: cs,
          repoId: repo.id,
          repoFullName: `${repo.owner}/${repo.name}`,
        })
      }
    } catch (error) {
      console.error(`[Codespaces] Error listing codespaces for ${repo.owner}/${repo.name}:`, error)
    }
  }

  return NextResponse.json({
    codespaces: allCodespaces,
    repos: repos.map(r => ({
      id: r.id,
      fullName: `${r.owner}/${r.name}`,
      hasToken: !!r.github_token_encrypted,
    })),
  })
}

/**
 * POST /api/projects/[id]/codespaces
 * Create a new codespace for a repository
 */
export async function POST(
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

  const body = await request.json()
  const { repoId, ref, machine, displayName } = body

  if (!repoId) {
    return NextResponse.json({ error: 'repoId is required' }, { status: 400 })
  }

  // Get repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, owner, name, default_branch, github_token_encrypted')
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

    const codespace = await github.createCodespace(repo.owner, repo.name, {
      ref: ref || repo.default_branch,
      machine,
      display_name: displayName || `laneshare-${projectId.slice(0, 8)}`,
      idle_timeout_minutes: 30,
    })

    return NextResponse.json({ codespace })
  } catch (error) {
    console.error('[Codespaces] Error creating codespace:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create codespace' },
      { status: 500 }
    )
  }
}
