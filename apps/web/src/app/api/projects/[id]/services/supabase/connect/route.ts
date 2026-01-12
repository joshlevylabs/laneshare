/**
 * Connect Supabase service
 * POST /api/projects/[id]/services/supabase/connect
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createSupabaseAdapter } from '@/lib/services'
import { encrypt } from '@/lib/encryption'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const connectSchema = z.object({
  supabase_url: z.string().url('Invalid Supabase URL'),
  service_role_key: z.string().min(20, 'Invalid service role key'),
  display_name: z.string().min(1, 'Display name is required').max(100),
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

  const { supabase_url, service_role_key, display_name } = validation.data

  // Check if a Supabase connection already exists
  const { data: existing } = await supabase
    .from('project_service_connections')
    .select('id')
    .eq('project_id', params.id)
    .eq('service', 'supabase')
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'A Supabase connection already exists for this project. Disconnect it first.' },
      { status: 400 }
    )
  }

  // Validate connection using the adapter
  const adapter = createSupabaseAdapter()
  const validationResult = await adapter.validateConnection(
    { supabase_url },
    { service_role_key }
  )

  if (!validationResult.valid) {
    return NextResponse.json(
      { error: validationResult.error || 'Connection validation failed' },
      { status: 400 }
    )
  }

  // Encrypt the secrets
  const secretsToEncrypt = JSON.stringify({ service_role_key })
  const encryptedSecrets = await encrypt(secretsToEncrypt)

  // Extract project ref from URL
  const projectRef = extractProjectRef(supabase_url)

  // Create the connection
  const { data: connection, error } = await serviceClient
    .from('project_service_connections')
    .insert({
      project_id: params.id,
      service: 'supabase',
      display_name,
      status: 'CONNECTED',
      config_json: {
        supabase_url,
        project_ref: projectRef,
      },
      secret_encrypted: encryptedSecrets,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[Supabase Connect] Error creating connection:', error)
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
      supabase_url,
      project_ref: projectRef,
    },
    created_at: connection.created_at,
  })
}

/**
 * Extract project reference from Supabase URL
 */
function extractProjectRef(url: string): string | undefined {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    // Supabase URLs are typically: https://<project-ref>.supabase.co
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)
    return match ? match[1] : undefined
  } catch {
    return undefined
  }
}
