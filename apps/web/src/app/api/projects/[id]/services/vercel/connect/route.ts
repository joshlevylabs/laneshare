/**
 * Connect Vercel service
 * POST /api/projects/[id]/services/vercel/connect
 */

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createVercelAdapter } from '@/lib/services'
import { encrypt } from '@/lib/encryption'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const connectSchema = z.object({
  token: z.string().min(20, 'Invalid Vercel token'),
  display_name: z.string().min(1, 'Display name is required').max(100),
  team_id: z.string().optional(),
  team_slug: z.string().optional(),
  project_ids: z.array(z.string()).optional(),
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

  const { token, display_name, team_id, team_slug, project_ids } = validation.data

  // Check if a Vercel connection already exists
  const { data: existing } = await supabase
    .from('project_service_connections')
    .select('id')
    .eq('project_id', params.id)
    .eq('service', 'vercel')
    .single()

  if (existing) {
    return NextResponse.json(
      { error: 'A Vercel connection already exists for this project. Disconnect it first.' },
      { status: 400 }
    )
  }

  // Validate connection using the adapter
  const adapter = createVercelAdapter()
  const validationResult = await adapter.validateConnection(
    { team_id, team_slug, project_ids },
    { token }
  )

  if (!validationResult.valid) {
    return NextResponse.json(
      { error: validationResult.error || 'Connection validation failed' },
      { status: 400 }
    )
  }

  // Encrypt the secrets
  const secretsToEncrypt = JSON.stringify({ token })
  const encryptedSecrets = await encrypt(secretsToEncrypt)

  // Create the connection
  const { data: connection, error } = await serviceClient
    .from('project_service_connections')
    .insert({
      project_id: params.id,
      service: 'vercel',
      display_name,
      status: 'CONNECTED',
      config_json: {
        team_id,
        team_slug,
        project_ids,
      },
      secret_encrypted: encryptedSecrets,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[Vercel Connect] Error creating connection:', error)
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
      team_id,
      team_slug,
      project_ids,
    },
    created_at: connection.created_at,
  })
}
