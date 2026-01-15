/**
 * OpenAPI Endpoints API
 * GET /api/projects/[id]/services/openapi/endpoints
 *
 * Query parameters:
 * - q: Search query (searches path, operationId, summary)
 * - tag: Filter by tag
 * - limit: Max results (default 100)
 * - offset: Pagination offset (default 0)
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { OpenApiEndpointAssetData } from '@/lib/supabase/openapi-types'

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
    return NextResponse.json(
      { error: 'Not a member of this project' },
      { status: 403 }
    )
  }

  // Parse query parameters
  const url = new URL(request.url)
  const searchQuery = url.searchParams.get('q') || undefined
  const tag = url.searchParams.get('tag') || undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  // Get the OpenAPI connection
  const { data: connection } = await supabase
    .from('project_service_connections')
    .select('id, display_name, status, config_json, last_synced_at')
    .eq('project_id', params.id)
    .eq('service', 'openapi')
    .single()

  if (!connection) {
    return NextResponse.json({
      endpoints: [],
      total: 0,
      connection: null,
      tags: [],
    })
  }

  // Build query
  let query = supabase
    .from('service_assets')
    .select('id, asset_key, name, data_json', { count: 'exact' })
    .eq('connection_id', connection.id)
    .eq('asset_type', 'endpoint')

  // Apply search filter
  if (searchQuery) {
    // Use ilike for text search across multiple fields
    query = query.or(
      `name.ilike.%${searchQuery}%,` +
      `data_json->>path.ilike.%${searchQuery}%,` +
      `data_json->>operationId.ilike.%${searchQuery}%,` +
      `data_json->>summary.ilike.%${searchQuery}%`
    )
  }

  // Fetch endpoints
  const { data: endpoints, error, count } = await query
    .order('data_json->path')
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('[OpenAPI Endpoints] Query error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch endpoints' },
      { status: 500 }
    )
  }

  // Apply tag filter in-memory (JSONB array containment is tricky with Supabase)
  let filteredEndpoints = endpoints || []
  if (tag) {
    filteredEndpoints = filteredEndpoints.filter((ep) => {
      const data = ep.data_json as unknown as OpenApiEndpointAssetData
      return data.tags?.includes(tag)
    })
  }

  // Extract unique tags from all endpoints
  const { data: allEndpoints } = await supabase
    .from('service_assets')
    .select('data_json')
    .eq('connection_id', connection.id)
    .eq('asset_type', 'endpoint')

  const tagsSet = new Set<string>()
  for (const ep of allEndpoints || []) {
    const data = ep.data_json as unknown as OpenApiEndpointAssetData
    for (const t of data.tags || []) {
      tagsSet.add(t)
    }
  }
  const tags = Array.from(tagsSet).sort()

  // Format response
  const formattedEndpoints = filteredEndpoints.map((ep) => {
    const data = ep.data_json as unknown as OpenApiEndpointAssetData
    return {
      id: ep.id,
      asset_key: ep.asset_key,
      method: data.method,
      path: data.path,
      operationId: data.operationId,
      summary: data.summary,
      description: data.description,
      tags: data.tags || [],
      deprecated: data.deprecated || false,
      parameters: data.parameters,
      requestBody: data.requestBody,
      responses: data.responses,
    }
  })

  return NextResponse.json({
    endpoints: formattedEndpoints,
    total: count || 0,
    connection: {
      id: connection.id,
      display_name: connection.display_name,
      status: connection.status,
      spec_title: (connection.config_json as Record<string, unknown>)?.spec_title,
      spec_version: (connection.config_json as Record<string, unknown>)?.spec_version,
      last_synced_at: connection.last_synced_at,
    },
    tags,
    pagination: {
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    },
  })
}
