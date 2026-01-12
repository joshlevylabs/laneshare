import { describe, it, expect } from 'vitest'
import { VercelAdapter } from './vercel-adapter'

describe('VercelAdapter', () => {
  describe('redact', () => {
    it('redacts sensitive keys', () => {
      const adapter = new VercelAdapter()

      const obj = {
        team_id: 'team_abc123',
        token: 'vercel-token-secret',
        bearer: 'bearer-secret',
        authorization: 'auth-secret',
      }

      const redacted = adapter.redact(obj)

      expect(redacted.team_id).toBe('team_abc123')
      expect(redacted.token).toBe('[REDACTED]')
      expect(redacted.bearer).toBe('[REDACTED]')
      expect(redacted.authorization).toBe('[REDACTED]')
    })

    it('redacts nested objects', () => {
      const adapter = new VercelAdapter()

      const obj = {
        config: {
          team_slug: 'my-team',
          api_key: 'should-be-redacted',
        },
        auth: {
          token: 'also-secret',
        },
      }

      const redacted = adapter.redact(obj)

      expect((redacted.config as Record<string, unknown>).team_slug).toBe('my-team')
      expect((redacted.config as Record<string, unknown>).api_key).toBe('[REDACTED]')
      expect((redacted.auth as Record<string, unknown>).token).toBe('[REDACTED]')
    })

    it('preserves non-sensitive data', () => {
      const adapter = new VercelAdapter()

      const obj = {
        projects: 5,
        deployments: 25,
        team_slug: 'my-team',
        domains: ['example.com', 'test.com'],
      }

      const redacted = adapter.redact(obj)

      expect(redacted).toEqual(obj)
    })
  })

  describe('serviceType', () => {
    it('returns vercel', () => {
      const adapter = new VercelAdapter()
      expect(adapter.serviceType).toBe('vercel')
    })
  })
})
