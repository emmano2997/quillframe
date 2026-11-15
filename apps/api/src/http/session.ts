// Sessões, cookies e CSRF (documento 02, §5.3 e §5.4).
import { isMinor } from '@quillframe/shared'
import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHmac } from 'node:crypto'
import { DAY, MINUTE, type Deps } from '../context.ts'
import type { Session, User } from '../generated/prisma/client.ts'
import { hashToken, randomToken, safeEqual } from '../security/tokens.ts'
import { ApiError } from './problem.ts'

export const COOKIES = {
  session: '__Host-qf_session',
  csrf: '__Host-qf_csrf',
  mfa: '__Host-qf_mfa',
  oauth: '__Host-qf_oauth',
} as const

export const SESSION_IDLE_MS = 7 * DAY
export const SESSION_MAX_MS = 30 * DAY
export const REAUTH_WINDOW_MS = 10 * MINUTE
const LAST_SEEN_EVERY_MS = 5 * MINUTE

export interface Auth {
  session: Session
  user: User
  mfaEnabled: boolean
  /** 16 ou 17 anos: proteções ligadas (§7.3) */
  minor: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null
    /** Hash do token de sessão válido desta requisição (liga o token CSRF à sessão) */
    sessionId: string | null
  }
}

// O prefixo __Host- exige Secure, Path=/ e nenhum Domain. Os navegadores aceitam Secure em localhost.
const base = { path: '/', secure: true } as const

export function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  options: { maxAgeMs: number; httpOnly?: boolean; sameSite?: 'lax' | 'strict' },
): void {
  void reply.setCookie(name, value, {
    ...base,
    httpOnly: options.httpOnly ?? true,
    sameSite: options.sameSite ?? 'lax',
    maxAge: Math.floor(options.maxAgeMs / 1000),
  })
}

export function clearCookie(reply: FastifyReply, name: string): void {
  void reply.clearCookie(name, { ...base })
}

function csrfSignature(secret: Buffer, nonce: string, binding: string): string {
  return createHmac('sha256', secret).update(`${nonce}.${binding}`).digest('base64url')
}

/**
 * Token double-submit assinado: `nonce.HMAC(nonce + sessão)`. Antes do login a "sessão" é `anon`,
 * e o token de pré-sessão protege o próprio login e o cadastro.
 */
export function issueCsrf(deps: Deps, reply: FastifyReply, sessionId: string | null): string {
  const nonce = randomToken()
  const token = `${nonce}.${csrfSignature(deps.config.CSRF_SECRET, nonce, sessionId ?? 'anon')}`
  setCookie(reply, COOKIES.csrf, token, { maxAgeMs: SESSION_MAX_MS, httpOnly: false })
  return token
}

function checkCsrf(deps: Deps, request: FastifyRequest): void {
  // Fetch Metadata e Origin: mutações vindas de outro site são recusadas
  const origin = request.headers.origin
  if (origin !== undefined && origin !== deps.config.APP_ORIGIN) throw new ApiError('CSRF_FAILED')
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApiError('CSRF_FAILED')

  const header = request.headers['x-csrf-token']
  const fromCookie = request.cookies[COOKIES.csrf]
  if (typeof header !== 'string' || !fromCookie || !safeEqual(header, fromCookie)) {
    throw new ApiError('CSRF_FAILED')
  }
  const [nonce, signature] = header.split('.')
  if (!nonce || !signature) throw new ApiError('CSRF_FAILED')
  const expected = csrfSignature(deps.config.CSRF_SECRET, nonce, request.sessionId ?? 'anon')
  if (!safeEqual(signature, expected)) throw new ApiError('CSRF_FAILED')
}

/** Sessão nova a cada login, nunca reaproveitando um id anterior (evita session fixation). */
export async function startSession(
  deps: Deps,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const token = randomToken()
  const id = hashToken(token)
  const now = deps.now()
  await deps.db.session.create({
    data: {
      id,
      userId,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      expiresAt: new Date(now.getTime() + SESSION_MAX_MS),
      // Quem acabou de entrar acabou de provar quem é
      reauthAt: now,
      ip: request.ip,
      userAgent: userAgentOf(request),
    },
  })
  setCookie(reply, COOKIES.session, token, { maxAgeMs: SESSION_MAX_MS })
  issueCsrf(deps, reply, id)
}

export function userAgentOf(request: FastifyRequest): string | null {
  const value = request.headers['user-agent']
  return typeof value === 'string' ? value.slice(0, 256) : null
}

