/**
 * Validate OpenAPI connection
 * POST /api/projects/[id]/services/openapi/validate
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createOpenApiAdapter } from '@/lib/services'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const validateSchema = z.object({
  openapi_url: z.string().url('Invalid URL format'),
  headers: z.record(z.string()).optional(),
  format_hint: z.enum(['json', 'yaml', 'auto']).optional(),
})

export async function POST(
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

  // Verify project admin access (OWNER or MAINTAINER)
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only project owners and maintainers can validate service connections' },
      { status: 403 }
    )
  }

  // Parse and validate request body
  const body = await request.json()
  const validation = validateSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { openapi_url, headers, format_hint } = validation.data

  // Validate connection using the adapter
  const adapter = createOpenApiAdapter()
  const result = await adapter.validateConnection(
    { openapi_url, format_hint },
    { headers }
  )

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || 'Validation failed' },
      { status: 400 }
    )
  }

  // Return validation result (no secrets!)
  return NextResponse.json({
    ok: true,
    title: result.metadata?.title,
    version: result.metadata?.version,
    description: result.metadata?.description,
    base_url: result.metadata?.base_url,
    openapi_version: result.metadata?.openapi_version,
    endpoint_count: result.metadata?.endpoint_count,
    schema_count: result.metadata?.schema_count,
    tag_count: result.metadata?.tag_count,
    security_scheme_count: result.metadata?.security_scheme_count,
    suggested_slug: result.metadata?.suggested_slug,
    spec_fingerprint: result.metadata?.spec_fingerprint,
  })
}
