/**
 * OpenAPI Evidence for Systems
 * POST /api/projects/[id]/systems/[systemId]/evidence/openapi - Add OpenAPI endpoint as evidence
 * GET /api/projects/[id]/systems/[systemId]/evidence/openapi - Search OpenAPI endpoints for evidence
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiEndpointAssetData } from '@/lib/supabase/types'

const addEvidenceSchema = z.object({
  asset_id: z.string().uuid(),
  confidence: z.enum(['HIGH', 'MED', 'LOW']).optional().default('HIGH'),
  excerpt: z.string().max(500).optional(),
})

// GET - Search OpenAPI endpoints for potential evidence
export async function GET(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
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

  // Verify system exists
  const { data: system } = await supabase
    .from('systems')
    .select('id, name, keywords')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (!system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse query params
  const url = new URL(request.url)
  const searchQuery = url.searchParams.get('q') || ''
  const tag = url.searchParams.get('tag') || ''
  const autoMatch = url.searchParams.get('auto') === 'true'

  // Get existing evidence for this system
  const { data: existingEvidence } = await supabase
    .from('system_evidence')
    .select('source_ref')
    .eq('system_id', params.systemId)
    .eq('source_type', 'SERVICE')

  const existingRefs = new Set((existingEvidence || []).map((e) => e.source_ref))

  // Build query for endpoints
  let query = supabase
    .from('service_assets')
    .select(`
      id,
      asset_key,
      name,
      data_json,
      project_service_connections!inner (
        id,
        display_name,
        status
      )
    `)
    .eq('project_id', params.id)
    .eq('service', 'openapi')
    .eq('asset_type', 'endpoint')
    .in('project_service_connections.status', ['CONNECTED', 'WARNING'])
    .limit(50)

  // If auto-matching, search by system keywords
  if (autoMatch && system.keywords && system.keywords.length > 0) {
    // Build OR query for keywords matching path, operationId, summary, or tags
    const keywordFilters = system.keywords
      .slice(0, 5)
      .map((kw: string) =>
        `name.ilike.%${kw}%,data_json->>path.ilike.%${kw}%,data_json->>operationId.ilike.%${kw}%,data_json->>summary.ilike.%${kw}%`
      )
      .join(',')

    query = query.or(keywordFilters)
  } else if (searchQuery) {
    query = query.or(
      `name.ilike.%${searchQuery}%,data_json->>path.ilike.%${searchQuery}%,data_json->>operationId.ilike.%${searchQuery}%`
    )
  }

  const { data: endpoints, error } = await query

  if (error) {
    console.error('Failed to search endpoints:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Filter by tag if specified
  let filteredEndpoints = endpoints || []
  if (tag) {
    filteredEndpoints = filteredEndpoints.filter((ep) => {
      const data = ep.data_json as unknown as OpenApiEndpointAssetData
      return data.tags?.includes(tag)
    })
  }

  // Format response with match confidence
  const results = filteredEndpoints.map((ep) => {
    const data = ep.data_json as unknown as OpenApiEndpointAssetData
    const connection = ep.project_service_connections as unknown as { display_name: string }

    // Calculate match confidence based on keyword overlap
    let matchConfidence: 'HIGH' | 'MED' | 'LOW' = 'LOW'
    if (autoMatch && system.keywords) {
      const matchedKeywords = system.keywords.filter((kw: string) => {
        const kwLower = kw.toLowerCase()
        return (
          data.path.toLowerCase().includes(kwLower) ||
          data.operationId?.toLowerCase().includes(kwLower) ||
          data.summary?.toLowerCase().includes(kwLower) ||
          data.tags?.some((t) => t.toLowerCase().includes(kwLower))
        )
      })

      if (matchedKeywords.length >= 2) matchConfidence = 'HIGH'
      else if (matchedKeywords.length === 1) matchConfidence = 'MED'
    }

    return {
      id: ep.id,
      asset_key: ep.asset_key,
      method: data.method,
      path: data.path,
      operationId: data.operationId,
      summary: data.summary,
      tags: data.tags || [],
      api_name: connection.display_name,
      already_added: existingRefs.has(ep.asset_key),
      match_confidence: matchConfidence,
      suggested_excerpt: `${data.method} ${data.path} - ${data.summary || data.operationId || 'API endpoint'}`,
    }
  })

  // Sort by match confidence
  results.sort((a, b) => {
    const order = { HIGH: 0, MED: 1, LOW: 2 }
    return order[a.match_confidence] - order[b.match_confidence]
  })

  return NextResponse.json({
    endpoints: results,
    system_keywords: system.keywords || [],
  })
}

// POST - Add OpenAPI endpoint as evidence
export async function POST(
  request: Request,
  { params }: { params: { id: string; systemId: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check project admin access
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Verify system exists
  const { data: system } = await supabase
    .from('systems')
    .select('id')
    .eq('id', params.systemId)
    .eq('project_id', params.id)
    .single()

  if (!system) {
    return NextResponse.json({ error: 'System not found' }, { status: 404 })
  }

  // Parse request
  const body = await request.json()
  const result = addEvidenceSchema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 }
    )
  }

  const { asset_id, confidence, excerpt: customExcerpt } = result.data

  // Get the asset
  const { data: asset } = await supabase
    .from('service_assets')
    .select('asset_key, name, data_json')
    .eq('id', asset_id)
    .eq('project_id', params.id)
    .eq('service', 'openapi')
    .eq('asset_type', 'endpoint')
    .single()

  if (!asset) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 })
  }

  const data = asset.data_json as unknown as OpenApiEndpointAssetData
  const defaultExcerpt = `${data.method} ${data.path} - ${data.summary || data.operationId || 'API endpoint'}`

  // Check for duplicate
  const { data: existing } = await supabase
    .from('system_evidence')
    .select('id')
    .eq('system_id', params.systemId)
    .eq('source_type', 'SERVICE')
    .eq('source_ref', asset.asset_key)
    .single()

  if (existing) {
    return NextResponse.json({ error: 'This endpoint is already added as evidence' }, { status: 400 })
  }

  // Create evidence record
  const { data: evidence, error } = await serviceClient
    .from('system_evidence')
    .insert({
      project_id: params.id,
      system_id: params.systemId,
      source_type: 'SERVICE',
      source_ref: asset.asset_key,
      excerpt: customExcerpt || defaultExcerpt,
      confidence,
      metadata: {
        asset_id,
        method: data.method,
        path: data.path,
        operationId: data.operationId,
        tags: data.tags,
        service: 'openapi',
      },
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to add evidence:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    id: evidence.id,
    source_type: evidence.source_type,
    source_ref: evidence.source_ref,
    excerpt: evidence.excerpt,
    confidence: evidence.confidence,
  })
}
