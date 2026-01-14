/**
 * GET /api/projects/[id]/repos/[repoId]/docs/pages
 *
 * List documentation pages for a repository bundle.
 * Supports filtering by bundleId and category.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { RepoDocCategory } from '@laneshare/shared'

export async function GET(
  request: Request,
  { params }: { params: { id: string; repoId: string } }
) {
  const projectId = params.id
  const repoId = params.repoId
  const supabase = createServerSupabaseClient()
  const url = new URL(request.url)
  const bundleId = url.searchParams.get('bundleId')
  const category = url.searchParams.get('category') as RepoDocCategory | null

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

    // Verify repo and get current bundle if not specified
    const { data: repo } = await supabase
      .from('repos')
      .select('id, owner, name, doc_bundle_id')
      .eq('id', repoId)
      .eq('project_id', projectId)
      .single()

    if (!repo) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    }

    const targetBundleId = bundleId || repo.doc_bundle_id

    if (!targetBundleId) {
      return NextResponse.json({
        pages: [],
        bundle_id: null,
        message: 'No documentation bundle found',
      })
    }

    // Build query
    let query = supabase
      .from('repo_doc_pages')
      .select(`
        id,
        bundle_id,
        category,
        slug,
        title,
        needs_review,
        user_edited,
        user_edited_at,
        created_at,
        updated_at
      `)
      .eq('bundle_id', targetBundleId)

    // Apply category filter if specified
    if (category && ['ARCHITECTURE', 'API', 'FEATURE', 'RUNBOOK'].includes(category)) {
      query = query.eq('category', category)
    }

    // Order by category and slug
    query = query.order('category').order('slug')

    const { data: pages, error } = await query

    if (error) {
      console.error('[DocPages] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 })
    }

    // Get bundle info
    const { data: bundle } = await supabase
      .from('repo_doc_bundles')
      .select('id, version, status, generated_at, summary_json')
      .eq('id', targetBundleId)
      .single()

    return NextResponse.json({
      repo: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
      },
      bundle: bundle || null,
      pages: pages || [],
    })
  } catch (error) {
    console.error('[DocPages] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
