// Regras de conta usadas pelo front (para ajudar o usuário) e pelo back (para proteger o sistema).
// Documento 02, §5.2, §5.5, §5.10 e §7.2.
import { z } from 'zod'

export const ACCOUNT = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 16,
  /** Senha em code points depois do NFKC (NIST SP 800-63B-4: mínimo 15 quando é o único fator). */
  PASSWORD_MIN: 15,
  PASSWORD_MAX: 128,
  EMAIL_MAX: 254,
  MIN_AGE: 16,
  ADULT_AGE: 18,
} as const

/** Como no Minecraft: só [A-Za-z0-9_], o que também impede letras de outros alfabetos imitando latinas. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

/** Comparados sem diferenciar maiúsculas. Bloqueia também variações com dígitos e "_" no fim (admin_1). */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'administrator',
  'mod',
  'moderator',
  'moderation',
  'staff',
  'support',
  'help',
  'system',
  'root',
  'official',
  'security',
  'quillframe',
  'mojang',
  'minecraft',
  'microsoft',
  'notch',
  'jeb_',
]

export function isReservedUsername(username: string): boolean {
  const lower = username.toLowerCase()
  const base = lower.replace(/[0-9_]+$/, '')
  return RESERVED_USERNAMES.some((reserved) => lower === reserved || base === reserved.replace(/_+$/, ''))
}

/** A senha é comparada sempre na forma NFKC: "é" digitado de jeitos diferentes vira a mesma senha. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC')
}

/** Tamanho em code points, como o NIST conta (um emoji vale 1). */
export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length
}

/** Idade completa em `today` (as duas datas em UTC, como saem de `YYYY-MM-DD`). */
export function ageOn(birthDate: Date, today: Date): number {
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())
  if (beforeBirthday) age--
  return age
}

/** Data `YYYY-MM-DD` válida no calendário (recusa 2010-02-30). */
export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return date
}

export const usernameSchema = z
  .string()
  .regex(USERNAME_PATTERN, 'Usernames must be 3–16 characters: letters, numbers and _.')
  .refine((value) => !isReservedUsername(value), 'This username is not available.')

export const emailSchema = z
  .string()
  .trim()
  .max(ACCOUNT.EMAIL_MAX)
  .pipe(z.email('Enter a valid email address.'))
  .transform((value) => value.toLowerCase())

/** Qualquer caractere vale (espaço, acento, emoji). Não há regra de composição (NIST). */
export const passwordSchema = z
  .string()
  .max(ACCOUNT.PASSWORD_MAX * 4) // corta strings gigantes antes de normalizar
  .refine((value) => passwordLength(value) >= ACCOUNT.PASSWORD_MIN, {
    message: `Use at least ${ACCOUNT.PASSWORD_MIN} characters.`,
  })
  .refine((value) => passwordLength(value) <= ACCOUNT.PASSWORD_MAX, {
    message: `Use at most ${ACCOUNT.PASSWORD_MAX} characters.`,
  })

/** `today` é injetável para os testes. */
export function birthDateSchema(today: () => Date = () => new Date()) {
  return z
    .string()
    .refine((value) => parseIsoDate(value) !== null, 'Enter a valid date.')
    .refine((value) => {
      const date = parseIsoDate(value)
      return date !== null && date.getTime() <= today().getTime()
    }, 'Enter a valid date.')
    .refine((value) => {
      const date = parseIsoDate(value)
      return date !== null && ageOn(date, today()) >= ACCOUNT.MIN_AGE
    }, `You must be at least ${ACCOUNT.MIN_AGE} to use quillframe.`)
}

/** Tokens dos e-mails: 32 bytes em base64url = 43 caracteres. */
export const emailTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'This link is invalid or has expired.')

export function registerSchema(today?: () => Date) {
  return z
    .object({
      username: usernameSchema,
      email: emailSchema,
      password: passwordSchema,
      birthDate: birthDateSchema(today),
      acceptTerms: z.literal(true, 'You must accept the Terms to continue.'),
      turnstileToken: z.string().min(1).max(2048),
    })
    .strict()
}

/** No login, a senha não passa pela política: só limites de tamanho, para não revelar regras. */
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1)
      .max(ACCOUNT.PASSWORD_MAX * 4),
    turnstileToken: z.string().min(1).max(2048).optional(),
  })
  .strict()

export const verifyEmailSchema = z.object({ token: emailTokenSchema }).strict()

export const emailOnlySchema = z
  .object({ email: emailSchema, turnstileToken: z.string().min(1).max(2048).optional() })
  .strict()

export const resetPasswordSchema = z.object({ token: emailTokenSchema, newPassword: passwordSchema }).strict()

export type RegisterInput = z.infer<ReturnType<typeof registerSchema>>
export type LoginInput = z.infer<typeof loginSchema>

/** Versão dos Terms of Use e da Privacy Policy aceita no cadastro (documento 02, §7.8). */
export const TERMS_VERSION = '2026-11-14'

/** 16 e 17 anos: proteções ligadas e travadas (documento 02, §7.3). */
export function isMinor(birthDate: Date, today: Date): boolean {
  return ageOn(birthDate, today) < ACCOUNT.ADULT_AGE
}

/** Código TOTP de 6 dígitos (espaços são tolerados). */
export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'))

/** Código de recuperação: XXXX-XXXX-XXXX-XXXX (80 bits em base32). */
export const recoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-7]{16}$/, 'Enter a valid recovery code.'))

export const mfaLoginSchema = z
  .object({ code: totpCodeSchema.optional(), recoveryCode: recoveryCodeSchema.optional() })
  .strict()
  .refine((value) => (value.code === undefined) !== (value.recoveryCode === undefined), 'Enter a code.')

const anyPassword = z
  .string()
  .min(1)
  .max(ACCOUNT.PASSWORD_MAX * 4)

export const reauthSchema = z
  .object({ password: anyPassword.optional(), code: totpCodeSchema.optional() })
  .strict()
  .refine((value) => (value.password === undefined) !== (value.code === undefined), 'Enter your password.')

export const changePasswordSchema = z
  .object({ currentPassword: anyPassword, newPassword: passwordSchema })
  .strict()

export const changeEmailSchema = z.object({ newEmail: emailSchema }).strict()
export const totpCodeBodySchema = z.object({ code: totpCodeSchema }).strict()

export function oauthCompleteSchema(today?: () => Date) {
  return z
    .object({
      username: usernameSchema,
      birthDate: birthDateSchema(today),
      acceptTerms: z.literal(true, 'You must accept the Terms to continue.'),
    })
    .strict()
}

export const deleteAccountSchema = z.object({ username: z.string().min(1).max(16) }).strict()

export const OAUTH_PROVIDERS = ['google', 'discord'] as const
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number]

/** `returnTo` só aceita caminhos internos: começa com "/", nunca "//" nem "/\" (documento 02, §5.10). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  // Barra invertida e caracteres de controle: alguns navegadores tratam "/\" como "//"
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\\]/.test(value) ? '/' : value
}
