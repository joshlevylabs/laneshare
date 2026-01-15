/**
 * Codespaces Token API
 *
 * Manages GitHub personal access tokens for Codespaces API access.
 * Tokens must have the 'codespace' scope to manage codespaces.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/encryption'
import { GitHubClient } from '@/lib/github'

/**
 * GET /api/repos/[id]/codespaces-token
 * Check if a GitHub token is configured for this repo
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get repo and check permissions
  const { data: repo, error } = await supabase
    .from('repos')
    .select('id, project_id, github_token_encrypted')
    .eq('id', id)
    .single()

  if (error || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    hasToken: !!repo.github_token_encrypted,
  })
}

/**
 * POST /api/repos/[id]/codespaces-token
 * Set or update the GitHub token for Codespaces access
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { token } = body

  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }

  // Get repo and check permissions
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, project_id, owner, name')
    .eq('id', id)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project admin membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project owners and maintainers can configure tokens' }, { status: 403 })
  }

  // Validate the token by making a test API call
  try {
    const github = new GitHubClient(token)

    // Test that we can access the user's info
    await github.getUser()

    // Test that we can access the repo (to verify repo access)
    await github.getRepo(repo.owner, repo.name)

    // Test codespace access (list codespaces for the repo)
    await github.listRepoCodespaces(repo.owner, repo.name)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message.includes('401') || message.includes('Bad credentials')) {
      return NextResponse.json({
        error: 'Invalid token. Please check your GitHub personal access token.'
      }, { status: 400 })
    }

    if (message.includes('403')) {
      return NextResponse.json({
        error: 'Token lacks required permissions. Please ensure the token has "codespace" scope.'
      }, { status: 400 })
    }

    if (message.includes('404')) {
      return NextResponse.json({
        error: 'Cannot access this repository. Please ensure the token has access to the repo.'
      }, { status: 400 })
    }

    return NextResponse.json({
      error: `Token validation failed: ${message}`
    }, { status: 400 })
  }

  // Encrypt and store the token
  const encryptedToken = await encrypt(token)

  const { error: updateError } = await supabase
    .from('repos')
    .update({ github_token_encrypted: encryptedToken })
    .eq('id', id)

  if (updateError) {
    console.error('[CodespacesToken] Error saving token:', updateError)
    return NextResponse.json({ error: 'Failed to save token' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

/**
 * DELETE /api/repos/[id]/codespaces-token
 * Remove the GitHub token for this repo
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get repo and check permissions
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('id, project_id')
    .eq('id', id)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project admin membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project owners and maintainers can configure tokens' }, { status: 403 })
  }

  const { error: updateError } = await supabase
    .from('repos')
    .update({ github_token_encrypted: null })
    .eq('id', id)

  if (updateError) {
    console.error('[CodespacesToken] Error removing token:', updateError)
    return NextResponse.json({ error: 'Failed to remove token' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
