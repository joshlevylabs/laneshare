import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { ArchitectureSnapshot, ArchitectureEvidence } from '@laneshare/shared'

// GET /api/projects/[id]/map - Get latest architecture snapshot
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

  // Get latest completed snapshot
  const { data: snapshot, error } = await supabase
    .from('architecture_snapshots')
    .select('*')
    .eq('project_id', params.id)
    .eq('status', 'completed')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!snapshot) {
    return NextResponse.json({
      snapshot: null,
      message: 'No architecture snapshot available. Generate one to get started.',
    })
  }

  // Get summary evidence counts
  const { count: evidenceCount } = await supabase
    .from('architecture_evidence')
    .select('*', { count: 'exact', head: true })
    .eq('snapshot_id', snapshot.id)

  // Get feature list
  const { data: features } = await supabase
    .from('architecture_features')
    .select('feature_slug, feature_name, description')
    .eq('snapshot_id', snapshot.id)

  return NextResponse.json({
    snapshot: {
      id: snapshot.id,
      generatedAt: snapshot.generated_at,
      analyzerVersion: snapshot.analyzer_version,
      sourceFingerprint: snapshot.source_fingerprint,
      graph: snapshot.graph_json,
      summary: snapshot.summary_json,
      status: snapshot.status,
    },
    evidenceCount: evidenceCount || 0,
    features: features || [],
  })
}
