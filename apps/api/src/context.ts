// Dependências da aplicação, criadas uma vez em buildApp e passadas às rotas. Nos testes, o
// e-mail, o relógio, o Turnstile e as chamadas externas são trocados por versões em memória.
import type { ContentFilter } from '@quillframe/shared'
import type { Config } from './config.ts'
import type { Prisma, PrismaClient } from './generated/prisma/client.ts'
import type { PasswordHasher } from './security/password.ts'
import type { Mailer, Mails } from './services/mailer.ts'
import type { RateLimiter } from './services/rate-limit.ts'
import type { Turnstile } from './services/turnstile.ts'

export type Db = PrismaClient
export type Tx = Prisma.TransactionClient

export interface Deps {
  config: Config
  db: Db
  hasher: PasswordHasher
  mailer: Mailer
  mails: Mails
  limiter: RateLimiter
  turnstile: Turnstile
  /** Chamadas a hosts fixos: HIBP, Google, Discord (nunca a URLs de usuários, §5.10). */
  fetch: typeof fetch
  now: () => Date
  /** Filtro de conteúdo com os termos do banco (em cache por um minuto). */
  filter: () => Promise<ContentFilter>
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
