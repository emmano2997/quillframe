import { ContentFilter, GLYPH_METRICS_GAME_VERSION } from '@quillframe/shared'
import { PrismaPg } from '@prisma/adapter-pg'
import Fastify, { type FastifyInstance } from 'fastify'
import { Redis } from 'ioredis'
import type { Config } from './config.ts'
import { MINUTE, type Deps } from './context.ts'
import { PrismaClient } from './generated/prisma/client.ts'
import { registerProblemHandlers } from './http/problem.ts'
import { registerSecurityHeaders } from './http/security-headers.ts'
import { registerSession } from './http/session.ts'
import { registerStatic } from './http/static.ts'
import { registerAccountRoutes } from './routes/account.ts'
import { registerAdminRoutes } from './routes/admin.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerBookRoutes } from './routes/books.ts'
import { registerModerationRoutes } from './routes/moderation.ts'
import { registerOAuthRoutes } from './routes/oauth.ts'
import { registerReportRoutes } from './routes/reports.ts'
import { registerSocialRoutes } from './routes/social.ts'
import { PasswordHasher } from './security/password.ts'
import { createMailer, mails } from './services/mailer.ts'
import { MemoryRateLimitStore, RateLimiter, RedisRateLimitStore } from './services/rate-limit.ts'
import { createTurnstile } from './services/turnstile.ts'

export function createDb(config: Config): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.DATABASE_URL,
      // Pool pequeno e consultas com tempo máximo (documento 02, §5.12)
      max: 10,
      statement_timeout: 5_000,
    }),
  })
}

/** Os termos do filtro ficam no banco; o autômato é refeito no máximo uma vez por minuto. */
function cachedFilter(db: PrismaClient, now: () => Date): Deps['filter'] {
  let cache: { filter: ContentFilter; at: number } | null = null
  return async () => {
    if (!cache || now().getTime() - cache.at > MINUTE) {
      const terms = await db.filterTerm.findMany({ select: { term: true, severity: true } })
      cache = { filter: new ContentFilter(terms), at: now().getTime() }
    }
    return cache.filter
  }
}

export async function buildApp(config: Config, overrides: Partial<Deps> = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug',
            // Nada de credenciais nos logs (documento 02, §5.15). O corpo das requisições nunca é registrado.
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
          },
    bodyLimit: 64 * 1024,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    trustProxy: config.TRUST_PROXY,
  })
  // Só JSON: um formulário HTML de outro site não consegue enviar application/json sem preflight (§5.4)
  app.removeContentTypeParser('text/plain')

  const db = overrides.db ?? createDb(config)
  const now = overrides.now ?? (() => new Date())
  const redis =
    !overrides.limiter && config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null
  const deps: Deps = {
    config,
    db,
    now,
    hasher: overrides.hasher ?? new PasswordHasher(config.passwordPeppers, config.passwordPepperCurrent),
    mailer: overrides.mailer ?? createMailer(config, app.log),
    mails: mails(config.APP_ORIGIN),
    limiter:
      overrides.limiter ??
      new RateLimiter(
        redis ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore(() => now().getTime()),
      ),
    turnstile: overrides.turnstile ?? createTurnstile(config),
    fetch: overrides.fetch ?? fetch,
    filter: overrides.filter ?? cachedFilter(db, now),
  }
  app.decorate('deps', deps)
  app.addHook('onClose', async () => {
    if (!overrides.db) await db.$disconnect()
    redis?.disconnect()
  })

  registerProblemHandlers(app)
  await registerSecurityHeaders(app)
  await registerSession(app, deps)

  app.get('/api/health', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`
      return { status: 'ok', bookEngine: GLYPH_METRICS_GAME_VERSION }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })

  // Contato para relatar vulnerabilidades (RFC 9116)
  app.get('/.well-known/security.txt', async (_request, reply) => {
    const expires = new Date(now().getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
    return reply
      .type('text/plain; charset=utf-8')
      .send(
        `Contact: ${config.SECURITY_CONTACT}\nExpires: ${expires}\nPreferred-Languages: en, pt\nCanonical: ${config.APP_ORIGIN}/.well-known/security.txt\n`,
      )
  })

  registerAuthRoutes(app, deps)
  registerOAuthRoutes(app, deps)
  registerAccountRoutes(app, deps)
  registerBookRoutes(app, deps)
  registerSocialRoutes(app, deps)
  registerReportRoutes(app, deps)
  registerModerationRoutes(app, deps)
  registerAdminRoutes(app, deps)
  await registerStatic(app, config)

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps
  }
}
