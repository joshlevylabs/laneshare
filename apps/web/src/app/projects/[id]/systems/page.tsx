import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SystemsListView } from '@/components/systems/systems-list-view'

export default async function SystemsPage({
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

  // Fetch systems for this project
  const { data: systems, error } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        graph_json,
        generated_at
      )
    `)
    .eq('project_id', params.id)
    .order('name')

  if (error) {
    console.error('Failed to fetch systems:', error)
  }

  // Transform to include computed fields
  const systemsWithCounts = (systems || []).map((system) => {
    const latestSnapshot = system.system_flow_snapshots
      ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

    const nodeCount = latestSnapshot?.graph_json?.nodes?.length || 0

    const { system_flow_snapshots, ...systemData } = system

    return {
      ...systemData,
      latest_snapshot: latestSnapshot,
      node_count: nodeCount,
    }
  })

  // Fetch project name
  const { data: project } = await supabase
    .from('projects')
    .select('name')
    .eq('id', params.id)
    .single()

  // Check user role
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  const isAdmin = membership?.role === 'OWNER' || membership?.role === 'MAINTAINER'

  return (
    <SystemsListView
      projectId={params.id}
      projectName={project?.name || 'Unknown Project'}
      systems={systemsWithCounts}
      isAdmin={isAdmin}
    />
  )
}
