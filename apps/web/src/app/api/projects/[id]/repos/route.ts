import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const addRepoSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  defaultBranch: z.string().default('main'),
  selectedBranch: z.string().optional(),
  autoSyncEnabled: z.boolean().default(false),
})

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

  const { data: repos, error } = await supabase
    .from('repos')
    .select('*')
    .eq('project_id', params.id)
    .order('installed_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(repos)
}

export async function POST(
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

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can add repositories' },
      { status: 403 }
    )
  }

  const body = await request.json()
  const result = addRepoSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { owner, name, defaultBranch, selectedBranch, autoSyncEnabled } = result.data

  // Check if repo already exists (with same branch)
  const { data: existing } = await supabase
    .from('repos')
    .select('id')
    .eq('project_id', params.id)
    .eq('owner', owner)
    .eq('name', name)
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'This repository is already added to the project' },
      { status: 400 }
    )
  }

  // Get user's GitHub connection for webhook registration
  const { data: connection } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  let webhookId: number | null = null

  // Register webhook if auto-sync is enabled
  if (autoSyncEnabled && connection?.access_token_encrypted) {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    if (webhookSecret && appUrl) {
      try {
        const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
        const webhook = await github.createWebhook(
          owner,
          name,
          `${appUrl}/api/webhooks/github`,
          webhookSecret,
          ['push']
        )
        webhookId = webhook.id
        console.log(`[Webhook] Created webhook ${webhookId} for ${owner}/${name}`)
      } catch (webhookError) {
        console.error('[Webhook] Failed to create webhook:', webhookError)
        // Continue without webhook - user can still manually sync
      }
    }
  }

  // Add the repo
  const { data: repo, error } = await supabase
    .from('repos')
    .insert({
      project_id: params.id,
      provider: 'github',
      owner,
      name,
      default_branch: defaultBranch,
      selected_branch: selectedBranch || defaultBranch,
      auto_sync_enabled: autoSyncEnabled,
      webhook_id: webhookId,
      status: 'PENDING',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(repo, { status: 201 })
}
