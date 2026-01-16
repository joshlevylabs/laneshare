/**
 * Service Adapter Types
 * Defines the interface that all service adapters must implement
 */

import type {
  ServiceType,
  SupabaseConfig,
  SupabaseSecrets,
  SupabaseSyncStats,
  VercelConfig,
  VercelSecrets,
  VercelSyncStats,
} from '@/lib/supabase/supabase-service-types'

import type { OpenApiConfig, OpenApiSecrets, OpenApiSyncStats } from '@/lib/supabase/openapi-types'

// Generic service types as unions of specific types
export type ServiceConfig = SupabaseConfig | VercelConfig | OpenApiConfig | Record<string, unknown>
export type ServiceSecrets = SupabaseSecrets | VercelSecrets | OpenApiSecrets | Record<string, unknown>
export type ServiceSyncStats = SupabaseSyncStats | VercelSyncStats | OpenApiSyncStats | Record<string, unknown>
export type ServiceAssetType = 'table' | 'policy' | 'function' | 'trigger' | 'bucket' | 'project' | 'deployment' | 'domain' | 'env_var' | 'endpoint' | 'schema' | 'spec' | 'security_scheme' | string

export type { ServiceType }

/**
 * Result of validating a service connection
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * A discovered service asset
 */
export interface DiscoveredAsset {
  asset_type: ServiceAssetType
  asset_key: string
  name: string
  data_json: Record<string, unknown>
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean
  assets: DiscoveredAsset[]
  stats: ServiceSyncStats
  error?: string
  warnings?: string[]
}

/**
 * Base interface for all service adapters
 */
export interface ServiceAdapter<
  TConfig extends ServiceConfig = ServiceConfig,
  TSecrets extends ServiceSecrets = ServiceSecrets,
  TStats extends ServiceSyncStats = ServiceSyncStats,
> {
  /**
   * The service type identifier
   */
  readonly serviceType: ServiceType

  /**
   * Validate the connection credentials
   * @param config Non-secret configuration
   * @param secrets Secret credentials (decrypted)
   * @returns Validation result with optional metadata
   */
  validateConnection(config: TConfig, secrets: TSecrets): Promise<ValidationResult>

  /**
   * Perform a full sync of the service
   * @param config Non-secret configuration
   * @param secrets Secret credentials (decrypted)
   * @returns Sync result with all discovered assets and stats
   */
  sync(config: TConfig, secrets: TSecrets): Promise<SyncResult>

  /**
   * Redact sensitive information from an object for safe logging
   * @param obj Object that may contain sensitive data
   * @returns A safe-to-log version with redacted secrets
   */
  redact<T extends Record<string, unknown>>(obj: T): T
}

/**
 * Factory function type for creating service adapters
 */
export type ServiceAdapterFactory = () => ServiceAdapter
