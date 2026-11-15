// Variáveis de ambiente validadas na inicialização: se faltar ou estiver errada, a API não sobe
// (documento 02, §5.13).
import { z } from 'zod'

/** Segredo em base64url (ou base64) com pelo menos 32 bytes. */
const secret = z
  .string()
  .transform((value) => Buffer.from(value, 'base64url'))
  .refine((bytes) => bytes.length >= 32, 'precisa de pelo menos 32 bytes (gere com `pnpm secret`)')

const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))

const flag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().transform((value) => new URL(value).origin),
  DATABASE_URL: z.string().min(1),
  /** Sem Redis, os contadores de rate limit ficam na memória (só para desenvolvimento e testes). */
  REDIS_URL: optional,
  CSRF_SECRET: secret,
  PASSWORD_PEPPER_CURRENT: z.coerce.number().int().min(1),
  MFA_ENC_KEY_CURRENT: z.coerce.number().int().min(1),
  /** Atrás do Render e da Cloudflare, o IP do cliente vem em X-Forwarded-For. */
  TRUST_PROXY: flag,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  DISCORD_CLIENT_ID: optional,
  DISCORD_CLIENT_SECRET: optional,
  /** Produção: Resend. Desenvolvimento: MAILPIT_URL (docker-compose). Sem nenhum, os e-mails vão para o log. */
  RESEND_API_KEY: optional,
  MAIL_FROM: z.string().default('quillframe <no-reply@quillframe.local>'),
  MAILPIT_URL: optional,
  TURNSTILE_SECRET_KEY: optional,
  /** Chave pública do Turnstile, entregue ao front por /api/config. */
  TURNSTILE_SITE_KEY: optional,
  SECURITY_CONTACT: z.string().default('mailto:security@quillframe.local'),
  /** Admins avisados de picos de falha de login e denúncias graves (documento 02, §5.15). */
  ADMIN_ALERT_EMAIL: optional,
  /** Pasta da SPA compilada (apps/web/dist). Sem ela, a API não serve o site. */
  WEB_DIST: optional,
  SENTRY_DSN: optional,
})

type Parsed = z.infer<typeof schema>

export type Config = Omit<Parsed, 'PASSWORD_PEPPER_CURRENT' | 'MFA_ENC_KEY_CURRENT'> & {
  /** Peppers por versão (`PASSWORD_PEPPER_V1`, `_V2`...). Versões antigas ficam para o rehash no login. */
  passwordPeppers: ReadonlyMap<number, Buffer>
  passwordPepperCurrent: number
  /** Chaves AES-256 do segredo TOTP por versão (`MFA_ENC_KEY_V1`...). */
  mfaKeys: ReadonlyMap<number, Buffer>
  mfaKeyCurrent: number
}

function versionedSecrets(env: NodeJS.ProcessEnv, prefix: string, problems: string[]): Map<number, Buffer> {
  const pattern = new RegExp(`^${prefix}_V([1-9]\\d*)$`)
  const secrets = new Map<number, Buffer>()
  for (const [key, value] of Object.entries(env)) {
    const match = pattern.exec(key)
    if (!match || value === undefined) continue
    const parsed = secret.safeParse(value)
    if (parsed.success) secrets.set(Number(match[1]), parsed.data)
    else problems.push(`${key}: ${parsed.error.issues[0]?.message}`)
  }
  return secrets
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = []
  const result = schema.safeParse(env)
  if (!result.success) {
    problems.push(...result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`))
  }

  const passwordPeppers = versionedSecrets(env, 'PASSWORD_PEPPER', problems)
  const mfaKeys = versionedSecrets(env, 'MFA_ENC_KEY', problems)

  if (result.success) {
    const data = result.data
    if (!passwordPeppers.has(data.PASSWORD_PEPPER_CURRENT)) {
      problems.push(`PASSWORD_PEPPER_V${data.PASSWORD_PEPPER_CURRENT}: não definido (é a versão atual)`)
    }
    if (!mfaKeys.has(data.MFA_ENC_KEY_CURRENT)) {
      problems.push(`MFA_ENC_KEY_V${data.MFA_ENC_KEY_CURRENT}: não definido (é a versão atual)`)
    }
    for (const provider of ['GOOGLE', 'DISCORD'] as const) {
      if (Boolean(data[`${provider}_CLIENT_ID`]) !== Boolean(data[`${provider}_CLIENT_SECRET`])) {
        problems.push(`${provider}_CLIENT_ID e ${provider}_CLIENT_SECRET: defina os dois ou nenhum`)
      }
    }
    // Em produção nada fica "aberto por falta de configuração": falhar fechado (§5.1)
    if (data.NODE_ENV === 'production') {
      for (const key of [
        'REDIS_URL',
        'RESEND_API_KEY',
        'TURNSTILE_SECRET_KEY',
        'TURNSTILE_SITE_KEY',
      ] as const) {
        if (!data[key]) problems.push(`${key}: obrigatório em produção`)
      }
      if (!data.APP_ORIGIN.startsWith('https://')) problems.push('APP_ORIGIN: precisa ser https em produção')
    }
  }

  if (!result.success || problems.length > 0) {
    throw new Error(`Configuração inválida:\n  ${problems.join('\n  ')}`)
  }

  const { PASSWORD_PEPPER_CURRENT, MFA_ENC_KEY_CURRENT, ...rest } = result.data
  return {
    ...rest,
    passwordPeppers,
    passwordPepperCurrent: PASSWORD_PEPPER_CURRENT,
    mfaKeys,
    mfaKeyCurrent: MFA_ENC_KEY_CURRENT,
  }
}
