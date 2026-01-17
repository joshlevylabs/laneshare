import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DocumentsView } from '@/components/documents/documents-view'

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { category?: string; search?: string; repo?: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Check project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    redirect('/projects')
  }

  // Fetch project info
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', params.id)
    .single()

  if (!project) {
    redirect('/projects')
  }

  // Fetch all documents (category filtering is done client-side to preserve counts)
  const { data: documents, error: docsError } = await supabase
    .from('documents')
    .select(`
      id,
      project_id,
      title,
      slug,
      category,
      description,
      tags,
      created_by,
      created_at,
      updated_by,
      updated_at,
      source_repo_id,
      source_bundle_id,
      source_repo_page_id,
      evidence_json,
      original_markdown,
      verification_score,
      verification_issues,
      needs_review,
      reviewed,
      reviewed_at,
      reviewed_by,
      user_edited,
      user_edited_at,
      creator:profiles!documents_created_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      ),
      source_repo:repos!documents_source_repo_id_fkey (
        id,
        owner,
        name
      )
    `)
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  if (docsError) {
    console.error('[DocumentsPage] Error fetching documents:', docsError.message, docsError.code, docsError.details)
  }
  console.log(`[DocumentsPage] Fetched ${documents?.length || 0} documents for project ${params.id}`)

  // Transform to extract first creator/source_repo from array (Supabase returns arrays for joins)
  // Cast through unknown to handle DB null vs TS undefined mismatch
  const docsWithJoins = (documents || []).map((doc) => {
    const { creator, source_repo, ...docData } = doc as typeof doc & {
      creator: unknown[]
      source_repo: unknown[]
    }
    return {
      ...docData,
      creator: Array.isArray(creator) ? creator[0] : creator,
      source_repo: Array.isArray(source_repo) ? source_repo[0] : source_repo,
    }
  }) as unknown as Parameters<typeof DocumentsView>[0]['documents']

  return (
    <DocumentsView
      projectId={params.id}
      projectName={project.name}
      documents={docsWithJoins}
      initialCategory={searchParams.category}
      initialSearch={searchParams.search}
      initialRepoId={searchParams.repo}
      userRole={membership.role}
    />
  )
}
