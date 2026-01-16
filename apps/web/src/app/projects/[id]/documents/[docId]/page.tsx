import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { DocumentDetailView } from '@/components/documents/document-detail-view'

export default async function DocumentPage({
  params,
}: {
  params: { id: string; docId: string }
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

  // Fetch document
  const { data: document, error } = await supabase
    .from('documents')
    .select(`
      id,
      project_id,
      title,
      slug,
      category,
      description,
      tags,
      markdown,
      created_by,
      created_at,
      updated_by,
      updated_at,
      creator:profiles!documents_created_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      ),
      updater:profiles!documents_updated_by_fkey (
        id,
        email,
        full_name,
        avatar_url
      )
    `)
    .eq('id', params.docId)
    .eq('project_id', params.id)
    .single()

  if (error || !document) {
    notFound()
  }

  // Fetch references to this document
  const { data: references } = await supabase
    .from('document_references')
    .select('*')
    .eq('document_id', params.docId)
    .eq('project_id', params.id)

  // Get source details
  const taskIds = (references || []).filter((r) => r.source_type === 'task').map((r) => r.source_id)
  const systemIds = (references || []).filter((r) => r.source_type === 'system').map((r) => r.source_id)
  const docIds = (references || []).filter((r) => r.source_type === 'document').map((r) => r.source_id)

  const [tasksResult, systemsResult, docsResult] = await Promise.all([
    taskIds.length > 0
      ? supabase.from('tasks').select('id, key, title, status, type').in('id', taskIds)
      : { data: [] },
    systemIds.length > 0
      ? supabase.from('systems').select('id, name, slug, status').in('id', systemIds)
      : { data: [] },
    docIds.length > 0
      ? supabase.from('documents').select('id, title, slug, category').in('id', docIds)
      : { data: [] },
  ])

  const tasksMap = new Map((tasksResult.data || []).map((t) => [t.id, t]))
  const systemsMap = new Map((systemsResult.data || []).map((s) => [s.id, s]))
  const docsMap = new Map((docsResult.data || []).map((d) => [d.id, d]))

  const referencesWithSources = (references || []).map((ref) => ({
    ...ref,
    source:
      ref.source_type === 'task'
        ? tasksMap.get(ref.source_id)
        : ref.source_type === 'system'
        ? systemsMap.get(ref.source_id)
        : docsMap.get(ref.source_id),
  }))

  // Fetch project info for breadcrumb
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', params.id)
    .single()

  // Transform document to extract first creator/updater from arrays
  // Cast through unknown to handle DB null vs TS undefined mismatch
  const docWithUsers = {
    ...document,
    creator: Array.isArray(document.creator) ? document.creator[0] : document.creator,
    updater: Array.isArray(document.updater) ? document.updater[0] : document.updater,
  } as unknown as Parameters<typeof DocumentDetailView>[0]['document']

  return (
    <DocumentDetailView
      projectId={params.id}
      projectName={project?.name || 'Project'}
      document={docWithUsers}
      references={referencesWithSources as unknown as Parameters<typeof DocumentDetailView>[0]['references']}
      userRole={membership.role}
      userId={user.id}
    />
  )
}
