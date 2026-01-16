import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DocumentBuilderWizard } from '@/components/documents/document-builder-wizard'

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { sessionId?: string }
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

  // Fetch existing session if resuming
  let existingSession = null
  if (searchParams.sessionId) {
    const { data: session } = await supabase
      .from('document_builder_sessions')
      .select('*')
      .eq('id', searchParams.sessionId)
      .eq('project_id', params.id)
      .eq('created_by', user.id)
      .single()

    if (session) {
      existingSession = session
    }
  }

  // Fetch available context
  const [reposResult, servicesResult, systemsResult, tasksResult, docsResult] = await Promise.all([
    supabase
      .from('repos')
      .select('id, owner, name, default_branch, status')
      .eq('project_id', params.id)
      .eq('status', 'SYNCED'),
    supabase
      .from('project_service_connections')
      .select('id, service, display_name, status')
      .eq('project_id', params.id)
      .eq('status', 'CONNECTED'),
    supabase
      .from('systems')
      .select('id, name, slug, description')
      .eq('project_id', params.id),
    supabase
      .from('tasks')
      .select('id, key, title, status, type')
      .eq('project_id', params.id)
      .neq('status', 'DONE')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('documents')
      .select('id, title, slug, category')
      .eq('project_id', params.id)
      .order('updated_at', { ascending: false })
      .limit(50),
  ])

  const availableContext = {
    repos: reposResult.data || [],
    services: servicesResult.data || [],
    systems: systemsResult.data || [],
    tasks: tasksResult.data || [],
    docs: docsResult.data || [],
  }

  return (
    <DocumentBuilderWizard
      projectId={params.id}
      projectName={project.name}
      userId={user.id}
      // Cast through unknown to handle DB null vs TS undefined mismatch
      existingSession={existingSession as unknown as import('@laneshare/shared').DocumentBuilderSession | null}
      availableContext={availableContext as unknown as Parameters<typeof DocumentBuilderWizard>[0]['availableContext']}
    />
  )
}
