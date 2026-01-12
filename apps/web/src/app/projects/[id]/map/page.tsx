import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ArchitectureMapView } from '@/components/architecture-map/architecture-map-view'

export default async function ArchitectureMapPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createServerSupabaseClient()

  // Fetch latest snapshot
  const { data: snapshot } = await supabase
    .from('architecture_snapshots')
    .select('*')
    .eq('project_id', params.id)
    .eq('status', 'completed')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  // Fetch features if snapshot exists
  let features: any[] = []
  if (snapshot) {
    const { data } = await supabase
      .from('architecture_features')
      .select('*')
      .eq('snapshot_id', snapshot.id)

    features = data || []
  }

  // Fetch repos for filter dropdown
  const { data: repos } = await supabase
    .from('repos')
    .select('id, owner, name')
    .eq('project_id', params.id)

  return (
    <ArchitectureMapView
      projectId={params.id}
      initialSnapshot={snapshot ? {
        id: snapshot.id,
        generatedAt: snapshot.generated_at,
        analyzerVersion: snapshot.analyzer_version,
        graph: snapshot.graph_json,
        summary: snapshot.summary_json,
        status: snapshot.status,
      } : null}
      initialFeatures={features.map((f) => ({
        slug: f.feature_slug,
        name: f.feature_name,
        description: f.description,
        flow: f.flow_json,
        screens: f.screens,
        endpoints: f.endpoints,
        tables: f.tables,
        services: f.services,
      }))}
      repos={repos || []}
    />
  )
}
