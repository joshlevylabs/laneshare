import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { SystemDetailView } from '@/components/systems/system-detail-view'

export default async function SystemDetailPage({
  params,
}: {
  params: { id: string; systemId: string }
}) {
  const supabase = createServerSupabaseClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch system with all related data
  const { data: system, error } = await supabase
    .from('systems')
    .select(`
      *,
      system_artifacts (
        id,
        kind,
        content,
        content_json,
        created_by,
        created_at
      ),
      system_evidence (
        id,
        source_type,
        source_ref,
        excerpt,
        metadata,
        confidence,
        created_at
      ),
      system_flow_snapshots (
        id,
        version,
        graph_json,
        generated_at,
        generated_by,
        notes
      ),
      system_node_verifications (
        id,
        node_id,
        is_verified,
        verified_by,
        verified_at,
        notes
      )
    `)
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (error || !system) {
    notFound()
  }

  // Get latest snapshot
  const latestSnapshot = system.system_flow_snapshots
    ?.sort((a: { version: number }, b: { version: number }) => b.version - a.version)[0]

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

  // Fetch repos for reference
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)

  return (
    <SystemDetailView
      projectId={params.id}
      projectName={project?.name || 'Unknown Project'}
      system={system}
      latestSnapshot={latestSnapshot}
      artifacts={system.system_artifacts || []}
      evidence={system.system_evidence || []}
      verifications={system.system_node_verifications || []}
      repos={repos || []}
      isAdmin={isAdmin}
    />
  )
}
