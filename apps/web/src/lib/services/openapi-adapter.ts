/**
 * OpenAPI/Swagger Service Adapter
 * Connects to OpenAPI spec URLs, fetches and parses specs,
 * and discovers API endpoints, schemas, and security schemes.
 */

import * as yaml from 'js-yaml'
import type {
  OpenApiConfig,
  OpenApiSecrets,
  OpenApiSyncStats,
  OpenApiSpecAssetData,
  OpenApiEndpointAssetData,
  OpenApiSchemaAssetData,
  OpenApiSecuritySchemeAssetData,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchemaRef,
} from '@/lib/supabase/types'
import type { ServiceAdapter, ValidationResult, SyncResult, DiscoveredAsset } from './types'

// Configuration
const MAX_SPEC_SIZE = 10 * 1024 * 1024 // 10MB
const FETCH_TIMEOUT = 10000 // 10 seconds
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace']

// Common Swagger UI spec locations to probe
const SWAGGER_SPEC_LOCATIONS = [
  '/openapi.json',
  '/swagger.json',
  '/api-docs',
  '/swagger/v1/swagger.json',
  '/v1/swagger.json',
  '/v2/swagger.json',
  '/v3/swagger.json',
  '/api/swagger.json',
  '/api/openapi.json',
  '/docs/openapi.json',
]

// Raw OpenAPI 3.x spec types
interface OpenApi3Spec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  paths?: Record<string, Record<string, OpenApi3Operation>>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, OpenApi3SecurityScheme>
  }
  tags?: Array<{ name: string; description?: string }>
  security?: Array<Record<string, string[]>>
}

interface OpenApi3Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: OpenApi3Parameter[]
  requestBody?: OpenApi3RequestBody
  responses?: Record<string, OpenApi3Response>
  security?: Array<Record<string, string[]>>
}

interface OpenApi3Parameter {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: unknown
  deprecated?: boolean
}

interface OpenApi3RequestBody {
  description?: string
  required?: boolean
  content?: Record<string, { schema?: unknown }>
}

interface OpenApi3Response {
  description?: string
  content?: Record<string, { schema?: unknown }>
}

interface OpenApi3SecurityScheme {
  type: string
  description?: string
  name?: string
  in?: string
  scheme?: string
  bearerFormat?: string
  flows?: unknown
  openIdConnectUrl?: string
}

// Raw Swagger 2.0 spec types
interface Swagger2Spec {
  swagger: string
  info: {
    title: string
    version: string
    description?: string
  }
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, Record<string, Swagger2Operation>>
  definitions?: Record<string, unknown>
  securityDefinitions?: Record<string, Swagger2SecurityScheme>
  tags?: Array<{ name: string; description?: string }>
  security?: Array<Record<string, string[]>>
}

interface Swagger2Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: Swagger2Parameter[]
  responses?: Record<string, Swagger2Response>
  security?: Array<Record<string, string[]>>
  consumes?: string[]
  produces?: string[]
}

interface Swagger2Parameter {
  name: string
  in: string
  required?: boolean
  description?: string
  type?: string
  format?: string
  schema?: unknown
}

interface Swagger2Response {
  description?: string
  schema?: unknown
}

interface Swagger2SecurityScheme {
  type: string
  description?: string
  name?: string
  in?: string
  flow?: string
  authorizationUrl?: string
  tokenUrl?: string
  scopes?: Record<string, string>
}

// Union type for spec
type OpenApiSpec = OpenApi3Spec | Swagger2Spec

export class OpenApiAdapter implements ServiceAdapter<OpenApiConfig, OpenApiSecrets, OpenApiSyncStats> {
  readonly serviceType = 'openapi' as const

