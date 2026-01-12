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

  // Get user's GitHub connection
  const { data: connection, error } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  if (error || !connection) {
    return NextResponse.json(
      { error: 'GitHub not connected. Please connect your GitHub account first.' },
      { status: 400 }
    )
  }

  try {
    const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
    const repos = await github.listRepos({
      visibility: 'all',
      sort: 'pushed',
      per_page: 100,
    })

    return NextResponse.json(repos)
  } catch (error) {
    console.error('Failed to fetch GitHub repos:', error)
    return NextResponse.json(
      { error: 'Failed to fetch repositories from GitHub' },
      { status: 500 }
    )
  }
}
