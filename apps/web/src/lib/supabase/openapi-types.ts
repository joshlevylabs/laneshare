/**
 * OpenAPI Service Types
 * These types define the structure of data stored in service_assets for OpenAPI connections
 */

// OpenAPI Configuration stored in project_service_connections.config_json
export interface OpenApiConfig {
  openapi_url: string
  api_name?: string
  api_slug?: string
  format_hint?: 'json' | 'yaml' | 'auto'
  spec_fingerprint?: string
  spec_version?: string
  spec_title?: string
}

// OpenAPI Secrets stored in project_service_connections.secret_encrypted
export interface OpenApiSecrets {
  headers?: Record<string, string>
}

// Sync statistics for OpenAPI connections
export interface OpenApiSyncStats {
  endpoints: number
  schemas: number
  security_schemes: number
  tags?: number
  spec_version?: string
  spec_title?: string
  spec_fingerprint?: string
  base_url?: string
}

// Schema reference type for OpenAPI
export interface OpenApiSchemaRef {
  $ref?: string
  type?: string
  format?: string
  items?: OpenApiSchemaRef
  properties?: Record<string, OpenApiSchemaRef>
  required?: string[]
  description?: string
  enum?: string[]
  example?: unknown
  nullable?: boolean
  allOf?: OpenApiSchemaRef[]
  oneOf?: OpenApiSchemaRef[]
  anyOf?: OpenApiSchemaRef[]
}

// Parameter in an endpoint
export interface OpenApiParameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiSchemaRef
  deprecated?: boolean
}

// Request body specification
export interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchemaRef }>
}

// Response specification
export interface OpenApiResponse {
  description?: string
  content?: Record<string, { schema?: OpenApiSchemaRef }>
}

// Asset data for endpoint type (stored in service_assets.data_json)
export interface OpenApiEndpointAssetData {
  method: string
  path: string
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
  security?: Array<Record<string, string[]>>
}

// Asset data for spec type (stored in service_assets.data_json)
export interface OpenApiSpecAssetData {
  title: string
  version: string
  description?: string
  base_url?: string
  servers?: Array<{ url: string; description?: string }>
  openapi_version?: string
  spec_fingerprint?: string
  endpoint_count?: number
  schema_count?: number
  tag_count?: number
  security_scheme_count?: number
  tags?: Array<{ name: string; description?: string }>
}

// Asset data for schema type (stored in service_assets.data_json)
export interface OpenApiSchemaAssetData {
  name: string
  schema: OpenApiSchemaRef
  description?: string
}

// Asset data for security scheme type (stored in service_assets.data_json)
export interface OpenApiSecuritySchemeAssetData {
  type: string
  name?: string
  in?: string
  scheme?: string
  bearerFormat?: string
  description?: string
  flows?: unknown
  openIdConnectUrl?: string
}
