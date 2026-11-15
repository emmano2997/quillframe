// Tokens aleatórios de sessão, CSRF e e-mail (documento 02, §5.3 e §5.6).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 bytes (256 bits) em base64url: 43 caracteres. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * No banco fica só o SHA-256 do token. Com 256 bits aleatórios um hash rápido basta: não há o que
 * adivinhar, ao contrário de uma senha.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/** Compara duas strings em tempo constante (o tamanho pode vazar, o conteúdo não). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
