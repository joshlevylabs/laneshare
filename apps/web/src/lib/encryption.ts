import _sodium from 'libsodium-wrappers'

let sodium: typeof _sodium | null = null

async function getSodium() {
  if (!sodium) {
    await _sodium.ready
    sodium = _sodium
  }
  return sodium
}

function getKey(): Uint8Array {
  const keyBase64 = process.env.ENCRYPTION_KEY
  if (!keyBase64) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }

  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (256 bits)')
  }

  return new Uint8Array(key)
}

export async function encrypt(plaintext: string): Promise<string> {
  const sodium = await getSodium()
  const key = getKey()

  // Generate a random nonce
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)

  // Encrypt the plaintext
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonce,
    key
  )

  // Combine nonce and ciphertext, then base64 encode
  const combined = new Uint8Array(nonce.length + ciphertext.length)
  combined.set(nonce)
  combined.set(ciphertext, nonce.length)

  return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL)
}

export async function decrypt(encryptedBase64: string): Promise<string> {
  const sodium = await getSodium()
  const key = getKey()

  // Decode the base64
  const combined = sodium.from_base64(encryptedBase64, sodium.base64_variants.ORIGINAL)

  // Extract nonce and ciphertext
  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES)

  // Decrypt
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key)

  return sodium.to_string(plaintext)
}

// Helper to generate a new encryption key (for setup)
export async function generateEncryptionKey(): Promise<string> {
  const sodium = await getSodium()
  const key = sodium.randombytes_buf(32)
  return sodium.to_base64(key, sodium.base64_variants.ORIGINAL)
}
