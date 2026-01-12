import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { runDocGeneration } from '@/lib/doc-generator'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin status
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can regenerate documentation' },
      { status: 403 }
    )
  }

  // Get all synced repos for this project
  const { data: repos, error: reposError } = await supabase
    .from('repos')
    .select('id, owner, name, status')
    .eq('project_id', params.id)
    .eq('status', 'SYNCED')

  if (reposError) {
    return NextResponse.json({ error: reposError.message }, { status: 500 })
  }

  if (!repos || repos.length === 0) {
    return NextResponse.json(
      { error: 'No synced repositories found. Please sync a repository first.' },
      { status: 400 }
    )
  }

  // Run doc generation for the first synced repo (this will also handle multi-repo)
  const primaryRepoId = repos[0].id

  // Start generation in background
  runDocGeneration(params.id, primaryRepoId, serviceClient)
    .then((result) => {
      console.log(`[DocGen] Manual regeneration completed for project ${params.id}:`, {
        hasArchitecture: !!result.architectureDoc,
        hasFeatures: !!result.featuresDoc,
        hasMultiRepo: !!result.multiRepoDoc,
        errors: result.errors,
      })
    })
    .catch((error) => {
      console.error(`[DocGen] Manual regeneration failed for project ${params.id}:`, error)
    })

  return NextResponse.json({
    message: 'Documentation generation started',
    repos: repos.map((r) => `${r.owner}/${r.name}`),
  })
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Get the current state of generated docs
  const { data: docs } = await supabase
    .from('doc_pages')
    .select('slug, title, category, updated_at')
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  // Get synced repos count
  const { count: syncedReposCount } = await supabase
    .from('repos')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', params.id)
    .eq('status', 'SYNCED')

  return NextResponse.json({
    docs: docs || [],
    syncedReposCount: syncedReposCount || 0,
    canGenerate: (syncedReposCount || 0) > 0,
  })
}