  /**
   * Validate the OpenAPI connection by fetching and parsing the spec
   */
  async validateConnection(
    config: OpenApiConfig,
    secrets: OpenApiSecrets
  ): Promise<ValidationResult> {
    try {
      const { spec, finalUrl } = await this.fetchSpec(config.openapi_url, secrets.headers)

      const normalized = this.normalizeSpec(spec)
      const slug = this.generateSlug(normalized.title)
      const fingerprint = this.computeFingerprint(spec)

      return {
        valid: true,
        metadata: {
          title: normalized.title,
          version: normalized.version,
          description: normalized.description,
          base_url: normalized.baseUrl,
          openapi_version: normalized.openapiVersion,
          endpoint_count: normalized.endpoints.length,
          schema_count: normalized.schemas.length,
          tag_count: normalized.tags.length,
          security_scheme_count: normalized.securitySchemes.length,
          suggested_slug: slug,
          spec_fingerprint: fingerprint,
          final_url: finalUrl,
          validated_at: new Date().toISOString(),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[OpenApiAdapter] Validation error:', this.redact({ error: message }))

      return {
        valid: false,
        error: message,
      }
    }
  }

  /**
   * Sync the OpenAPI spec and discover all assets
   */
  async sync(config: OpenApiConfig, secrets: OpenApiSecrets): Promise<SyncResult> {
    const assets: DiscoveredAsset[] = []
    const stats: OpenApiSyncStats = {
      endpoints: 0,
      schemas: 0,
      tags: 0,
      security_schemes: 0,
    }
    const warnings: string[] = []

    try {
      console.log('[OpenApiAdapter] Syncing spec from:', config.openapi_url)

      const { spec } = await this.fetchSpec(config.openapi_url, secrets.headers)
      const normalized = this.normalizeSpec(spec)
      const slug = config.api_slug || this.generateSlug(normalized.title)
      const fingerprint = this.computeFingerprint(spec)

      // Update stats
      stats.endpoints = normalized.endpoints.length
      stats.schemas = normalized.schemas.length
      stats.tags = normalized.tags.length
      stats.security_schemes = normalized.securitySchemes.length
      stats.spec_version = normalized.version
      stats.spec_title = normalized.title
      stats.base_url = normalized.baseUrl
      stats.spec_fingerprint = fingerprint

      // Create spec asset
      const specAsset: OpenApiSpecAssetData = {
        title: normalized.title,
        version: normalized.version,
        description: normalized.description,
        base_url: normalized.baseUrl,
        servers: normalized.servers,
        openapi_version: normalized.openapiVersion,
        spec_fingerprint: fingerprint,
        endpoint_count: normalized.endpoints.length,
        schema_count: normalized.schemas.length,
        tag_count: normalized.tags.length,
        security_scheme_count: normalized.securitySchemes.length,
        tags: normalized.tags,
      }

      assets.push({
        asset_type: 'openapi_spec',
        asset_key: `openapi:${slug}:spec`,
        name: normalized.title,
        data_json: specAsset as unknown as Record<string, unknown>,
      })

      // Create endpoint assets
      for (const endpoint of normalized.endpoints) {
        const normalizedPath = this.normalizePath(endpoint.path)
        const endpointKey = `openapi:${slug}:${endpoint.method.toLowerCase()}:${normalizedPath}`

        assets.push({
          asset_type: 'endpoint',
          asset_key: endpointKey,
          name: endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`,
          data_json: endpoint as unknown as Record<string, unknown>,
        })
      }

      // Create schema assets
      for (const schema of normalized.schemas) {
        const schemaKey = `openapi:${slug}:schema:${schema.name}`

        assets.push({
          asset_type: 'schema',
          asset_key: schemaKey,
          name: schema.name,
          data_json: schema as unknown as Record<string, unknown>,
        })
      }

      // Create security scheme assets
      for (const secScheme of normalized.securitySchemes) {
        const secKey = `openapi:${slug}:security:${secScheme.name}`

        assets.push({
          asset_type: 'security_scheme',
          asset_key: secKey,
          name: secScheme.name,
          data_json: secScheme as unknown as Record<string, unknown>,
        })
      }

      console.log('[OpenApiAdapter] Sync completed:', this.redact({ stats }))

      return {
        success: true,
        assets,
        stats,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[OpenApiAdapter] Sync error:', this.redact({ error: message }))

      return {
        success: false,
        assets,
        stats,
        error: message,
      }
    }
  }

  /**
   * Fetch and parse the OpenAPI spec from a URL
   */
  private async fetchSpec(
    url: string,
    headers?: Record<string, string>
  ): Promise<{ spec: OpenApiSpec; finalUrl: string }> {
    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error('Invalid URL format')
    }

    // Try the provided URL first
    let { spec, finalUrl } = await this.tryFetchSpec(url, headers)

    if (!spec) {
      // If it looks like a Swagger UI page, try to find the actual spec
      const isHtmlPage = finalUrl.endsWith('.html') || !finalUrl.includes('.')
      if (isHtmlPage) {
        spec = await this.probeSwaggerUISpec(parsedUrl, headers)
        if (spec) {
          return { spec, finalUrl: url }
        }
      }

      throw new Error(
        'Could not fetch OpenAPI spec. Ensure the URL points to a valid JSON or YAML spec file.'
      )
    }

    return { spec, finalUrl }
  }

  /**
   * Try to fetch and parse a spec from a specific URL
   */
  private async tryFetchSpec(
    url: string,
    headers?: Record<string, string>
  ): Promise<{ spec: OpenApiSpec | null; finalUrl: string }> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, application/yaml, text/yaml, */*',
          ...headers,
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return { spec: null, finalUrl: response.url }
      }

      // Check content length
      const contentLength = response.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > MAX_SPEC_SIZE) {
        throw new Error(`Spec file too large (${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB). Maximum size is 10MB.`)
      }

      const text = await response.text()

      // Check actual size
      if (text.length > MAX_SPEC_SIZE) {
        throw new Error(`Spec file too large. Maximum size is 10MB.`)
      }

      // Try to parse as JSON first
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        // Try YAML
        try {
          parsed = yaml.load(text)
        } catch {
          return { spec: null, finalUrl: response.url }
        }
      }

      // Validate it's an OpenAPI/Swagger spec
      if (!this.isValidSpec(parsed)) {
        return { spec: null, finalUrl: response.url }
      }

      return { spec: parsed as OpenApiSpec, finalUrl: response.url }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out. The spec URL may be unreachable.')
      }

      // Re-throw size errors
      if (error instanceof Error && error.message.includes('too large')) {
        throw error
      }

      return { spec: null, finalUrl: url }
    }
  }

  /**
   * Probe common Swagger UI spec locations
   */
  private async probeSwaggerUISpec(
    baseUrl: URL,
    headers?: Record<string, string>
  ): Promise<OpenApiSpec | null> {
    for (const path of SWAGGER_SPEC_LOCATIONS) {
      try {
        const probeUrl = new URL(path, baseUrl.origin)
        const { spec } = await this.tryFetchSpec(probeUrl.toString(), headers)
        if (spec) {
          console.log('[OpenApiAdapter] Found spec at:', probeUrl.toString())
          return spec
        }
      } catch {
        // Continue to next location
      }
    }
    return null
  }

  /**
   * Check if parsed content is a valid OpenAPI/Swagger spec
   */
  private isValidSpec(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object') return false

    const obj = parsed as Record<string, unknown>

    // OpenAPI 3.x
    if (typeof obj.openapi === 'string' && obj.openapi.startsWith('3.')) {
      return typeof obj.info === 'object' && obj.info !== null
    }

    // Swagger 2.0
    if (obj.swagger === '2.0') {
      return typeof obj.info === 'object' && obj.info !== null
    }

    return false
  }

  /**
   * Normalize OpenAPI 3.x or Swagger 2.0 spec into a common format
   */
  private normalizeSpec(spec: OpenApiSpec): {
    title: string
    version: string
    description?: string
    openapiVersion: string
    baseUrl?: string
    servers: Array<{ url: string; description?: string }>
    endpoints: OpenApiEndpointAssetData[]
    schemas: OpenApiSchemaAssetData[]
    securitySchemes: OpenApiSecuritySchemeAssetData[]
    tags: Array<{ name: string; description?: string }>
  } {
    const isOpenApi3 = 'openapi' in spec

    // Extract metadata
    const title = spec.info.title || 'Untitled API'
    const version = spec.info.version || '1.0.0'
    const description = spec.info.description
    const openapiVersion = isOpenApi3 ? (spec as OpenApi3Spec).openapi : '2.0'

    // Extract servers/base URL
    let servers: Array<{ url: string; description?: string }> = []
    let baseUrl: string | undefined

    if (isOpenApi3) {
      const spec3 = spec as OpenApi3Spec
      servers = spec3.servers || []
      baseUrl = servers[0]?.url
    } else {
      const spec2 = spec as Swagger2Spec
      const scheme = spec2.schemes?.[0] || 'https'
      const host = spec2.host || 'localhost'
      const basePath = spec2.basePath || ''
      baseUrl = `${scheme}://${host}${basePath}`
      servers = [{ url: baseUrl }]
    }

    // Extract tags
    const tags = spec.tags || []

    // Extract endpoints
    const endpoints: OpenApiEndpointAssetData[] = []
    const paths = spec.paths || {}

    for (const [path, pathItem] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        const operation = (pathItem as Record<string, unknown>)[method]
        if (!operation || typeof operation !== 'object') continue

        if (isOpenApi3) {
          const op = operation as OpenApi3Operation
          endpoints.push(this.normalizeOpenApi3Operation(path, method, op))
        } else {
          const op = operation as Swagger2Operation
          endpoints.push(this.normalizeSwagger2Operation(path, method, op))
        }
      }
    }

    // Extract schemas
    const schemas: OpenApiSchemaAssetData[] = []
    let rawSchemas: Record<string, unknown> = {}

    if (isOpenApi3) {
      rawSchemas = (spec as OpenApi3Spec).components?.schemas || {}
    } else {
      rawSchemas = (spec as Swagger2Spec).definitions || {}
    }

    for (const [name, schema] of Object.entries(rawSchemas)) {
      schemas.push(this.normalizeSchema(name, schema))
    }

    // Extract security schemes
    const securitySchemes: OpenApiSecuritySchemeAssetData[] = []
    let rawSecSchemes: Record<string, unknown> = {}

    if (isOpenApi3) {
      rawSecSchemes = (spec as OpenApi3Spec).components?.securitySchemes || {}
    } else {
      rawSecSchemes = (spec as Swagger2Spec).securityDefinitions || {}
    }

    for (const [name, scheme] of Object.entries(rawSecSchemes)) {
      securitySchemes.push(this.normalizeSecurityScheme(name, scheme))
    }

    return {
      title,
      version,
      description,
      openapiVersion,
      baseUrl,
      servers,
      endpoints,
      schemas,
      securitySchemes,
      tags,
    }
  }

  /**
   * Normalize an OpenAPI 3.x operation
   */
  private normalizeOpenApi3Operation(
    path: string,
    method: string,
    op: OpenApi3Operation
  ): OpenApiEndpointAssetData {
    return {
      method: method.toUpperCase(),
      path,
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: op.tags,
      deprecated: op.deprecated,
      parameters: op.parameters?.map((p) => this.normalizeParameter(p)),
      requestBody: op.requestBody ? this.normalizeRequestBody(op.requestBody) : undefined,
      responses: op.responses ? this.normalizeResponses(op.responses) : undefined,
      security: op.security,
    }
  }

  /**
   * Normalize a Swagger 2.0 operation
   */
  private normalizeSwagger2Operation(
    path: string,
    method: string,
    op: Swagger2Operation
  ): OpenApiEndpointAssetData {
    // Convert Swagger 2.0 parameters to OpenAPI 3.x format
    const bodyParams = op.parameters?.filter((p) => p.in === 'body') || []
    const otherParams = op.parameters?.filter((p) => p.in !== 'body') || []

    // Build request body from body parameters
    let requestBody: OpenApiRequestBody | undefined
    if (bodyParams.length > 0) {
      const bodyParam = bodyParams[0]
      requestBody = {
        description: bodyParam.description,
        required: bodyParam.required,
        content: {
          'application/json': {
            schema: bodyParam.schema as OpenApiSchemaRef,
          },
        },
      }
    }

    return {
      method: method.toUpperCase(),
      path,
      operationId: op.operationId,
      summary: op.summary,
      description: op.description,
      tags: op.tags,
      deprecated: op.deprecated,
      parameters: otherParams.map((p) => this.normalizeParameter(p)),
      requestBody,
      responses: op.responses ? this.normalizeSwagger2Responses(op.responses) : undefined,
      security: op.security,
    }
  }

  /**
   * Normalize a parameter
   */
  private normalizeParameter(param: OpenApi3Parameter | Swagger2Parameter): OpenApiParameter {
    return {
      name: param.name,
      in: param.in as 'query' | 'path' | 'header' | 'cookie',
      required: param.required,
      description: param.description,
      schema: this.normalizeSchemaRef(param.schema || (param as Swagger2Parameter)),
      deprecated: (param as OpenApi3Parameter).deprecated,
    }
  }

  /**
   * Normalize a request body
   */
  private normalizeRequestBody(body: OpenApi3RequestBody): OpenApiRequestBody {
    const content: Record<string, { schema?: OpenApiSchemaRef }> = {}

    if (body.content) {
      for (const [mediaType, mediaContent] of Object.entries(body.content)) {
        content[mediaType] = {
          schema: mediaContent.schema ? this.normalizeSchemaRef(mediaContent.schema) : undefined,
        }
      }
    }

    return {
      description: body.description,
      required: body.required,
      content,
    }
  }

  /**
   * Normalize OpenAPI 3.x responses
   */
  private normalizeResponses(
    responses: Record<string, OpenApi3Response>
  ): Record<string, OpenApiResponse> {
    const result: Record<string, OpenApiResponse> = {}

    for (const [code, response] of Object.entries(responses)) {
      const content: Record<string, { schema?: OpenApiSchemaRef }> = {}

      if (response.content) {
        for (const [mediaType, mediaContent] of Object.entries(response.content)) {
          content[mediaType] = {
            schema: mediaContent.schema ? this.normalizeSchemaRef(mediaContent.schema) : undefined,
          }
        }
      }

      result[code] = {
        description: response.description,
        content: Object.keys(content).length > 0 ? content : undefined,
      }
    }

    return result
  }

  /**
   * Normalize Swagger 2.0 responses
   */
  private normalizeSwagger2Responses(
    responses: Record<string, Swagger2Response>
  ): Record<string, OpenApiResponse> {
    const result: Record<string, OpenApiResponse> = {}

    for (const [code, response] of Object.entries(responses)) {
      result[code] = {
        description: response.description,
        content: response.schema
          ? { 'application/json': { schema: this.normalizeSchemaRef(response.schema) } }
          : undefined,
      }
    }

    return result
  }

  /**
   * Normalize a schema reference
   */
  private normalizeSchemaRef(schema: unknown): OpenApiSchemaRef {
    if (!schema || typeof schema !== 'object') {
      return {}
    }

    const s = schema as Record<string, unknown>

    // Handle $ref
    if (typeof s.$ref === 'string') {
      // Convert Swagger 2.0 refs to OpenAPI 3.x format
      let ref = s.$ref
      if (ref.startsWith('#/definitions/')) {
        ref = ref.replace('#/definitions/', '#/components/schemas/')
      }
      return { $ref: ref }
    }

    const result: OpenApiSchemaRef = {}

    if (s.type) result.type = String(s.type)
    if (s.format) result.format = String(s.format)
    if (s.description) result.description = String(s.description)
    if (Array.isArray(s.enum)) result.enum = s.enum.map(String)
    if (s.example !== undefined) result.example = s.example
    if (Array.isArray(s.required)) result.required = s.required as string[]

    if (s.items && typeof s.items === 'object') {
      result.items = this.normalizeSchemaRef(s.items)
    }

    if (s.properties && typeof s.properties === 'object') {
      result.properties = {}
      for (const [name, prop] of Object.entries(s.properties)) {
        result.properties[name] = this.normalizeSchemaRef(prop)
      }
    }

    return result
  }

  /**
   * Normalize a schema definition
   */
  private normalizeSchema(name: string, schema: unknown): OpenApiSchemaAssetData {
    const normalized = this.normalizeSchemaRef(schema)

    return {
      name,
      type: normalized.type,
      description: normalized.description,
      properties: normalized.properties,
      required: normalized.required,
      enum: normalized.enum,
    }
  }

  /**
   * Normalize a security scheme
   */
  private normalizeSecurityScheme(
    name: string,
    scheme: unknown
  ): OpenApiSecuritySchemeAssetData {
    if (!scheme || typeof scheme !== 'object') {
      return { name, type: 'unknown' }
    }

    const s = scheme as Record<string, unknown>

    return {
      name,
      type: String(s.type || 'unknown'),
      description: s.description ? String(s.description) : undefined,
      in: s.in ? String(s.in) : undefined,
      scheme: s.scheme ? String(s.scheme) : undefined,
      bearerFormat: s.bearerFormat ? String(s.bearerFormat) : undefined,
    }
  }

  /**
   * Generate a URL-safe slug from API title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'api'
  }

  /**
   * Normalize a path for use in asset keys
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\{([^}]+)\}/g, '_$1_') // Replace {param} with _param_
      .replace(/[^a-zA-Z0-9_/-]/g, '') // Remove special chars
      .toLowerCase()
  }

  /**
   * Compute a deterministic fingerprint of the spec
   */
  private computeFingerprint(spec: OpenApiSpec): string {
    // Create a normalized representation for hashing
    const normalized = {
      title: spec.info.title,
      version: spec.info.version,
      paths: Object.keys(spec.paths || {}).sort(),
    }

    const str = JSON.stringify(normalized)

    // Simple hash function (djb2)
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i)
      hash = hash >>> 0 // Convert to unsigned 32-bit
    }

    return hash.toString(16).padStart(8, '0')
  }

  /**
   * Redact sensitive information for safe logging
   */
  redact<T extends Record<string, unknown>>(obj: T): T {
    const redacted = { ...obj }
    const sensitiveKeys = [
      'authorization',
      'api_key',
      'apikey',
      'token',
      'secret',
      'password',
      'bearer',
      'x-api-key',
      'headers',
    ]

    for (const key of Object.keys(redacted)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        redacted[key as keyof T] = '[REDACTED]' as T[keyof T]
      } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key as keyof T] = this.redact(redacted[key] as Record<string, unknown>) as T[keyof T]
      }
    }

    return redacted
  }
}

/**
 * Factory function to create a new OpenApiAdapter instance
 */
export function createOpenApiAdapter(): OpenApiAdapter {
  return new OpenApiAdapter()
}
