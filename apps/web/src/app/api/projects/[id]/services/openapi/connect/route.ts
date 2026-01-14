/**
 * Connect OpenAPI service
 * POST /api/projects/[id]/services/openapi/connect
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createOpenApiAdapter } from '@/lib/services'
import { encrypt } from '@/lib/encryption'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const connectSchema = z.object({
  openapi_url: z.string().url('Invalid URL format'),
  display_name: z.string().min(1, 'Display name is required').max(100),
  api_slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  headers: z.record(z.string()).optional(),
  format_hint: z.enum(['json', 'yaml', 'auto']).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient()
  const serviceClient = createServiceRoleClient()

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
      { error: 'Only project owners and maintainers can manage service connections' },
      { status: 403 }
    )
  }

  // Parse and validate request body
  const body = await request.json()
  const validation = connectSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { openapi_url, display_name, api_slug, headers, format_hint } = validation.data

  // Check if an OpenAPI connection already exists
  const { data: existing } = await supabase
    .from('project_service_connections')
    .select('id')
    .eq('project_id', params.id)
    .eq('service', 'openapi')
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'An OpenAPI connection already exists for this project. Disconnect it first.' },
      { status: 400 }
    )
  }

  // Validate connection using the adapter
  const adapter = createOpenApiAdapter()
  const validationResult = await adapter.validateConnection(
    { openapi_url, format_hint },
    { headers }
  )

  if (!validationResult.valid) {
    return NextResponse.json(
      { error: validationResult.error || 'Connection validation failed' },
      { status: 400 }
    )
  }

  // Encrypt the secrets (headers)
  const secretsToEncrypt = JSON.stringify({ headers: headers || {} })
  const encryptedSecrets = await encrypt(secretsToEncrypt)

  // Generate slug from title if not provided
  const finalSlug = api_slug || validationResult.metadata?.suggested_slug || 'api'

  // Create the connection
  const { data: connection, error } = await serviceClient
    .from('project_service_connections')
    .insert({
      project_id: params.id,
      service: 'openapi',
      display_name,
      status: 'CONNECTED',
      config_json: {
        openapi_url,
        api_name: display_name,
        api_slug: finalSlug,
        format_hint,
        spec_fingerprint: validationResult.metadata?.spec_fingerprint,
        spec_version: validationResult.metadata?.version,
        spec_title: validationResult.metadata?.title,
      },
      secret_encrypted: encryptedSecrets,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[OpenAPI Connect] Error creating connection:', error)
    return NextResponse.json(
      { error: 'Failed to create connection' },
      { status: 500 }
    )
  }

  // Return success (don't include any secrets!)
  return NextResponse.json({
    id: connection.id,
    service: connection.service,
    display_name: connection.display_name,
    status: connection.status,
    config: {
      openapi_url,
      api_slug: finalSlug,
      spec_title: validationResult.metadata?.title,
      spec_version: validationResult.metadata?.version,
      endpoint_count: validationResult.metadata?.endpoint_count,
      schema_count: validationResult.metadata?.schema_count,
    },
    created_at: connection.created_at,
  })
}