async function loadAuth(deps: Deps, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[COOKIES.session]
  if (!token) return
  const id = hashToken(token)
  const session = await deps.db.session.findUnique({
    where: { id },
    include: { user: { include: { totp: { select: { enabledAt: true } } } } },
  })
  const now = deps.now()
  if (!session || session.expiresAt <= now || session.idleExpiresAt <= now) {
    if (session) await deps.db.session.deleteMany({ where: { id } })
    clearCookie(reply, COOKIES.session)
    return
  }

  let { user } = session
  // A suspensão acaba sozinha na data marcada
  if (user.status === 'SUSPENDED' && user.suspendedUntil && user.suspendedUntil <= now) {
    user = {
      ...user,
      ...(await deps.db.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', suspendedUntil: null },
      })),
    }
  }

  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
    const idleExpiresAt = new Date(Math.min(now.getTime() + SESSION_IDLE_MS, session.expiresAt.getTime()))
    await deps.db.session.updateMany({ where: { id }, data: { lastSeenAt: now, idleExpiresAt } })
  }

  const { user: _user, ...sessionOnly } = session
  void _user
  const { totp, ...userOnly } = user
  request.sessionId = id
  request.auth = {
    session: sessionOnly,
    user: userOnly,
    mfaEnabled: Boolean(totp?.enabledAt),
    minor: isMinor(user.birthDate, now),
  }
}

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function registerSession(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(cookie)
  app.decorateRequest('auth', null)
  app.decorateRequest('sessionId', null)

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    await deps.limiter.consume('api', request.ip)
    await loadAuth(deps, request, reply)
    if (MUTATIONS.has(request.method)) checkCsrf(deps, request)
  })
}

/** Qualquer sessão válida, mesmo de conta suspensa. */
export function requireAuth(request: FastifyRequest): Auth {
  if (!request.auth) throw new ApiError('UNAUTHENTICATED')
  return request.auth
}

/** Conta ativa: suspensas, banidas e em exclusão só leem os próprios dados (§6.6). */
export function requireActive(request: FastifyRequest): Auth {
  const auth = requireAuth(request)
  const { user } = auth
  if (user.status === 'ACTIVE') return auth
  const detail =
    user.status === 'SUSPENDED' && user.suspendedUntil
      ? `Your account is suspended until ${user.suspendedUntil.toISOString().slice(0, 10)}.`
      : user.status === 'BANNED'
        ? 'Your account has been banned.'
        : 'Your account is scheduled for deletion.'
  throw new ApiError('ACCOUNT_SUSPENDED', {
    detail,
    extra: { accountStatus: user.status, suspendedUntil: user.suspendedUntil?.toISOString() ?? null },
  })
}

/** Publicar e interagir exigem conta ativa com e-mail verificado (§5.5). */
export function requireVerified(request: FastifyRequest): Auth {
  const auth = requireActive(request)
  if (!auth.user.emailVerifiedAt) throw new ApiError('EMAIL_NOT_VERIFIED')
  return auth
}

/** Step-up: senha ou código 2FA confirmados nos últimos 10 minutos (§5.8). */
export function requireReauth(deps: Deps, request: FastifyRequest): Auth {
  const auth = requireAuth(request)
  const at = auth.session.reauthAt
  if (!at || deps.now().getTime() - at.getTime() > REAUTH_WINDOW_MS) throw new ApiError('REAUTH_REQUIRED')
  return auth
}

/**
 * Moderadores e admins. Para os outros a rota "não existe" (404). O papel vem sempre do banco, pela
 * sessão; e sem 2FA o painel não abre (§5.8).
 */
export function requireStaff(request: FastifyRequest, role: 'MODERATOR' | 'ADMIN'): Auth {
  const auth = request.auth
  const allowed =
    auth?.user.status === 'ACTIVE' &&
    (auth.user.role === 'ADMIN' || (role === 'MODERATOR' && auth.user.role === 'MODERATOR'))
  if (!auth || !allowed) throw new ApiError('NOT_FOUND')
  if (!auth.mfaEnabled) throw new ApiError('MFA_SETUP_REQUIRED')
  return auth
}

/** Registro de auditoria (§5.15). Nunca recebe senhas, tokens ou códigos. */
export async function audit(
  deps: Deps,
  request: FastifyRequest | null,
  event: string,
  data: {
    actorId?: string | null
    targetId?: string | null
    meta?: Record<string, string | number | boolean | null>
  } = {},
): Promise<void> {
  await deps.db.auditLog.create({
    data: {
      event,
      actorId: data.actorId ?? request?.auth?.user.id ?? null,
      targetId: data.targetId ?? null,
      ip: request?.ip ?? null,
      userAgent: request ? userAgentOf(request) : null,
      ...(data.meta ? { meta: data.meta } : {}),
    },
  })
}

/** Encerra sessões do usuário; `except` mantém a atual. */
export async function revokeSessions(deps: Deps, userId: string, except?: string | null): Promise<number> {
  const result = await deps.db.session.deleteMany({
    where: { userId, ...(except ? { id: { not: except } } : {}) },
  })
  return result.count
}

/** "Chrome on Windows", lido do user agent sem biblioteca: é só um rótulo para a lista de dispositivos. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser'
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown system'
  return `${browser} on ${system}`
}

/** IP parcialmente mascarado para a lista de dispositivos. */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`
  const parts = ip.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.•.•` : null
}
