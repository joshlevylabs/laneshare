import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { owner: string; repo: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get GitHub connection
  const { data: connection } = await supabase
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', user.id)
    .single()

  if (!connection) {
    return NextResponse.json(
      { error: 'GitHub not connected' },
      { status: 400 }
    )
  }

  try {
    const github = await GitHubClient.fromEncryptedToken(connection.access_token_encrypted)
    const branches = await github.listBranches(params.owner, params.repo)

    return NextResponse.json(branches)
  } catch (error) {
    console.error('Error fetching branches:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch branches' },
      { status: 500 }
    )
  }
}
