import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewSystemWizard } from '@/components/systems/new-system-wizard'

export default async function NewSystemPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Check admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    redirect(`/projects/${params.id}/systems`)
  }

  // Fetch repos for selection
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)
    .order('name')

  // Fetch project name
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  return (
    <NewSystemWizard
      projectId={params.id}
      projectName={project?.name || 'Unknown Project'}
      repos={repos || []}
    />
  )
}
