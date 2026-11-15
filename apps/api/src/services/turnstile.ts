// Cloudflare Turnstile (documento 02, §5.12). O servidor só fala com um host fixo (sem SSRF).
import type { Config } from '../config.ts'
import { ApiError } from '../http/problem.ts'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface Turnstile {
  /** Lança `CAPTCHA_REQUIRED` se o token faltar ou for recusado. */
  verify(token: string | undefined, ip: string): Promise<void>
}

export function createTurnstile(config: Config, fetchFn: typeof fetch = fetch): Turnstile {
  const secret = config.TURNSTILE_SECRET_KEY
  if (!secret) {
    // Sem chave (desenvolvimento e testes) só confere que o front enviou algo.
    // Em produção a chave é obrigatória (config.ts).
    return {
      async verify(token) {
        if (!token) throw new ApiError('CAPTCHA_REQUIRED')
      },
    }
  }
  return {
    async verify(token, ip) {
      if (!token) throw new ApiError('CAPTCHA_REQUIRED')
      let ok: boolean
      try {
        const response = await fetchFn(VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5_000),
          redirect: 'error',
        })
        ok = response.ok && ((await response.json()) as { success?: boolean }).success === true
      } catch {
        ok = false // falhar fechado
      }
      if (!ok) throw new ApiError('CAPTCHA_REQUIRED')
    },
  }
}
