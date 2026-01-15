/**
 * Bridge API Key Operations
 *
 * Get, revoke, or delete a specific API key.
 */

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/**
 * DELETE /api/projects/[id]/bridge-keys/[keyId]
 * Revoke and delete an API key
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; keyId: string } }
) {
  const { id: projectId, keyId } = params
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
    return NextResponse.json({ error: 'Only project owners and maintainers can delete API keys' }, { status: 403 })
  }

  // Verify the key belongs to this project
  const { data: key, error: keyError } = await supabase
    .from('bridge_api_keys')
    .select('id')
    .eq('id', keyId)
    .eq('project_id', projectId)
    .single()

  if (keyError || !key) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  // Delete the key
  const { error: deleteError } = await supabase
    .from('bridge_api_keys')
    .delete()
    .eq('id', keyId)

  if (deleteError) {
    console.error('[BridgeKeys] Error deleting key:', deleteError)
    return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

/**
 * PATCH /api/projects/[id]/bridge-keys/[keyId]
 * Update an API key (e.g., toggle active status)
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; keyId: string } }
) {
  const { id: projectId, keyId } = params
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
    return NextResponse.json({ error: 'Only project owners and maintainers can update API keys' }, { status: 403 })
  }

  const body = await request.json()
  const { is_active } = body

  // Verify the key belongs to this project
  const { data: key, error: keyError } = await supabase
    .from('bridge_api_keys')
    .select('id')
    .eq('id', keyId)
    .eq('project_id', projectId)
    .single()

  if (keyError || !key) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  }

  // Update the key
  const { error: updateError } = await supabase
    .from('bridge_api_keys')
    .update({ is_active })
    .eq('id', keyId)

  if (updateError) {
    console.error('[BridgeKeys] Error updating key:', updateError)
    return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
