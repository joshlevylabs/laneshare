import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/projects/[id]/map/features - Get architecture features
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
  const { data: snapshot } = await supabase
    .from('architecture_snapshots')
    .select('id')
    .eq('project_id', params.id)
    .eq('status', 'completed')
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  if (!snapshot) {
    return NextResponse.json([])
  }

  // Get features from the latest snapshot
  const { data: features, error } = await supabase
    .from('architecture_features')
    .select('id, feature_slug, feature_name, description')
    .eq('snapshot_id', snapshot.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(features || [])
}
