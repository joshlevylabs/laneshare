import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DocumentsView } from '@/components/documents/documents-view'

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { category?: string; search?: string }
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

  // Fetch documents
  let query = supabase
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
      creator:profiles!documents_created_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })

  if (searchParams.category) {
    query = query.eq('category', searchParams.category)
  }

  if (searchParams.search) {
    query = query.or(`title.ilike.%${searchParams.search}%,description.ilike.%${searchParams.search}%`)
  }

  const { data: documents } = await query

  // Transform to extract first creator from array (Supabase returns arrays for joins)
  const docsWithCreator = (documents || []).map((doc) => {
    const { creator, ...docData } = doc as typeof doc & { creator: unknown[] }
    return {
      ...docData,
      creator: Array.isArray(creator) ? creator[0] : creator,
    }
  })

  return (
    <DocumentsView
      projectId={params.id}
      projectName={project.name}
      documents={docsWithCreator}
      initialCategory={searchParams.category}
      initialSearch={searchParams.search}
      userRole={membership.role}
    />
  )
}
