import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: repo, error } = await supabase
    .from('repos')
    .select('*')
    .eq('id', params.id)
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
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return NextResponse.json(repo)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the repo with all details needed for webhook cleanup
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('project_id, owner, name, webhook_id')
    .eq('id', params.id)
    .single()

  if (repoError || !repo) {
    return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', repo.project_id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can delete repositories' },
      { status: 403 }
    )
  }

  // Delete webhook from GitHub if it exists
  if (repo.webhook_id) {
    const { data: connection } = await supabase
      .from('github_connections')
      .select('access_token_encrypted')
      .eq('user_id', user.id)
      .single()

    if (connection?.access_token_encrypted) {
      try {
        const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
        await github.deleteWebhook(repo.owner, repo.name, repo.webhook_id)
        console.log(`[Webhook] Deleted webhook ${repo.webhook_id} for ${repo.owner}/${repo.name}`)
      } catch (webhookError) {
        console.error('[Webhook] Failed to delete webhook:', webhookError)
        // Continue with repo deletion anyway
      }
    }
  }

  // Delete repo (cascades to chunks and files)
  const { error } = await supabase.from('repos').delete().eq('id', params.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
