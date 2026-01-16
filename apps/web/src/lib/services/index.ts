/**
 * Connected Services Module
 * Provides adapters for external service integrations
 */

export * from './types'
export { SupabaseAdapter, createSupabaseAdapter } from './supabase-adapter'
export { VercelAdapter, createVercelAdapter } from './vercel-adapter'
export { OpenApiAdapter, createOpenApiAdapter } from './openapi-adapter'

import type { ServiceType } from '@/lib/supabase/supabase-service-types'
import type { ServiceAdapter } from './types'
import { SupabaseAdapter } from './supabase-adapter'
import { VercelAdapter } from './vercel-adapter'
import { OpenApiAdapter } from './openapi-adapter'

/**
 * Get a service adapter by type
 */
export function getServiceAdapter(serviceType: ServiceType): ServiceAdapter {
  switch (serviceType) {
    case 'supabase':
      return new SupabaseAdapter()
    case 'vercel':
      return new VercelAdapter()
    case 'openapi':
      return new OpenApiAdapter()
    default:
      throw new Error(`Unknown service type: ${serviceType}`)
  }
}
