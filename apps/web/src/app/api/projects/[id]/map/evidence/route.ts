import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/projects/[id]/map/evidence?nodeId=xxx&edgeId=xxx&snapshotId=xxx
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

  // Parse query params
  const url = new URL(request.url)
  const nodeId = url.searchParams.get('nodeId')
  const edgeId = url.searchParams.get('edgeId')
  const snapshotId = url.searchParams.get('snapshotId')

  if (!snapshotId) {
    return NextResponse.json(
      { error: 'snapshotId is required' },
      { status: 400 }
    )
  }

  if (!nodeId && !edgeId) {
    return NextResponse.json(
      { error: 'nodeId or edgeId is required' },
      { status: 400 }
    )
  }

  // Build query
  let query = supabase
    .from('architecture_evidence')
    .select(`
      *,
      repos (
        owner,
        name
      )
    `)
    .eq('snapshot_id', snapshotId)
    .eq('project_id', params.id)

  if (nodeId) {
    query = query.eq('node_id', nodeId)
  }

  if (edgeId) {
    query = query.eq('edge_id', edgeId)
  }

  const { data: evidence, error } = await query.order('kind').limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Format evidence with GitHub URLs where possible
  const formattedEvidence = (evidence || []).map((e: any) => ({
    id: e.id,
    kind: e.kind,
    nodeId: e.node_id,
    edgeId: e.edge_id,
    filePath: e.file_path,
    symbol: e.symbol,
    lineStart: e.line_start,
    lineEnd: e.line_end,
    excerpt: e.excerpt,
    confidence: e.confidence,
    metadata: e.metadata,
    repo: e.repos ? {
      owner: e.repos.owner,
      name: e.repos.name,
    } : null,
    url: e.url || (e.repos && e.file_path
      ? `https://github.com/${e.repos.owner}/${e.repos.name}/blob/main/${e.file_path}${e.line_start ? `#L${e.line_start}` : ''}`
      : null),
  }))

  return NextResponse.json({
    evidence: formattedEvidence,
    count: formattedEvidence.length,
  })
}
