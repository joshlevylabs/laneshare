import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenApiAdapter } from './openapi-adapter'
import type { OpenApiSyncStats } from '@/lib/supabase/types'

// OpenAPI 3.0 JSON fixture
const openapi3Fixture = {
  openapi: '3.0.3',
  info: {
    title: 'Pet Store API',
    version: '1.0.0',
    description: 'A sample API for testing',
  },
  servers: [
    { url: 'https://api.petstore.com/v1', description: 'Production' },
    { url: 'https://staging.petstore.com/v1', description: 'Staging' },
  ],
  tags: [
    { name: 'pets', description: 'Pet operations' },
    { name: 'users', description: 'User operations' },
  ],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
          },
        ],
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PetList' },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
        },
        responses: {
          '201': { description: 'Pet created' },
        },
      },
    },
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'A pet',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
          '404': { description: 'Pet not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          species: { type: 'string', enum: ['dog', 'cat', 'bird'] },
        },
      },
      PetList: {
        type: 'array',
        items: { $ref: '#/components/schemas/Pet' },
      },
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
  },
}

// Swagger 2.0 fixture
const swagger2Fixture = {
  swagger: '2.0',
  info: {
    title: 'Legacy API',
    version: '2.0.0',
    description: 'A Swagger 2.0 API',
  },
  host: 'api.legacy.com',
  basePath: '/v2',
  schemes: ['https'],
  tags: [{ name: 'items' }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        summary: 'List items',
        tags: ['items'],
        produces: ['application/json'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            type: 'integer',
          },
        ],
        responses: {
          '200': {
            description: 'Items list',
            schema: { $ref: '#/definitions/ItemList' },
          },
        },
      },
      post: {
        operationId: 'createItem',
        summary: 'Create item',
        tags: ['items'],
        consumes: ['application/json'],
        parameters: [
          {
            name: 'body',
            in: 'body',
            required: true,
            schema: { $ref: '#/definitions/Item' },
          },
        ],
        responses: {
          '201': { description: 'Created' },
        },
      },
    },
  },
  definitions: {
    Item: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
    ItemList: {
      type: 'array',
      items: { $ref: '#/definitions/Item' },
    },
  },
  securityDefinitions: {
    basicAuth: {
      type: 'basic',
    },
  },
}

