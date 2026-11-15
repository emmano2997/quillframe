// Autenticação: cadastro, verificação, login, 2FA, reset de senha e step-up (documento 02, §5.2–5.8).
import {
  emailOnlySchema,
  loginSchema,
  mfaLoginSchema,
  reauthSchema,
  registerSchema,
  resetPasswordSchema,
  TERMS_VERSION,
  usernameSchema,
  verifyEmailSchema,
} from '@quillframe/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { HOUR, MINUTE, type Deps } from '../context.ts'
import type { User } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import {
  audit,
  clearCookie,
  COOKIES,
  describeDevice,
  issueCsrf,
  requireAuth,
  revokeSessions,
  setCookie,
  startSession,
  userAgentOf,
} from '../http/session.ts'
import { hashToken, randomToken } from '../security/tokens.ts'
import {
  assertNameAllowed,
  assertPasswordAllowed,
  consumeEmailToken,
  createEmailToken,
  isDisposableEmail,
  isUniqueViolation,
  isUsernameTaken,
  maskEmail,
  mePayload,
  verifyMfa,
} from '../services/accounts.ts'

const PENDING_LOGIN_MS = 5 * MINUTE
const MAX_MFA_ATTEMPTS = 5
/** Falhas seguidas na conta até o Turnstile ser exigido, e até o e-mail de alerta (§5.5). */
const CAPTCHA_AFTER_FAILURES = 5
const ALERT_AFTER_FAILURES = 10

const ACCEPTED = { message: 'Check your email to continue.' }
const LINK_SENT = { message: "If an account exists for this email, we've sent a link." }

/**
 * Termina um login já autenticado (senha, 2FA ou provedor): sessão nova, alerta de dispositivo novo
 * e auditoria. Usado também pelo OAuth.
 */
export async function finishLogin(
  deps: Deps,
  request: FastifyRequest,
  reply: FastifyReply,
  user: User,
  method: string,
): Promise<void> {
  const userAgent = userAgentOf(request)
  const [first, sameDevice] = await Promise.all([
    deps.db.auditLog.findFirst({ where: { actorId: user.id, event: 'LOGIN_SUCCESS' }, select: { id: true } }),
    deps.db.auditLog.findFirst({
      where: { actorId: user.id, event: 'LOGIN_SUCCESS', userAgent },
      select: { id: true },
    }),
  ])
  await startSession(deps, request, reply, user.id)
  await audit(deps, request, 'LOGIN_SUCCESS', { actorId: user.id, meta: { method } })
  if (first && !sameDevice) {
    await deps.mailer.send(deps.mails.newSignIn(user.email, describeDevice(userAgent), deps.now()))
    await deps.db.notification.create({
      data: {
        userId: user.id,
        type: 'SECURITY_ALERT',
        payload: { kind: 'NEW_SIGN_IN', device: describeDevice(userAgent) },
      },
    })
  }
}

/** Senha certa, mas a conta tem 2FA: guarda o login pendente num cookie próprio por 5 minutos. */
export async function startPendingLogin(deps: Deps, reply: FastifyReply, userId: string): Promise<never> {
  const token = randomToken()
  await deps.db.pendingLogin.create({
    data: { id: hashToken(token), userId, expiresAt: new Date(deps.now().getTime() + PENDING_LOGIN_MS) },
  })
  setCookie(reply, COOKIES.mfa, token, { maxAgeMs: PENDING_LOGIN_MS, sameSite: 'strict' })
  throw new ApiError('MFA_REQUIRED')
}

