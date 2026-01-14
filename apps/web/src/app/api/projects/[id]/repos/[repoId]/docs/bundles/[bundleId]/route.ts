/**
 * GET /api/projects/[id]/repos/[repoId]/docs/bundles/[bundleId]
 *
 * Fetches a specific documentation bundle with progress info
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string; repoId: string; bundleId: string } }
) {
  const { id: projectId, repoId, bundleId } = params
  const supabase = createServerSupabaseClient()

  try {
    // Authenticate
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check project membership
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Not a project member' }, { status: 403 })
    }

    // Fetch the bundle
    const { data: bundle, error } = await supabase
      .from('repo_doc_bundles')
      .select('id, version, status, progress_json, summary_json, error, generated_at, created_at')
      .eq('id', bundleId)
      .eq('repo_id', repoId)
      .eq('project_id', projectId)
      .single()

    if (error || !bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
    }

    return NextResponse.json(bundle)
  } catch (error) {
    console.error('[BundleAPI] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
