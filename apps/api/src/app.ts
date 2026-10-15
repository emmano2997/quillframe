import { GLYPH_METRICS_GAME_VERSION } from '@quillframe/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.ts'

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug',
            // Nada de credenciais nos logs (documento 02, §5.15)
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
  })

  app.get('/api/health', async () => ({ status: 'ok', bookEngine: GLYPH_METRICS_GAME_VERSION }))

  return app
}
