import { createServerSupabaseClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/encryption'
import { GitHubClient } from '@/lib/github'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const connectSchema = z.object({
  token: z.string().min(1),
})

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = connectSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { token } = result.data

  // Verify the token works
  try {
    const github = new GitHubClient(token)
    const ghUser = await github.getUser()

    if (!ghUser.login) {
      throw new Error('Invalid token')
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid GitHub token. Please check your token and try again.' },
      { status: 400 }
    )
  }

  // Encrypt and store the token
  const encryptedToken = await encrypt(token)

  const { error } = await supabase.from('github_connections').upsert(
    {
      user_id: user.id,
      provider: 'github',
      access_token_encrypted: encryptedToken,
    },
    {
      onConflict: 'user_id,provider',
    }
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