describe('OpenApiAdapter', () => {
  describe('redact', () => {
    it('redacts sensitive keys', () => {
      const adapter = new OpenApiAdapter()

      const obj = {
        openapi_url: 'https://api.example.com/openapi.json',
        authorization: 'Bearer secret-token',
        headers: { 'X-API-Key': 'secret-key' },
        api_key: 'another-secret',
      }

      const redacted = adapter.redact(obj)

      expect(redacted.openapi_url).toBe('https://api.example.com/openapi.json')
      expect(redacted.authorization).toBe('[REDACTED]')
      expect(redacted.headers).toBe('[REDACTED]')
      expect(redacted.api_key).toBe('[REDACTED]')
    })

    it('redacts nested objects', () => {
      const adapter = new OpenApiAdapter()

      const obj = {
        config: {
          url: 'https://api.example.com',
          token: 'secret-token',
        },
      }

      const redacted = adapter.redact(obj)

      expect((redacted.config as Record<string, unknown>).url).toBe('https://api.example.com')
      expect((redacted.config as Record<string, unknown>).token).toBe('[REDACTED]')
    })
  })

  describe('serviceType', () => {
    it('returns openapi', () => {
      const adapter = new OpenApiAdapter()
      expect(adapter.serviceType).toBe('openapi')
    })
  })

  describe('validateConnection', () => {
    let adapter: OpenApiAdapter
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      adapter = new OpenApiAdapter()
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('validates OpenAPI 3.0 spec', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.validateConnection(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      expect(result.valid).toBe(true)
      expect(result.metadata?.title).toBe('Pet Store API')
      expect(result.metadata?.version).toBe('1.0.0')
      expect(result.metadata?.endpoint_count).toBe(3)
      expect(result.metadata?.schema_count).toBe(2)
      expect(result.metadata?.security_scheme_count).toBe(2)
    })

    it('validates Swagger 2.0 spec', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/swagger.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(swagger2Fixture)),
      })

      const result = await adapter.validateConnection(
        { openapi_url: 'https://api.example.com/swagger.json' },
        {}
      )

      expect(result.valid).toBe(true)
      expect(result.metadata?.title).toBe('Legacy API')
      expect(result.metadata?.version).toBe('2.0.0')
      expect(result.metadata?.base_url).toBe('https://api.legacy.com/v2')
      expect(result.metadata?.endpoint_count).toBe(2)
      expect(result.metadata?.schema_count).toBe(2)
    })

    it('rejects invalid URL', async () => {
      const result = await adapter.validateConnection(
        { openapi_url: 'not-a-url' },
        {}
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid URL format')
    })

    it('rejects oversized specs', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '15000000' }), // 15MB
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.validateConnection(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('too large')
    })

    it('handles fetch timeout', async () => {
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'

      global.fetch = vi.fn().mockRejectedValue(abortError)

      const result = await adapter.validateConnection(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timed out')
    })
  })

  describe('sync', () => {
    let adapter: OpenApiAdapter
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      adapter = new OpenApiAdapter()
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('syncs OpenAPI 3.0 spec and returns assets', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json', api_slug: 'petstore' },
        {}
      )

      expect(result.success).toBe(true)
      const stats = result.stats as OpenApiSyncStats
      expect(stats.endpoints).toBe(3)
      expect(stats.schemas).toBe(2)
      expect(stats.security_schemes).toBe(2)
      expect(stats.spec_title).toBe('Pet Store API')

      // Check assets
      expect(result.assets.length).toBe(8) // 1 spec + 3 endpoints + 2 schemas + 2 security schemes

      // Check spec asset
      const specAsset = result.assets.find((a) => a.asset_type === 'openapi_spec')
      expect(specAsset).toBeDefined()
      expect(specAsset?.asset_key).toBe('openapi:petstore:spec')

      // Check endpoint assets
      const endpointAssets = result.assets.filter((a) => a.asset_type === 'endpoint')
      expect(endpointAssets.length).toBe(3)

      const listPetsAsset = endpointAssets.find((a) => a.name === 'listPets')
      expect(listPetsAsset).toBeDefined()
      expect(listPetsAsset?.asset_key).toContain('openapi:petstore:get:/pets')

      // Check schema assets
      const schemaAssets = result.assets.filter((a) => a.asset_type === 'schema')
      expect(schemaAssets.length).toBe(2)
      expect(schemaAssets.map((a) => a.name).sort()).toEqual(['Pet', 'PetList'])

      // Check security scheme assets
      const securityAssets = result.assets.filter((a) => a.asset_type === 'security_scheme')
      expect(securityAssets.length).toBe(2)
    })

    it('generates stable asset keys', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result1 = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json', api_slug: 'petstore' },
        {}
      )

      const result2 = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json', api_slug: 'petstore' },
        {}
      )

      // Asset keys should be identical across syncs
      const keys1 = result1.assets.map((a) => a.asset_key).sort()
      const keys2 = result2.assets.map((a) => a.asset_key).sort()

      expect(keys1).toEqual(keys2)
    })

    it('computes consistent fingerprint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result1 = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      const result2 = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      const stats1 = result1.stats as OpenApiSyncStats
      const stats2 = result2.stats as OpenApiSyncStats
      expect(stats1.spec_fingerprint).toBe(stats2.spec_fingerprint)
    })

    it('handles Swagger 2.0 spec', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/swagger.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(swagger2Fixture)),
      })

      const result = await adapter.sync(
        { openapi_url: 'https://api.example.com/swagger.json', api_slug: 'legacy' },
        {}
      )

      expect(result.success).toBe(true)
      const stats = result.stats as OpenApiSyncStats
      expect(stats.endpoints).toBe(2)
      expect(stats.base_url).toBe('https://api.legacy.com/v2')

      // Check that body parameters are converted to requestBody
      const createItemAsset = result.assets.find(
        (a) => a.asset_type === 'endpoint' && a.name === 'createItem'
      )
      expect(createItemAsset).toBeDefined()
      const createItemData = createItemAsset?.data_json as { requestBody?: object }
      expect(createItemData.requestBody).toBeDefined()
    })
  })

  describe('normalization', () => {
    it('normalizes path parameters in asset keys', async () => {
      const adapter = new OpenApiAdapter()
      const originalFetch = global.fetch

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json', api_slug: 'test' },
        {}
      )

      global.fetch = originalFetch

      // The path /pets/{id} should be normalized in the key
      const getPetAsset = result.assets.find((a) => a.name === 'getPet')
      expect(getPetAsset).toBeDefined()
      expect(getPetAsset?.asset_key).toContain('/pets/_id_')
    })

    it('converts Swagger 2.0 $ref to OpenAPI 3.x format', async () => {
      const adapter = new OpenApiAdapter()
      const originalFetch = global.fetch

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/swagger.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(swagger2Fixture)),
      })

      const result = await adapter.sync(
        { openapi_url: 'https://api.example.com/swagger.json' },
        {}
      )

      global.fetch = originalFetch

      // Check that definitions refs are converted to components/schemas
      const listItemsAsset = result.assets.find(
        (a) => a.asset_type === 'endpoint' && a.name === 'listItems'
      )
      expect(listItemsAsset).toBeDefined()

      const listItemsData = listItemsAsset?.data_json as {
        responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
      }
      const responseSchema = listItemsData.responses?.['200']?.content?.['application/json']?.schema
      expect(responseSchema?.$ref).toBe('#/components/schemas/ItemList')
    })
  })

  describe('slug generation', () => {
    it('generates slug from API title', async () => {
      const adapter = new OpenApiAdapter()
      const originalFetch = global.fetch

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.validateConnection(
        { openapi_url: 'https://api.example.com/openapi.json' },
        {}
      )

      global.fetch = originalFetch

      expect(result.valid).toBe(true)
      expect(result.metadata?.suggested_slug).toBe('pet-store-api')
    })

    it('uses provided slug over generated', async () => {
      const adapter = new OpenApiAdapter()
      const originalFetch = global.fetch

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://api.example.com/openapi.json',
        headers: new Headers({ 'content-length': '1000' }),
        text: () => Promise.resolve(JSON.stringify(openapi3Fixture)),
      })

      const result = await adapter.sync(
        { openapi_url: 'https://api.example.com/openapi.json', api_slug: 'custom-slug' },
        {}
      )

      global.fetch = originalFetch

      expect(result.success).toBe(true)
      const specAsset = result.assets.find((a) => a.asset_type === 'openapi_spec')
      expect(specAsset?.asset_key).toBe('openapi:custom-slug:spec')
    })
  })
})
