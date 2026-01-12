import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Try to get token from github_connections (both OAuth and PAT tokens are stored here)
  const { data: connection } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  if (connection?.access_token_encrypted) {
    try {
      const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
      const repos = await github.listRepos({
        visibility: 'all',
        sort: 'pushed',
        per_page: 100,
      })
      return NextResponse.json(repos)
    } catch (err) {
      console.error('Failed to use stored token:', err)
    }
  }

  // Fallback: try to get provider token from current session (for users who logged in before token storage was implemented)
  const { data: { session } } = await supabase.auth.getSession()

  if (session?.provider_token && user.app_metadata?.provider === 'github') {
    try {
      const github = new GitHubClient(session.provider_token)
      const repos = await github.listRepos({
        visibility: 'all',
        sort: 'pushed',
        per_page: 100,
      })
      return NextResponse.json(repos)
    } catch (error) {
      console.error('Failed to use session provider token:', error)
    }
  }

  return NextResponse.json(
    { error: 'GitHub not connected. Please connect your GitHub account first.' },
    { status: 400 }
  )
}
