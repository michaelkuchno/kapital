/**
 * Encrypted backup of the personal data (assets + profile): AES-GCM 256 with a key derived from the password
 * by PBKDF2-SHA256 (310 000 iterations, OWASP 2023). Format: JSON { v, salt, iv, data } (base64).
 */
const ITER = 310_000
const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export interface Vault {
  v: 1
  salt: string
  iv: string
  data: string
}

export async function seal(payload: unknown, password: string): Promise<Vault> {
  if (password.length < 8) throw new Error('password too short')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), enc.encode(JSON.stringify(payload)))
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(ct)) }
}

export async function open<T>(vault: Vault, password: string): Promise<T> {
  if (vault?.v !== 1) throw new Error('unknown format')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) as BufferSource }, await key(password, unb64(vault.salt)), unb64(vault.data) as BufferSource)
  return JSON.parse(dec.decode(pt)) as T
}
