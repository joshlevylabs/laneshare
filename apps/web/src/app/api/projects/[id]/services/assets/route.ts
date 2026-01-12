/**
 * API Routes for service assets
 * GET /api/projects/[id]/services/assets - List service assets with filtering
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

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

  // Verify project membership
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Parse query parameters
  const { searchParams } = new URL(request.url)
  const service = searchParams.get('service')
  const assetType = searchParams.get('type')
  const query = searchParams.get('q')
  const connectionId = searchParams.get('connection_id')
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const offset = parseInt(searchParams.get('offset') || '0')

  // Build query
  let assetsQuery = supabase
    .from('service_assets')
    .select('*', { count: 'exact' })
    .eq('project_id', params.id)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (service) {
    assetsQuery = assetsQuery.eq('service', service)
  }

  if (assetType) {
    assetsQuery = assetsQuery.eq('asset_type', assetType)
  }

  if (connectionId) {
    assetsQuery = assetsQuery.eq('connection_id', connectionId)
  }

  if (query) {
    assetsQuery = assetsQuery.or(`name.ilike.%${query}%,asset_key.ilike.%${query}%`)
  }

  const { data: assets, count, error } = await assetsQuery

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    assets: assets || [],
    total: count || 0,
    limit,
    offset,
  })
}
