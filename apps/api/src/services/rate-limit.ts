// Rate limit por janela fixa (documento 02, §5.5). Os contadores ficam no Redis em produção, para
// não zerarem quando o servidor hiberna; sem REDIS_URL, ficam na memória.
import type { Redis } from 'ioredis'
import { ApiError } from '../http/problem.ts'

export interface RateLimitStore {
  /** Soma 1 ao contador e devolve o total e quanto falta para a janela acabar. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>
  /** Lê sem somar. */
  peek(key: string): Promise<number>
  clear(key: string): Promise<void>
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  async hit(key: string, windowMs: number) {
    const now = this.now()
    let entry = this.counters.get(key)
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs }
      this.counters.set(key, entry)
      // Limpeza ocasional, para o mapa não crescer sem limite
      if (this.counters.size > 50_000) {
        for (const [k, v] of this.counters) if (v.expiresAt <= now) this.counters.delete(k)
      }
    }
    entry.count++
    return { count: entry.count, resetMs: entry.expiresAt - now }
  }

  async peek(key: string) {
    const entry = this.counters.get(key)
    return entry && entry.expiresAt > this.now() ? entry.count : 0
  }

  async clear(key: string) {
    this.counters.delete(key)
  }
}

// INCR + PEXPIRE atômicos: sem o script, um contador poderia ficar sem validade
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis

  constructor(redis: Redis) {
    this.redis = redis
  }

  async hit(key: string, windowMs: number) {
    const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, `qf:rl:${key}`, String(windowMs))) as [
      number,
      number,
    ]
    return { count, resetMs: ttl }
  }

  async peek(key: string) {
    return Number((await this.redis.get(`qf:rl:${key}`)) ?? 0)
  }

  async clear(key: string) {
    await this.redis.del(`qf:rl:${key}`)
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Tabela do documento 02, §5.5: [limite, janela em ms]. */
export const LIMITS = {
  api: [300, MINUTE],
  loginMinute: [5, MINUTE],
  loginHour: [30, HOUR],
  loginIp: [100, HOUR],
  mfaAccount: [20, HOUR],
  register: [5, HOUR],
  usernameCheck: [60, MINUTE],
  emailLinkEmail: [3, HOUR],
  emailLinkIp: [10, HOUR],
  verifyToken: [30, HOUR],
  reauth: [5, 15 * MINUTE],
  autosave: [120, MINUTE],
  bookCreate: [30, HOUR],
  interact: [60, MINUTE],
  friendRequests: [30, DAY],
  reports: [10, HOUR],
  appeals: [10, DAY],
  search: [30, MINUTE],
  dataExport: [1, DAY],
  concerns: [5, HOUR],
} as const satisfies Record<string, readonly [number, number]>

export type LimitName = keyof typeof LIMITS

export class RateLimiter {
  readonly store: RateLimitStore

  constructor(store: RateLimitStore) {
    this.store = store
  }

  /** Conta uma tentativa e lança 429 `RATE_LIMITED` (com Retry-After) se passou do limite. */
  async consume(name: LimitName, key: string): Promise<void> {
    const [limit, windowMs] = LIMITS[name]
    const { count, resetMs } = await this.store.hit(`${name}:${key}`, windowMs)
    if (count > limit) {
      const seconds = Math.max(1, Math.ceil(resetMs / 1000))
      throw new ApiError('RATE_LIMITED', { headers: { 'Retry-After': String(seconds) } })
    }
  }

  /** Conta uma tentativa; devolve false se passou do limite (para as rotas que respondem sempre igual). */
  async tryConsume(name: LimitName, key: string): Promise<boolean> {
    const [limit, windowMs] = LIMITS[name]
    const { count } = await this.store.hit(`${name}:${key}`, windowMs)
    return count <= limit
  }
}
