/**
 * Individual Codespace API Routes
 *
 * Manage a specific codespace: get status, start, stop, delete.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'

async function getGitHubClientForProject(supabase: ReturnType<typeof createServerSupabaseClient>, projectId: string) {
  // Get any repo from the project with a token
  const { data: repo } = await supabase
    .from('repos')
    .select('github_token_encrypted')
    .eq('project_id', projectId)
    .not('github_token_encrypted', 'is', null)
    .limit(1)
    .single()

  if (!repo?.github_token_encrypted) {
    return null
  }

  return GitHubClient.fromEncryptedToken(repo.github_token_encrypted)
}

/**
 * GET /api/projects/[id]/codespaces/[name]
 * Get codespace details
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string; name: string } }
) {
  const { id: projectId, name: codespaceName } = params
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

  const github = await getGitHubClientForProject(supabase, projectId)
  if (!github) {
    return NextResponse.json({ error: 'No GitHub token configured' }, { status: 400 })
  }

  try {
    const codespace = await github.getCodespace(codespaceName)
    return NextResponse.json({ codespace })
  } catch (error) {
    console.error('[Codespaces] Error getting codespace:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get codespace' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects/[id]/codespaces/[name]
 * Perform actions on a codespace (start, stop)
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string; name: string } }
) {
  const { id: projectId, name: codespaceName } = params
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
  const { action } = body

  if (!action || !['start', 'stop', 'export'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Use: start, stop, or export' }, { status: 400 })
  }

  const github = await getGitHubClientForProject(supabase, projectId)
  if (!github) {
    return NextResponse.json({ error: 'No GitHub token configured' }, { status: 400 })
  }

  try {
    let result

    switch (action) {
      case 'start':
        result = await github.startCodespace(codespaceName)
        break
      case 'stop':
        result = await github.stopCodespace(codespaceName)
        break
      case 'export':
        result = await github.exportCodespace(codespaceName)
        break
    }

    return NextResponse.json({ codespace: result })
  } catch (error) {
    console.error(`[Codespaces] Error ${action}ing codespace:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `Failed to ${action} codespace` },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/projects/[id]/codespaces/[name]
 * Delete a codespace
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; name: string } }
) {
  const { id: projectId, name: codespaceName } = params
  const supabase = createServerSupabaseClient()

  // Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership with admin/owner role for deletion
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project owners and maintainers can delete codespaces' }, { status: 403 })
  }

  const github = await getGitHubClientForProject(supabase, projectId)
  if (!github) {
    return NextResponse.json({ error: 'No GitHub token configured' }, { status: 400 })
  }

  try {
    await github.deleteCodespace(codespaceName)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Codespaces] Error deleting codespace:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete codespace' },
      { status: 500 }
    )
  }
}
