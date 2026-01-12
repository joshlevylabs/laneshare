import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { encrypt } from '@/lib/encryption'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/projects'

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`)

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options) {
            response.cookies.set({ name, value, ...options })
          },
          remove(name: string, options) {
            response.cookies.set({ name, value: '', ...options })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      // If user logged in via GitHub OAuth and we have a provider token, store it
      if (
        data.session.provider_token &&
        data.user?.app_metadata?.provider === 'github'
      ) {
        try {
          // Use service role client to store the token (bypasses RLS)
          const serviceClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
              cookies: {
                get() { return undefined },
                set() {},
                remove() {},
              },
            }
          )

          const encryptedToken = await encrypt(data.session.provider_token)

          await serviceClient.from('github_connections').upsert(
            {
              user_id: data.user.id,
              provider: 'github',
              access_token_encrypted: encryptedToken,
            },
            {
              onConflict: 'user_id,provider',
            }
          )
        } catch (storeError) {
          // Log but don't block auth - user can still add PAT later
          console.error('Failed to store GitHub token:', storeError)
        }
      }

      return response
    }

    console.error('Auth callback error:', error)
  }

  // Return to login if there's an error
  return NextResponse.redirect(`${origin}/login?error=auth`)
}
