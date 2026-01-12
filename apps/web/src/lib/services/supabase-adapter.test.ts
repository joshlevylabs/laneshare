import { describe, it, expect, vi } from 'vitest'
import { SupabaseAdapter } from './supabase-adapter'

describe('SupabaseAdapter', () => {
  describe('redact', () => {
    it('redacts sensitive keys', () => {
      const adapter = new SupabaseAdapter()

      const obj = {
        supabase_url: 'https://test.supabase.co',
        service_role_key: 'secret-key-12345',
        apiKey: 'another-secret',
        password: 'my-password',
      }

      const redacted = adapter.redact(obj)

      expect(redacted.supabase_url).toBe('https://test.supabase.co')
      expect(redacted.service_role_key).toBe('[REDACTED]')
      expect(redacted.apiKey).toBe('[REDACTED]')
      expect(redacted.password).toBe('[REDACTED]')
    })

    it('redacts nested objects', () => {
      const adapter = new SupabaseAdapter()

      const obj = {
        config: {
          url: 'https://test.supabase.co',
          secret: 'should-be-redacted',
        },
        meta: {
          token: 'also-secret',
        },
      }

      const redacted = adapter.redact(obj)

      expect((redacted.config as Record<string, unknown>).url).toBe('https://test.supabase.co')
      expect((redacted.config as Record<string, unknown>).secret).toBe('[REDACTED]')
      expect((redacted.meta as Record<string, unknown>).token).toBe('[REDACTED]')
    })

    it('preserves non-sensitive data', () => {
      const adapter = new SupabaseAdapter()

      const obj = {
        tables: 10,
        columns: 50,
        project_id: 'abc-123',
        display_name: 'My Project',
      }

      const redacted = adapter.redact(obj)

      expect(redacted).toEqual(obj)
    })
  })

  describe('serviceType', () => {
    it('returns supabase', () => {
      const adapter = new SupabaseAdapter()
      expect(adapter.serviceType).toBe('supabase')
    })
  })
})
