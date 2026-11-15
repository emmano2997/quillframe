// Conta: perfil, privacidade, senha, e-mail, sessões, 2FA, exportação e exclusão
// (documento 02, §4.2 "Conta", §5.8 e §7.4–7.5).
import {
  changeEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
  exportFileName,
  OAUTH_PROVIDERS,
  privacySchema,
  profileSchema,
  serializeStendhal,
  stendhalIssues,
  totpCodeBodySchema,
} from '@quillframe/shared'
import type { FastifyInstance } from 'fastify'
import { DAY, type Deps } from '../context.ts'
import { ApiError } from '../http/problem.ts'
import {
  audit,
  clearCookie,
  COOKIES,
  describeDevice,
  maskIp,
  requireActive,
  requireAuth,
  requireReauth,
  revokeSessions,
  startSession,
} from '../http/session.ts'
import { hashToken } from '../security/tokens.ts'
import {
  base32Encode,
  canonicalRecoveryCode,
  decryptSecret,
  encryptSecret,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from '../security/totp.ts'
import {
  assertNameAllowed,
  assertPasswordAllowed,
  createEmailToken,
  mePayload,
  privacyOf,
  verifyMfa,
} from '../services/accounts.ts'
import { zip, type ZipEntry } from '../services/zip.ts'

/** Tamanho do id público de uma sessão: um prefixo do hash, que não serve para se autenticar. */
const SESSION_PUBLIC_ID = 16
export const DELETION_GRACE_MS = 30 * DAY

/** Eventos mostrados em "Recent Security Activity". */
const SECURITY_EVENTS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'PASSWORD_RESET_REQUESTED',
  'EMAIL_CHANGED',
  'EMAIL_VERIFIED',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'MFA_FAILED',
  'RECOVERY_CODE_USED',
  'RECOVERY_CODES_REGENERATED',
  'SESSIONS_REVOKED',
  'OAUTH_LINKED',
  'OAUTH_UNLINKED',
  'DATA_EXPORTED',
  'DELETION_REQUESTED',
  'DELETION_CANCELLED',
]

