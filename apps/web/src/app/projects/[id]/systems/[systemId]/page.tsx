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

  // Fetch system with flow snapshots
  const { data: system, error } = await supabase
    .from('systems')
    .select(`
      *,
      system_flow_snapshots (
        id,
        version,
        graph_json,
        generated_at,
        generated_by,
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

  // Check user role
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  const isAdmin = membership?.role === 'OWNER' || membership?.role === 'MAINTAINER'

  return (
    <SystemDetailView
      projectId={params.id}
      // Cast through unknown to handle DB null vs TS undefined mismatch
      system={system as unknown as Parameters<typeof SystemDetailView>[0]['system']}
      latestSnapshot={latestSnapshot as unknown as Parameters<typeof SystemDetailView>[0]['latestSnapshot']}
      isAdmin={isAdmin}
    />
  )
}
