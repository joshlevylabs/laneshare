import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

// Verify GitHub webhook signature
function verifySignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false

  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET

  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const payload = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const event = request.headers.get('x-github-event')

  // Verify signature
  if (!verifySignature(payload, signature, secret)) {
    console.error('Invalid webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = JSON.parse(payload)

  // Handle ping event (webhook confirmation)
  if (event === 'ping') {
    console.log('GitHub webhook ping received:', data.zen)
    return NextResponse.json({ message: 'pong' })
  }

  // Handle push event
  if (event === 'push') {
    const supabase = createServiceRoleClient()

    // Extract repo info
    const owner = data.repository?.owner?.login || data.repository?.owner?.name
    const repoName = data.repository?.name
    const ref = data.ref // e.g., "refs/heads/main"
    const branch = ref?.replace('refs/heads/', '')
    const latestCommitSha = data.after // The latest commit SHA

    if (!owner || !repoName || !branch) {
      console.error('Missing repo info in webhook payload')
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    console.log(`[Webhook] Push to ${owner}/${repoName}:${branch} - commit ${latestCommitSha}`)

    // Find matching repos (could be multiple projects tracking same repo/branch)
    const { data: repos, error } = await supabase
      .from('repos')
      .select('id, project_id, auto_sync_enabled, last_synced_commit_sha')
      .eq('owner', owner)
      .eq('name', repoName)
      .or(`selected_branch.eq.${branch},and(selected_branch.is.null,default_branch.eq.${branch})`)

    if (error) {
      console.error('Error finding repos:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!repos || repos.length === 0) {
      console.log(`No repos found tracking ${owner}/${repoName}:${branch}`)
      return NextResponse.json({ message: 'No matching repos' })
    }

    // Update each matching repo
    for (const repo of repos) {
      // Check if this is actually a new commit
      if (repo.last_synced_commit_sha === latestCommitSha) {
        console.log(`[Webhook] Repo ${repo.id} already at commit ${latestCommitSha}`)
        continue
      }

      // Update latest commit and has_updates flag
      await supabase
        .from('repos')
        .update({
          latest_commit_sha: latestCommitSha,
          has_updates: true,
        })
        .eq('id', repo.id)

      console.log(`[Webhook] Updated repo ${repo.id} - has_updates=true`)

      // If auto-sync is enabled, trigger sync
      if (repo.auto_sync_enabled) {
        console.log(`[Webhook] Auto-sync enabled for repo ${repo.id}, triggering sync...`)

        // Trigger sync by calling the internal sync endpoint
        // We use the internal API to trigger the sync
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
          await fetch(`${appUrl}/api/repos/${repo.id}/sync/webhook-trigger`, {
            method: 'POST',
            headers: {
              'X-Webhook-Secret': secret,
            },
          })
        } catch (syncError) {
          console.error(`[Webhook] Failed to trigger auto-sync for repo ${repo.id}:`, syncError)
        }
      }
    }

    return NextResponse.json({ message: 'Processed', repos_updated: repos.length })
  }

  // Unhandled event
  console.log(`Unhandled GitHub event: ${event}`)
  return NextResponse.json({ message: 'Event not handled' })
}