export function registerAccountRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps

  app.patch('/api/me/profile', async (request) => {
    const auth = requireActive(request)
    const body = profileSchema.parse(request.body)
    if (body.bio) assertNameAllowed(await deps.filter(), body.bio)
    const user = await db.user.update({
      where: { id: auth.user.id },
      data: {
        ...(body.bio !== undefined ? { bio: body.bio === '' ? null : body.bio } : {}),
        ...(body.avatarId !== undefined ? { avatarId: body.avatarId } : {}),
      },
    })
    return mePayload({ ...auth, user }, deps.now())
  })

  app.patch('/api/me/privacy', async (request) => {
    const auth = requireActive(request)
    const body = privacySchema.parse(request.body)
    // 16–17 anos: as proteções ficam travadas até os 18 (§7.3)
    if (auth.minor) {
      throw new ApiError('FORBIDDEN', { detail: 'These settings are locked until you turn 18.' })
    }
    const user = await db.user.update({
      where: { id: auth.user.id },
      data: {
        ...(body.searchable !== undefined ? { searchable: body.searchable } : {}),
        ...(body.showFavorites !== undefined ? { showFavorites: body.showFavorites } : {}),
        ...(body.friendRequestPolicy !== undefined ? { friendRequestPolicy: body.friendRequestPolicy } : {}),
      },
    })
    return privacyOf(user, auth.minor)
  })

  app.post('/api/me/password', async (request, reply) => {
    const auth = requireReauth(deps, request)
    const body = changePasswordSchema.parse(request.body)
    const { user } = auth
    if (!user.passwordHash || user.pepperVersion === null) {
      throw new ApiError('FORBIDDEN', {
        detail: 'This account has no password yet. Use "Forgot password?" to create one.',
      })
    }
    const current = await deps.hasher.verify(body.currentPassword, {
      passwordHash: user.passwordHash,
      pepperVersion: user.pepperVersion,
    })
    if (!current.ok) throw new ApiError('INVALID_CREDENTIALS', { detail: 'Wrong password.' })
    await assertPasswordAllowed(deps, request, body.newPassword, user)

    const stored = await deps.hasher.hash(body.newPassword)
    await db.user.update({ where: { id: user.id }, data: stored })
    // Encerra todas as sessões e abre uma nova só neste dispositivo
    await revokeSessions(deps, user.id)
    await startSession(deps, request, reply, user.id)
    await deps.mailer.send(deps.mails.passwordChanged(user.email))
    await audit(deps, request, 'PASSWORD_CHANGED')
    return { ok: true }
  })

  app.post('/api/me/email', async (request, reply) => {
    const auth = requireReauth(deps, request)
    const { newEmail } = changeEmailSchema.parse(request.body)
    if (newEmail === auth.user.email) {
      throw new ApiError('VALIDATION_FAILED', {
        fields: [{ field: 'newEmail', message: 'This is already your email.' }],
      })
    }
    const inUse = await db.user.findUnique({ where: { email: newEmail }, select: { id: true } })
    if (inUse) {
      // Não revela que o endereço tem conta: quem recebe o aviso é o dono dele
      await deps.mailer.send(deps.mails.accountExists(newEmail))
    } else {
      const token = await createEmailToken(deps, db, auth.user.id, 'EMAIL_CHANGE', newEmail)
      await deps.mailer.send(deps.mails.confirmNewEmail(newEmail, token))
    }
    await audit(deps, request, 'EMAIL_CHANGE_REQUESTED')
    return reply.code(202).send({ message: 'Check your new email to confirm the change.' })
  })

  // --- Sessões -------------------------------------------------------------------------------

  app.get('/api/me/sessions', async (request) => {
    const auth = requireAuth(request)
    const sessions = await db.session.findMany({
      where: { userId: auth.user.id, expiresAt: { gt: deps.now() } },
      orderBy: { lastSeenAt: 'desc' },
    })
    return {
      items: sessions.map((session) => ({
        id: session.id.slice(0, SESSION_PUBLIC_ID),
        current: session.id === auth.session.id,
        device: describeDevice(session.userAgent),
        ip: maskIp(session.ip),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      })),
    }
  })

  app.delete('/api/me/sessions/:id', async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (!/^[A-Za-z0-9_-]{16}$/.test(id)) throw new ApiError('NOT_FOUND')
    const result = await db.session.deleteMany({ where: { userId: auth.user.id, id: { startsWith: id } } })
    if (result.count === 0) throw new ApiError('NOT_FOUND')
    await audit(deps, request, 'SESSIONS_REVOKED', { meta: { count: result.count } })
    if (auth.session.id.startsWith(id)) clearCookie(reply, COOKIES.session)
    return { ok: true }
  })

  // "Sign out everywhere": encerra as outras sessões
  app.delete('/api/me/sessions', async (request) => {
    const auth = requireAuth(request)
    const count = await revokeSessions(deps, auth.user.id, auth.session.id)
    await audit(deps, request, 'SESSIONS_REVOKED', { meta: { count } })
    return { revoked: count }
  })

  // --- 2FA -----------------------------------------------------------------------------------

  app.post('/api/me/mfa/totp/setup', async (request) => {
    const auth = requireReauth(deps, request)
    if (auth.mfaEnabled)
      throw new ApiError('CONFLICT', { detail: 'Two-factor authentication is already on.' })
    const secret = newTotpSecret()
    const keyVersion = deps.config.mfaKeyCurrent
    const key = deps.config.mfaKeys.get(keyVersion)
    if (!key) throw new ApiError('INTERNAL')
    const data = {
      secretEnc: new Uint8Array(encryptSecret(secret, key)),
      keyVersion,
      lastUsedStep: 0n,
      enabledAt: null,
    }
    await db.totpCredential.upsert({
      where: { userId: auth.user.id },
      create: { userId: auth.user.id, ...data },
      update: data,
    })
    // A URI e o segredo saem do servidor uma única vez; o front desenha o QR localmente
    return { uri: otpauthUri(secret, auth.user.email), secret: base32Encode(secret) }
  })

  app.post('/api/me/mfa/totp/enable', async (request) => {
    const auth = requireReauth(deps, request)
    const { code } = totpCodeBodySchema.parse(request.body)
    const credential = await db.totpCredential.findUnique({ where: { userId: auth.user.id } })
    const key = credential ? deps.config.mfaKeys.get(credential.keyVersion) : undefined
    if (!credential || credential.enabledAt || !key) {
      throw new ApiError('CONFLICT', { detail: 'Start the two-factor setup again.' })
    }
    const step = verifyTotp(
      decryptSecret(credential.secretEnc, key),
      code,
      deps.now(),
      credential.lastUsedStep,
    )
    if (step === null) throw new ApiError('INVALID_CREDENTIALS', { detail: 'This code is not valid.' })

    const codes = newRecoveryCodes()
    await db.$transaction([
      db.totpCredential.update({
        where: { userId: auth.user.id },
        data: { enabledAt: deps.now(), lastUsedStep: step },
      }),
      db.recoveryCode.deleteMany({ where: { userId: auth.user.id } }),
      db.recoveryCode.createMany({
        data: codes.map((value) => ({
          userId: auth.user.id,
          codeHash: hashToken(canonicalRecoveryCode(value)),
        })),
      }),
    ])
    await revokeSessions(deps, auth.user.id, auth.session.id)
    await deps.mailer.send(deps.mails.mfaChanged(auth.user.email, true))
    await audit(deps, request, 'MFA_ENABLED')
    // Os códigos aparecem uma única vez
    return { recoveryCodes: codes }
  })

  app.delete('/api/me/mfa/totp', async (request) => {
    const auth = requireReauth(deps, request)
    const { code } = totpCodeBodySchema.parse(request.body)
    if (!auth.mfaEnabled)
      throw new ApiError('CONFLICT', { detail: 'Two-factor authentication is already off.' })
    if (!(await verifyMfa(deps, auth.user.id, { code }))) {
      throw new ApiError('INVALID_CREDENTIALS', { detail: 'This code is not valid.' })
    }
    await db.$transaction([
      db.totpCredential.deleteMany({ where: { userId: auth.user.id } }),
      db.recoveryCode.deleteMany({ where: { userId: auth.user.id } }),
    ])
    await revokeSessions(deps, auth.user.id, auth.session.id)
    await deps.mailer.send(deps.mails.mfaChanged(auth.user.email, false))
    await audit(deps, request, 'MFA_DISABLED')
    return { ok: true }
  })

  app.post('/api/me/mfa/recovery-codes', async (request) => {
    const auth = requireReauth(deps, request)
    if (!auth.mfaEnabled)
      throw new ApiError('CONFLICT', { detail: 'Turn on two-factor authentication first.' })
    const codes = newRecoveryCodes()
    await db.$transaction([
      db.recoveryCode.deleteMany({ where: { userId: auth.user.id } }),
      db.recoveryCode.createMany({
        data: codes.map((value) => ({
          userId: auth.user.id,
          codeHash: hashToken(canonicalRecoveryCode(value)),
        })),
      }),
    ])
    await audit(deps, request, 'RECOVERY_CODES_REGENERATED')
    return { recoveryCodes: codes }
  })

  // --- Google e Discord ----------------------------------------------------------------------

  app.get('/api/me/oauth', async (request) => {
    const auth = requireAuth(request)
    const linked = await db.oAuthAccount.findMany({ where: { userId: auth.user.id } })
    return {
      items: OAUTH_PROVIDERS.map((provider) => {
        const account = linked.find((item) => item.provider.toLowerCase() === provider)
        const configured = Boolean(
          deps.config[provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'DISCORD_CLIENT_ID'],
        )
        return { provider, configured, linked: Boolean(account), linkedAt: account?.createdAt ?? null }
      }),
    }
  })

  app.delete('/api/me/oauth/:provider', async (request) => {
    const auth = requireReauth(deps, request)
    const name = (request.params as { provider: string }).provider
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(name)) throw new ApiError('NOT_FOUND')
    const provider = name === 'google' ? 'GOOGLE' : 'DISCORD'
    const linked = await db.oAuthAccount.findMany({ where: { userId: auth.user.id } })
    if (!linked.some((item) => item.provider === provider)) throw new ApiError('NOT_FOUND')
    // Só dá para desvincular se sobrar outro jeito de entrar (§5.7)
    if (!auth.user.passwordHash && linked.length <= 1) {
      throw new ApiError('FORBIDDEN', {
        detail: 'Create a password first, or you would not be able to sign in.',
      })
    }
    await db.oAuthAccount.deleteMany({ where: { userId: auth.user.id, provider } })
    await audit(deps, request, 'OAUTH_UNLINKED', { meta: { provider } })
    return { ok: true }
  })

  app.get('/api/me/security-events', async (request) => {
    const auth = requireAuth(request)
    const events = await db.auditLog.findMany({
      where: { actorId: auth.user.id, event: { in: SECURITY_EVENTS } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return {
      items: events.map((event) => ({
        id: String(event.id),
        event: event.event,
        device: describeDevice(event.userAgent),
        ip: maskIp(event.ip),
        createdAt: event.createdAt,
      })),
    }
  })

  // --- Dados (LGPD, art. 18) -----------------------------------------------------------------

  app.get('/api/me/export', async (request, reply) => {
    const auth = requireReauth(deps, request)
    await deps.limiter.consume('dataExport', auth.user.id)
    const userId = auth.user.id
    const [books, likes, favorites, comments, copies, friendships, blocks, events, reports] =
      await Promise.all([
        db.book.findMany({
          where: { ownerId: userId, deletedAt: null },
          include: { pages: { orderBy: { index: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        }),
        db.like.findMany({ where: { userId }, select: { bookId: true, createdAt: true } }),
        db.favorite.findMany({ where: { userId }, select: { bookId: true, createdAt: true } }),
        db.comment.findMany({
          where: { authorId: userId },
          select: { bookId: true, presetId: true, createdAt: true },
        }),
        db.bookCopy.findMany({
          where: { ownerId: userId },
          select: { sourceBookId: true, generation: true, createdAt: true },
        }),
        db.friendship.findMany({
          where: { OR: [{ userAId: userId }, { userBId: userId }] },
          include: { userA: { select: { username: true } }, userB: { select: { username: true } } },
        }),
        db.block.findMany({
          where: { blockerId: userId },
          include: { blocked: { select: { username: true } } },
        }),
        db.auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: 'desc' }, take: 1000 }),
        db.report.findMany({ where: { reporterId: userId } }),
      ])
    const { user } = auth
    const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2), 'utf8')
    const entries: ZipEntry[] = [
      {
        name: 'profile.json',
        data: json({
          username: user.username,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt,
          birthDate: user.birthDate.toISOString().slice(0, 10),
          bio: user.bio,
          avatarId: user.avatarId,
          role: user.role,
          status: user.status,
          privacy: privacyOf(user, auth.minor),
          termsVersion: user.termsVersion,
          termsAcceptedAt: user.termsAcceptedAt,
          createdAt: user.createdAt,
        }),
      },
      {
        name: 'books.json',
        data: json(
          books.map((book) => ({
            id: book.id,
            title: book.title,
            status: book.status,
            visibility: book.visibility,
            createdAt: book.createdAt,
            signedAt: book.signedAt,
            pages: book.pages.map((page) => page.content),
          })),
        ),
      },
      { name: 'likes.json', data: json(likes) },
      { name: 'favorites.json', data: json(favorites) },
      { name: 'comments.json', data: json(comments) },
      { name: 'copies.json', data: json(copies) },
      {
        name: 'friends.json',
        data: json(
          friendships.map((item) => ({
            username: item.userAId === userId ? item.userB.username : item.userA.username,
            status: item.status,
            requestedByMe: item.requestedBy === userId,
            createdAt: item.createdAt,
          })),
        ),
      },
      {
        name: 'blocked.json',
        data: json(blocks.map((item) => ({ username: item.blocked.username, createdAt: item.createdAt }))),
      },
      {
        name: 'reports.json',
        data: json(
          reports.map(({ targetType, targetId, reason, details, status, createdAt }) => ({
            targetType,
            targetId,
            reason,
            details,
            status,
            createdAt,
          })),
        ),
      },
      {
        name: 'security-events.json',
        data: json(
          events.map(({ event, ip, userAgent, createdAt }) => ({ event, ip, userAgent, createdAt })),
        ),
      },
    ]
    books.forEach((book, index) => {
      const stendhal = {
        title: book.title,
        author: user.username,
        pages: book.pages.map((page) => page.content),
      }
      // O formato não guarda uma linha que começa com "#- ": esse livro fica só no JSON
      if (stendhalIssues(stendhal).length > 0) return
      const name = `books/${String(index + 1).padStart(3, '0')}-${exportFileName(book.title)}`
      entries.push({ name, data: Buffer.from(serializeStendhal(stendhal), 'utf8') })
    })

    await db.user.update({ where: { id: userId }, data: { lastDataExportAt: deps.now() } })
    await audit(deps, request, 'DATA_EXPORTED')
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="quillframe-data.zip"')
      .send(zip(entries, deps.now()))
  })

  app.delete('/api/me', async (request, reply) => {
    const auth = requireReauth(deps, request)
    const body = deleteAccountSchema.parse(request.body)
    if (body.username !== auth.user.username) {
      throw new ApiError('VALIDATION_FAILED', {
        fields: [{ field: 'username', message: 'Type your username to confirm.' }],
      })
    }
    // 30 dias para desistir; livros e perfil somem na hora (o filtro de visibilidade exige conta ativa)
    await db.user.update({
      where: { id: auth.user.id },
      data: { status: 'PENDING_DELETION', deletionRequestedAt: deps.now() },
    })
    await revokeSessions(deps, auth.user.id)
    await audit(deps, request, 'DELETION_REQUESTED')
    clearCookie(reply, COOKIES.session)
    return { ok: true }
  })

  app.post('/api/me/restore', async (request) => {
    const auth = requireAuth(request)
    const { user } = auth
    const within =
      user.deletionRequestedAt !== null &&
      deps.now().getTime() - user.deletionRequestedAt.getTime() < DELETION_GRACE_MS
    if (user.status !== 'PENDING_DELETION' || !within) throw new ApiError('NOT_FOUND')
    const restored = await db.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', deletionRequestedAt: null },
    })
    await audit(deps, request, 'DELETION_CANCELLED')
    return mePayload({ ...auth, user: restored }, deps.now())
  })
}
