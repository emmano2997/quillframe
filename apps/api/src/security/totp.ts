// TOTP (RFC 6238: SHA-1, 6 dígitos, 30 s) e códigos de recuperação (documento 02, §5.8).
// O segredo fica no banco cifrado com AES-256-GCM; a chave vem de MFA_ENC_KEY_V*.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / STEP_SECONDS)
}

export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = (mac[mac.length - 1] as number) & 0x0f
  const binary = mac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Confere o código aceitando ±1 passo de diferença no relógio. Devolve o passo usado, ou null.
 * `lastUsedStep` impede usar o mesmo código duas vezes (anti-replay).
 */
export function verifyTotp(secret: Buffer, code: string, now: Date, lastUsedStep: bigint): number | null {
  const current = totpStep(now)
  const given = Buffer.from(code)
  let matched: number | null = null
  // Percorre sempre os três passos, para o tempo não revelar qual casou
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpCode(secret, step))
    if (expected.length === given.length && timingSafeEqual(expected, given) && BigInt(step) > lastUsedStep) {
      matched ??= step
    }
  }
  return matched
}

export function newTotpSecret(): Buffer {
  return randomBytes(20)
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'quillframe'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** iv (12) + texto cifrado + tag (16) */
export function encryptSecret(secret: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key.subarray(0, 32), iv)
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()])
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()])
}

export function decryptSecret(payload: Uint8Array, key: Buffer): Buffer {
  const data = Buffer.from(payload)
  const decipher = createDecipheriv('aes-256-gcm', key.subarray(0, 32), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()])
}

/** 10 códigos de 80 bits, no formato XXXX-XXXX-XXXX-XXXX. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10))
    return (raw.match(/.{4}/g) ?? [raw]).join('-')
  })
}

/** Forma canônica (sem hífens, maiúscula) em que o código é comparado e guardado como hash. */
export function canonicalRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase()
}
