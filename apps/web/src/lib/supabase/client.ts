import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './types'

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // During build time, return a dummy client that will be replaced at runtime
    // This allows static generation to proceed
    if (typeof window === 'undefined') {
      return createBrowserClient<Database>(
        'https://placeholder.supabase.co',
        'placeholder-key'
      )
    }
    throw new Error('Missing Supabase environment variables')
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}
