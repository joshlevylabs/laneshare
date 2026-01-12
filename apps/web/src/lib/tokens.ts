import { randomBytes } from 'crypto'

/**
 * Generates a URL-safe, cryptographically secure token
 * Format: 32 bytes (256 bits) encoded as base64url = 43 characters
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Calculates expiration date (7 days from now)
 */
export function getInviteExpiration(): Date {
  const expiration = new Date()
  expiration.setDate(expiration.getDate() + 7)
  return expiration
}
