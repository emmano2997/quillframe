// Headers de segurança (documento 02, §5.11). A CSP não tem 'unsafe-inline' nem 'unsafe-eval'.
import helmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ['https://challenges.cloudflare.com'],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Desligados: o X-XSS-Protection antigo pode até criar falhas; o COEP quebraria o Turnstile
    xXssProtection: false,
    crossOriginEmbedderPolicy: false,
  })

  app.addHook('onSend', async (request, reply) => {
    void reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    if (request.url.startsWith('/api/')) void reply.header('Cache-Control', 'no-store')
  })
}
