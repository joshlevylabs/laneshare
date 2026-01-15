/**
 * Bridge Authentication
 *
 * Handles API key verification and generation for bridge agents.
 */

import { createServiceRoleClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export interface BridgeKeyInfo {
  keyId: string
  projectId: string
  scopes: string[]
}

/**
 * Verify a bridge API key
 */
export async function verifyBridgeApiKey(apiKey: string): Promise<BridgeKeyInfo | null> {
  if (!apiKey || apiKey.length < 32) {
    return null
  }

  // Get the key prefix and hash
  const keyPrefix = apiKey.substring(0, 8)
  const keyHash = hashApiKey(apiKey)

  const supabase = createServiceRoleClient()

  const { data: keyRecord, error } = await supabase
    .from('bridge_api_keys')
    .select('id, project_id, scopes, is_active, expires_at')
    .eq('key_prefix', keyPrefix)
    .eq('key_hash', keyHash)
    .single()

  if (error || !keyRecord) {
    return null
  }

  // Check if key is active
  if (!keyRecord.is_active) {
    return null
  }

  // Check if key has expired
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return null
  }

  return {
    keyId: keyRecord.id,
    projectId: keyRecord.project_id,
    scopes: keyRecord.scopes || [],
  }
}

/**
 * Generate a new bridge API key
 */
export async function generateBridgeApiKey(
  projectId: string,
  userId: string,
  name: string,
  options?: {
    scopes?: string[]
    expiresAt?: Date
  }
): Promise<{ key: string; keyId: string } | null> {
  const supabase = createServiceRoleClient()

  // Generate a random key
  const key = `lsb_${crypto.randomBytes(32).toString('hex')}`
  const keyPrefix = key.substring(0, 8)
  const keyHash = hashApiKey(key)

  const { data, error } = await supabase
    .from('bridge_api_keys')
    .insert({
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      scopes: options?.scopes || ['bridge:connect', 'bridge:write'],
      expires_at: options?.expiresAt?.toISOString(),
      created_by: userId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[Bridge] Error generating API key:', error)
    return null
  }

  return {
    key,
    keyId: data.id,
  }
}

/**
 * Hash an API key for storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/**
 * Revoke a bridge API key
 */
export async function revokeBridgeApiKey(keyId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()

  const { error } = await supabase
    .from('bridge_api_keys')
    .update({ is_active: false })
    .eq('id', keyId)

  return !error
}
