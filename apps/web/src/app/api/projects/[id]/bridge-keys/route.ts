/**
 * Bridge API Keys Management
 *
 * Create, list, and manage API keys for bridge agent authentication.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { generateBridgeApiKey } from '@/lib/bridge/auth'

/**
 * GET /api/projects/[id]/bridge-keys
 * List all bridge API keys for a project
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only admins can view API keys
  if (!['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project owners and maintainers can manage API keys' }, { status: 403 })
  }

  // Get API keys
  const { data: keys, error } = await supabase
    .from('bridge_api_keys')
    .select('id, key_prefix, name, scopes, is_active, last_used_at, expires_at, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[BridgeKeys] Error fetching keys:', error)
    return NextResponse.json({ error: 'Failed to fetch keys' }, { status: 500 })
  }

  return NextResponse.json({ keys })
}

/**
 * POST /api/projects/[id]/bridge-keys
 * Create a new bridge API key
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id
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
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single()

  if (!membership || !['OWNER', 'MAINTAINER'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only project owners and maintainers can create API keys' }, { status: 403 })
  }

  const body = await request.json()
  const { name, expiresInDays } = body

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Calculate expiration date if specified
  let expiresAt: Date | undefined
  if (expiresInDays && typeof expiresInDays === 'number' && expiresInDays > 0) {
    expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  }

  // Generate the key
  const result = await generateBridgeApiKey(projectId, user.id, name, { expiresAt })

  if (!result) {
    return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 })
  }

  return NextResponse.json({
    key: result.key,
    keyId: result.keyId,
    message: 'Store this key securely. It will not be shown again.',
  })
}
