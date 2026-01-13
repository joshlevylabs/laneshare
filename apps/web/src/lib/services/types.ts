/**
 * Service Adapter Types
 * Defines the interface that all service adapters must implement
 */

import type {
  ServiceType,
  ServiceConfig,
  ServiceSecrets,
  ServiceSyncStats,
  ServiceAssetType,
} from '@/lib/supabase/types'

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
