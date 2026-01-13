import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const updateSchema = z.object({
  autoSyncEnabled: z.boolean(),
})

export async function PATCH(
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

  // Get the repo
  const { data: repo, error: repoError } = await supabase
    .from('repos')
    .select('*, projects!inner(owner_id)')
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
      { error: 'Only project owners and maintainers can modify repository settings' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = updateSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { autoSyncEnabled } = result.data

  // Get user's GitHub connection
  const { data: connection } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  let webhookId = repo.webhook_id

  // Handle webhook creation/deletion based on auto-sync toggle
  if (autoSyncEnabled && !repo.webhook_id && connection?.access_token_encrypted) {
    // Create webhook when enabling auto-sync
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    if (webhookSecret && appUrl) {
      try {
        const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
        const webhook = await github.createWebhook(
          repo.owner,
          repo.name,
          `${appUrl}/api/webhooks/github`,
          webhookSecret,
          ['push']
        )
        webhookId = webhook.id
        console.log(`[Webhook] Created webhook ${webhookId} for ${repo.owner}/${repo.name}`)
      } catch (webhookError) {
        console.error('[Webhook] Failed to create webhook:', webhookError)
        // Continue without webhook
      }
    }
  } else if (!autoSyncEnabled && repo.webhook_id && connection?.access_token_encrypted) {
    // Delete webhook when disabling auto-sync
    try {
      const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
      await github.deleteWebhook(repo.owner, repo.name, repo.webhook_id)
      webhookId = null
      console.log(`[Webhook] Deleted webhook ${repo.webhook_id} for ${repo.owner}/${repo.name}`)
    } catch (webhookError) {
      console.error('[Webhook] Failed to delete webhook:', webhookError)
      // Continue anyway - webhook might already be deleted
      webhookId = null
    }
  }

  // Update the repo
  const { error: updateError } = await supabase
    .from('repos')
    .update({
      auto_sync_enabled: autoSyncEnabled,
      webhook_id: webhookId,
    })
    .eq('id', params.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, autoSyncEnabled, webhookId })
}