async function currentUser(deps: Deps, userId: string) {
  const user = await deps.db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { totp: { select: { enabledAt: true } } },
  })
  return user
}

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, limiter } = deps

  app.get('/api/auth/csrf', async (request, reply) => ({
    csrfToken: issueCsrf(deps, reply, request.sessionId),
  }))

  /** O que o front precisa saber antes do login. Nada aqui é segredo. */
  app.get('/api/config', async () => ({
    turnstileSiteKey: deps.config.TURNSTILE_SITE_KEY ?? null,
    oauth: {
      google: Boolean(deps.config.GOOGLE_CLIENT_ID),
      discord: Boolean(deps.config.DISCORD_CLIENT_ID),
    },
    termsVersion: TERMS_VERSION,
  }))

  // O username é público, então a checagem ao vivo é aceitável, com rate limit (§5.5)
  app.get('/api/auth/username-available', async (request) => {
    await limiter.consume('usernameCheck', request.ip)
    const parsed = usernameSchema.safeParse((request.query as { username?: unknown }).username)
    if (!parsed.success)
      return { available: false, reason: parsed.error.issues[0]?.message ?? 'Invalid username.' }
    const taken = await isUsernameTaken(deps, parsed.data)
    return taken ? { available: false, reason: 'This username is taken.' } : { available: true }
  })

  app.post('/api/auth/register', async (request, reply) => {
    await limiter.consume('register', request.ip)
    const body = registerSchema(deps.now).parse(request.body)
    await deps.turnstile.verify(body.turnstileToken, request.ip)
    await assertPasswordAllowed(deps, request, body.password, body)
    assertNameAllowed(await deps.filter(), body.username)
    if (isDisposableEmail(body.email)) {
      throw new ApiError('VALIDATION_FAILED', {
        fields: [{ field: 'email', message: 'Please use a different email address.' }],
      })
    }
    const taken = new ApiError('VALIDATION_FAILED', {
      fields: [{ field: 'username', message: 'This username is taken.' }],
    })
    if (await isUsernameTaken(deps, body.username)) throw taken

    // O hash é calculado nos dois casos, para o tempo não revelar se o e-mail já tem conta
    const stored = await deps.hasher.hash(body.password)
    const existing = await db.user.findUnique({ where: { email: body.email }, select: { id: true } })
    if (existing) {
      await deps.mailer.send(deps.mails.accountExists(body.email))
      await audit(deps, request, 'REGISTER_EXISTING_EMAIL', { actorId: existing.id })
    } else {
      const now = deps.now()
      let token: string
      try {
        token = await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              username: body.username,
              usernameLower: body.username.toLowerCase(),
              email: body.email,
              ...stored,
              birthDate: new Date(`${body.birthDate}T00:00:00Z`),
              termsVersion: TERMS_VERSION,
              termsAcceptedAt: now,
            },
          })
          return createEmailToken(deps, tx, user.id, 'EMAIL_VERIFY')
        })
      } catch (error) {
        // Corrida entre dois cadastros: o username é público; o e-mail segue em silêncio
        if (!isUniqueViolation(error)) throw error
        if (await isUsernameTaken(deps, body.username)) throw taken
        await deps.mailer.send(deps.mails.accountExists(body.email))
        return reply.code(202).send(ACCEPTED)
      }
      await deps.mailer.send(deps.mails.verifyEmail(body.email, token))
      await audit(deps, request, 'REGISTER', { targetId: body.username })
    }
    return reply.code(202).send(ACCEPTED)
  })

  app.post('/api/auth/verify-email', async (request) => {
    await limiter.consume('verifyToken', request.ip)
    const { token } = verifyEmailSchema.parse(request.body)
    const record = await consumeEmailToken(deps, token, ['EMAIL_VERIFY', 'EMAIL_CHANGE'])
    const now = deps.now()
    if (record.purpose === 'EMAIL_CHANGE' && record.newEmail) {
      try {
        await db.user.update({
          where: { id: record.userId },
          data: { email: record.newEmail, emailVerifiedAt: now },
        })
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('VALIDATION_FAILED', { detail: 'This link is invalid or has expired.' })
        }
        throw error
      }
      // O aviso vai para o endereço antigo, com instruções caso não tenha sido a pessoa
      await deps.mailer.send(deps.mails.emailChanged(record.user.email, maskEmail(record.newEmail)))
      await audit(deps, request, 'EMAIL_CHANGED', { actorId: record.userId })
    } else {
      await db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } })
      await audit(deps, request, 'EMAIL_VERIFIED', { actorId: record.userId })
    }
    return { verified: true }
  })

  app.post('/api/auth/resend-verification', async (request, reply) => {
    const { email } = emailOnlySchema.parse(request.body)
    const allowed =
      (await limiter.tryConsume('emailLinkIp', request.ip)) &&
      (await limiter.tryConsume('emailLinkEmail', `verify:${email}`))
    const user = allowed ? await db.user.findUnique({ where: { email } }) : null
    if (user && !user.emailVerifiedAt) {
      const token = await createEmailToken(deps, db, user.id, 'EMAIL_VERIFY')
      await deps.mailer.send(deps.mails.verifyEmail(email, token))
    }
    return reply.code(202).send(LINK_SENT)
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    await limiter.consume('loginIp', request.ip)
    await limiter.consume('loginMinute', `${request.ip}|${body.email}`)
    await limiter.consume('loginHour', `${request.ip}|${body.email}`)

    const failKey = `loginfail:${body.email}`
    if ((await limiter.store.peek(failKey)) >= CAPTCHA_AFTER_FAILURES) {
      await deps.turnstile.verify(body.turnstileToken, request.ip)
    }

    const user = await db.user.findUnique({
      where: { email: body.email },
      include: { totp: { select: { enabledAt: true } } },
    })
    // Usuário inexistente ou sem senha: verifica contra um hash falso, e a mensagem é a mesma
    const result = await deps.hasher.verify(
      body.password,
      user?.passwordHash && user.pepperVersion !== null
        ? { passwordHash: user.passwordHash, pepperVersion: user.pepperVersion }
        : null,
    )
    if (!user || !result.ok) {
      const { count } = await limiter.store.hit(failKey, HOUR)
      await audit(deps, request, 'LOGIN_FAILED', { actorId: user?.id ?? null })
      if (user && count === ALERT_AFTER_FAILURES) await deps.mailer.send(deps.mails.failedSignIns(user.email))
      throw new ApiError('INVALID_CREDENTIALS')
    }
    await limiter.store.clear(failKey)
    if (result.rehash) await db.user.update({ where: { id: user.id }, data: result.rehash })

    if (user.totp?.enabledAt) return startPendingLogin(deps, reply, user.id)
    await finishLogin(deps, request, reply, user, 'password')
    return { ok: true }
  })

  app.post('/api/auth/login/mfa', async (request, reply) => {
    const body = mfaLoginSchema.parse(request.body)
    const token = request.cookies[COOKIES.mfa]
    const expired = () => {
      clearCookie(reply, COOKIES.mfa)
      return new ApiError('UNAUTHENTICATED', { detail: 'Please sign in again.' })
    }
    if (!token) throw expired()
    const id = hashToken(token)
    const pending = await db.pendingLogin.findUnique({ where: { id }, include: { user: true } })
    if (!pending || pending.expiresAt <= deps.now()) {
      if (pending) await db.pendingLogin.deleteMany({ where: { id } })
      throw expired()
    }
    await limiter.consume('mfaAccount', pending.userId)
    // 5 tentativas por login pendente; depois disso é preciso refazer o login
    const bumped = await db.pendingLogin.updateMany({
      where: { id, attempts: { lt: MAX_MFA_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    if (bumped.count !== 1) {
      await db.pendingLogin.deleteMany({ where: { id } })
      throw expired()
    }

    const method = await verifyMfa(deps, pending.userId, body)
    if (!method) {
      await audit(deps, request, 'MFA_FAILED', { actorId: pending.userId })
      throw new ApiError('INVALID_CREDENTIALS', { detail: 'This code is not valid.' })
    }
    await db.pendingLogin.deleteMany({ where: { id } })
    clearCookie(reply, COOKIES.mfa)
    if (method === 'recovery') await audit(deps, request, 'RECOVERY_CODE_USED', { actorId: pending.userId })
    await finishLogin(deps, request, reply, pending.user, method)
    return { ok: true }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const auth = requireAuth(request)
    await db.session.deleteMany({ where: { id: auth.session.id } })
    await audit(deps, request, 'LOGOUT')
    clearCookie(reply, COOKIES.session)
    issueCsrf(deps, reply, null)
    return { ok: true }
  })

  app.post('/api/auth/forgot-password', async (request, reply) => {
    const body = emailOnlySchema.parse(request.body)
    await deps.turnstile.verify(body.turnstileToken, request.ip)
    const allowed =
      (await limiter.tryConsume('emailLinkIp', request.ip)) &&
      (await limiter.tryConsume('emailLinkEmail', `reset:${body.email}`))
    const user = allowed ? await db.user.findUnique({ where: { email: body.email } }) : null
    if (user) {
      const token = await createEmailToken(deps, db, user.id, 'PASSWORD_RESET')
      await deps.mailer.send(deps.mails.resetPassword(user.email, token))
      await audit(deps, request, 'PASSWORD_RESET_REQUESTED', { actorId: user.id })
    }
    return reply.code(202).send(LINK_SENT)
  })

  app.post('/api/auth/reset-password', async (request) => {
    await limiter.consume('verifyToken', request.ip)
    const body = resetPasswordSchema.parse(request.body)
    // A política vem antes de gastar o token: uma senha recusada não invalida o link
    const peek = await db.emailToken.findUnique({
      where: { tokenHash: hashToken(body.token) },
      include: { user: { select: { username: true, email: true } } },
    })
    await assertPasswordAllowed(deps, request, body.newPassword, peek?.user ?? {})
    const record = await consumeEmailToken(deps, body.token, ['PASSWORD_RESET'])
    const stored = await deps.hasher.hash(body.newPassword)
    await db.$transaction([
      db.user.update({
        where: { id: record.userId },
        // Quem abriu o link provou que o e-mail é dele
        data: { ...stored, emailVerifiedAt: record.user.emailVerifiedAt ?? deps.now() },
      }),
      // Encerra todas as sessões e os outros tokens. O 2FA continua ligado (§5.6)
      db.session.deleteMany({ where: { userId: record.userId } }),
      db.pendingLogin.deleteMany({ where: { userId: record.userId } }),
      db.emailToken.deleteMany({ where: { userId: record.userId, purpose: 'PASSWORD_RESET' } }),
    ])
    await deps.mailer.send(deps.mails.passwordChanged(record.user.email))
    await audit(deps, request, 'PASSWORD_RESET', { actorId: record.userId })
    return { ok: true }
  })

  app.post('/api/auth/reauth', async (request) => {
    const auth = requireAuth(request)
    await limiter.consume('reauth', auth.session.id)
    const body = reauthSchema.parse(request.body)
    let ok: boolean
    if (body.password !== undefined) {
      const user = await currentUser(deps, auth.user.id)
      const result = await deps.hasher.verify(
        body.password,
        user.passwordHash && user.pepperVersion !== null
          ? { passwordHash: user.passwordHash, pepperVersion: user.pepperVersion }
          : null,
      )
      ok = result.ok
    } else {
      ok = (await verifyMfa(deps, auth.user.id, { code: body.code })) !== null
    }
    if (!ok) {
      await audit(deps, request, 'REAUTH_FAILED')
      throw new ApiError('INVALID_CREDENTIALS', {
        detail: body.password !== undefined ? 'Wrong password.' : 'This code is not valid.',
      })
    }
    await db.session.update({ where: { id: auth.session.id }, data: { reauthAt: deps.now() } })
    return { ok: true }
  })

  app.get('/api/me', async (request) => mePayload(requireAuth(request), deps.now()))
}

export { revokeSessions }
