/**
 * Connected Services Module
 * Provides adapters for external service integrations
 */

export * from './types'
export { SupabaseAdapter, createSupabaseAdapter } from './supabase-adapter'
export { VercelAdapter, createVercelAdapter } from './vercel-adapter'

import type { ServiceType } from '@/lib/supabase/types'
import type { ServiceAdapter } from './types'
import { SupabaseAdapter } from './supabase-adapter'
import { VercelAdapter } from './vercel-adapter'

/**
 * Get a service adapter by type
 */
export function getServiceAdapter(serviceType: ServiceType): ServiceAdapter {
  switch (serviceType) {
    case 'supabase':
      return new SupabaseAdapter()
    case 'vercel':
      return new VercelAdapter()
    default:
      throw new Error(`Unknown service type: ${serviceType}`)
  }
}
