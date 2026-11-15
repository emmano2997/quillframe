// Regras de conta usadas por mais de uma rota: tokens de e-mail, política de senha, 2FA e o
// payload de /api/me.
import { ACCOUNT, ageOn, type ContentFilter } from '@quillframe/shared'
import type { FastifyRequest } from 'fastify'
import { HOUR, MINUTE, type Deps, type Tx } from '../context.ts'
import type { TokenPurpose, User } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import type { Auth } from '../http/session.ts'
import { checkBreachedPassword, containsContextWord } from '../security/breached-passwords.ts'
import { hashToken, randomToken } from '../security/tokens.ts'
import { canonicalRecoveryCode, decryptSecret, verifyTotp } from '../security/totp.ts'

export const TOKEN_TTL: Record<TokenPurpose, number> = {
  PASSWORD_RESET: 30 * MINUTE,
  EMAIL_VERIFY: 24 * HOUR,
  EMAIL_CHANGE: HOUR,
}

/** Pedir de novo invalida o token anterior do mesmo tipo (§5.6). */
export async function createEmailToken(
  deps: Deps,
  db: Tx,
  userId: string,
  purpose: TokenPurpose,
  newEmail?: string,
): Promise<string> {
  const token = randomToken()
  await db.emailToken.deleteMany({ where: { userId, purpose } })
  await db.emailToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      newEmail: newEmail ?? null,
      expiresAt: new Date(deps.now().getTime() + TOKEN_TTL[purpose]),
    },
  })
  return token
}

const INVALID_LINK = 'This link is invalid or has expired.'

/** Uso único: marca o token como usado na mesma operação que o encontra. */
export async function consumeEmailToken(deps: Deps, token: string, purposes: TokenPurpose[]) {
  const now = deps.now()
  const tokenHash = hashToken(token)
  const claimed = await deps.db.emailToken.updateMany({
    where: { tokenHash, purpose: { in: purposes }, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (claimed.count !== 1) throw new ApiError('VALIDATION_FAILED', { detail: INVALID_LINK })
  const record = await deps.db.emailToken.findUnique({ where: { tokenHash }, include: { user: true } })
  if (!record) throw new ApiError('VALIDATION_FAILED', { detail: INVALID_LINK })
  return record
}

/** Política de senha no cadastro e em toda troca (§5.2): palavras do contexto e senhas vazadas. */
export async function assertPasswordAllowed(
  deps: Deps,
  request: FastifyRequest,
  password: string,
  context: { username?: string; email?: string },
): Promise<void> {
  if (containsContextWord(password, context)) throw new ApiError('WEAK_PASSWORD')
  const status = await checkBreachedPassword(password, deps.fetch)
  if (status === 'breached') throw new ApiError('BREACHED_PASSWORD')
  // API fora do ar: o cadastro segue e o caso fica registrado
  if (status === 'unknown') request.log.warn('HIBP indisponível: senha não conferida contra vazamentos')
}

/** Domínios de e-mail descartáveis mais comuns (§5.12). */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'sharklasers.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'fakeinbox.com',
])

export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(email.split('@')[1] ?? '')
}

/** Username livre? Considera contas existentes e os reservados por 90 dias depois de uma exclusão. */
export async function isUsernameTaken(deps: Deps, username: string): Promise<boolean> {
  const usernameLower = username.toLowerCase()
  const [user, reserved] = await Promise.all([
    deps.db.user.findUnique({ where: { usernameLower }, select: { id: true } }),
    deps.db.reservedUsername.findUnique({ where: { usernameLower } }),
  ])
  return user !== null || (reserved !== null && reserved.until > deps.now())
}

/** Username e bio com termo bloqueado são recusados na hora (§6.2). */
export function assertNameAllowed(filter: ContentFilter, text: string): void {
  // Um username como "Bad_Word99" precisa ser lido como palavras
  const spaced = text.replace(/[_0-9]+/g, ' ')
  if (filter.worst([text, spaced]) !== null) throw new ApiError('NAME_NOT_ALLOWED')
}

/**
 * Confere um código TOTP ou de recuperação. O código TOTP só vale uma vez (`lastUsedStep`), e o de
 * recuperação é marcado como usado na mesma operação.
 */
export async function verifyMfa(
  deps: Deps,
  userId: string,
  input: { code?: string | undefined; recoveryCode?: string | undefined },
): Promise<'totp' | 'recovery' | null> {
  if (input.code !== undefined) {
    const credential = await deps.db.totpCredential.findUnique({ where: { userId } })
    const key = credential ? deps.config.mfaKeys.get(credential.keyVersion) : undefined
    if (!credential?.enabledAt || !key) return null
    const step = verifyTotp(
      decryptSecret(credential.secretEnc, key),
      input.code,
      deps.now(),
      credential.lastUsedStep,
    )
    if (step === null) return null
    const claimed = await deps.db.totpCredential.updateMany({
      where: { userId, lastUsedStep: { lt: step } },
      data: { lastUsedStep: step },
    })
    return claimed.count === 1 ? 'totp' : null
  }
  if (input.recoveryCode !== undefined) {
    const claimed = await deps.db.recoveryCode.updateMany({
      where: { userId, codeHash: hashToken(canonicalRecoveryCode(input.recoveryCode)), usedAt: null },
      data: { usedAt: deps.now() },
    })
    return claimed.count === 1 ? 'recovery' : null
  }
  return null
}

/** O que o front sabe sobre quem está logado. Nunca inclui hash, tokens ou segredos. */
export function mePayload(auth: Auth, now: Date) {
  const { user } = auth
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    status: user.status,
    suspendedUntil: user.suspendedUntil,
    deletionRequestedAt: user.deletionRequestedAt,
    avatarId: user.avatarId,
    bio: user.bio ?? '',
    hasPassword: user.passwordHash !== null,
    mfaEnabled: auth.mfaEnabled,
    minor: auth.minor,
    privacy: privacyOf(user, auth.minor),
    createdAt: user.createdAt,
    age: ageOn(user.birthDate, now) >= ACCOUNT.ADULT_AGE ? 'adult' : 'minor',
  }
}

/** Privacidade efetiva: para 16–17 anos as proteções valem sempre, seja qual for o valor salvo (§7.3). */
export function privacyOf(
  user: Pick<User, 'searchable' | 'showFavorites' | 'friendRequestPolicy'>,
  minor: boolean,
) {
  return minor
    ? {
        searchable: false,
        showFavorites: false,
        friendRequestPolicy: 'FRIENDS_OF_FRIENDS' as const,
        locked: true,
      }
    : {
        searchable: user.searchable,
        showFavorites: user.showFavorites,
        friendRequestPolicy: user.friendRequestPolicy,
        locked: false,
      }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

/** a***@example.com, para avisos enviados a outro endereço. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}
