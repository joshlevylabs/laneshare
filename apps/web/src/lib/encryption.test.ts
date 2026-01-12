import { describe, it, expect, beforeAll } from 'vitest'

// We need to mock the environment variable for tests
beforeAll(() => {
  // Generate a valid 32-byte key for testing
  process.env.ENCRYPTION_KEY = Buffer.from(new Array(32).fill(0).map((_, i) => i)).toString('base64')
})

describe('encryption', () => {
  it('encrypts and decrypts strings correctly', async () => {
    const { encrypt, decrypt } = await import('./encryption')

    const plaintext = 'my-secret-token-12345'
    const encrypted = await encrypt(plaintext)

    // Encrypted should be different from plaintext
    expect(encrypted).not.toBe(plaintext)

    // Should be base64 encoded
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/)

    // Should decrypt back to original
    const decrypted = await decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertexts for same plaintext', async () => {
    const { encrypt } = await import('./encryption')

    const plaintext = 'same-text'
    const encrypted1 = await encrypt(plaintext)
    const encrypted2 = await encrypt(plaintext)

    // Due to random nonce, ciphertexts should differ
    expect(encrypted1).not.toBe(encrypted2)
  })

  it('handles empty strings', async () => {
    const { encrypt, decrypt } = await import('./encryption')

    const encrypted = await encrypt('')
    const decrypted = await decrypt(encrypted)

    expect(decrypted).toBe('')
  })

  it('handles unicode strings', async () => {
    const { encrypt, decrypt } = await import('./encryption')

    const plaintext = 'Hello 世界 🌍 émojis'
    const encrypted = await encrypt(plaintext)
    const decrypted = await decrypt(encrypted)

    expect(decrypted).toBe(plaintext)
  })

  it('handles JSON strings', async () => {
    const { encrypt, decrypt } = await import('./encryption')

    const secrets = { service_role_key: 'secret-key-123', nested: { token: 'abc' } }
    const plaintext = JSON.stringify(secrets)
    const encrypted = await encrypt(plaintext)
    const decrypted = await decrypt(encrypted)

    expect(JSON.parse(decrypted)).toEqual(secrets)
  })
})
