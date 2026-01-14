/**
 * GET /api/projects/[id]/repos/[repoId]/docs/bundles
 *
 * List all documentation bundles for a repository.
 * Returns versions with status and summary info.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string; repoId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
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
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Verify repo belongs to project
    const { data: repo } = await supabase
      .from('repos')
      .select('id, owner, name, doc_status, doc_bundle_id')
      .eq('id', repoId)
      .eq('project_id', projectId)
      .single()

    if (!repo) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    // Get all bundles
    const { data: bundles, error } = await supabase
      .from('repo_doc_bundles')
      .select(`
        id,
        version,
        status,
        generated_at,
        generated_by,
        source_fingerprint,
        summary_json,
        error,
        created_at,
        updated_at,
        generator:profiles!generated_by(id, email, full_name, avatar_url)
      `)
      .eq('repo_id', repoId)
      .order('version', { ascending: false })

    if (error) {
      console.error('[DocBundles] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch bundles' }, { status: 500 })
    }

    // Get page counts for each bundle
    const bundleIds = bundles.map(b => b.id)
    const { data: pageCounts } = await supabase
      .from('repo_doc_pages')
      .select('bundle_id')
      .in('bundle_id', bundleIds)

    const pageCountMap: Record<string, number> = {}
    for (const page of pageCounts || []) {
      pageCountMap[page.bundle_id] = (pageCountMap[page.bundle_id] || 0) + 1
    }

    // Add page count to bundles
    const bundlesWithCounts = bundles.map(bundle => ({
      ...bundle,
      page_count: pageCountMap[bundle.id] || 0,
    }))

    return NextResponse.json({
      repo: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        doc_status: repo.doc_status,
        current_bundle_id: repo.doc_bundle_id,
      },
      bundles: bundlesWithCounts,
    })
  } catch (error) {
    console.error('[DocBundles] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
