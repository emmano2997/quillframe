// Login com Google e Discord: OAuth 2.0 com state + PKCE (documento 02, §5.7).
// O servidor só chama os hosts fixos de cada provedor; nenhuma URL vem do usuário.
import {
  oauthCompleteSchema,
  OAUTH_PROVIDERS,
  TERMS_VERSION,
  type OAuthProviderName,
} from '@quillframe/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createHash } from 'node:crypto'
import { MINUTE, type Deps } from '../context.ts'
import type { OAuthProvider } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import { audit, clearCookie, COOKIES, requireReauth, setCookie } from '../http/session.ts'
import { hashToken, randomToken, safeEqual } from '../security/tokens.ts'
import { assertNameAllowed, isUniqueViolation, isUsernameTaken } from '../services/accounts.ts'
import { finishLogin, startPendingLogin } from './auth.ts'

const FLOW_MS = 10 * MINUTE

interface ProviderInfo {
  id: OAuthProvider
  authorizeUrl: string
  tokenUrl: string
  userUrl: string
  scope: string
}

const PROVIDERS: Record<OAuthProviderName, ProviderInfo> = {
  google: {
    id: 'GOOGLE',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email',
  },
  discord: {
    id: 'DISCORD',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
  },
}

interface Identity {
  providerUserId: string
  email: string
  emailVerified: boolean
}

interface FlowCookie {
  provider: OAuthProviderName
  state: string
  verifier: string
  /** Vínculo pedido em Options por um usuário logado */
  linkUserId: string | null
}

function encodeFlow(flow: FlowCookie): string {
  return Buffer.from(JSON.stringify(flow)).toString('base64url')
}

function decodeFlow(value: string | undefined): FlowCookie | null {
  if (!value) return null
  try {
    const flow = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FlowCookie>
    if (typeof flow.state !== 'string' || typeof flow.verifier !== 'string') return null
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(flow.provider ?? '')) return null
    return {
      provider: flow.provider as OAuthProviderName,
      state: flow.state,
      verifier: flow.verifier,
      linkUserId: typeof flow.linkUserId === 'string' ? flow.linkUserId : null,
    }
  } catch {
    return null
  }
}

export function registerOAuthRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps

  const credentials = (name: OAuthProviderName) => {
    const clientId = name === 'google' ? config.GOOGLE_CLIENT_ID : config.DISCORD_CLIENT_ID
    const clientSecret = name === 'google' ? config.GOOGLE_CLIENT_SECRET : config.DISCORD_CLIENT_SECRET
    return clientId && clientSecret ? { clientId, clientSecret } : null
  }
  // A URI de retorno é exata e registrada no provedor
  const redirectUri = (name: OAuthProviderName) => `${config.APP_ORIGIN}/api/auth/oauth/${name}/callback`

  const providerOf = (value: string): OAuthProviderName => {
    if (!(OAUTH_PROVIDERS as readonly string[]).includes(value) || !credentials(value as OAuthProviderName)) {
      throw new ApiError('NOT_FOUND')
    }
    return value as OAuthProviderName
  }

  const fail = (reply: FastifyReply, reason: string, to = '/login') => {
    clearCookie(reply, COOKIES.oauth)
    return reply.redirect(`${config.APP_ORIGIN}${to}?oauth=${reason}`)
  }

  async function fetchIdentity(
    name: OAuthProviderName,
    code: string,
    verifier: string,
  ): Promise<Identity | null> {
    const provider = PROVIDERS[name]
    const client = credentials(name)
    if (!client) return null
    const tokenResponse = await deps.fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(name),
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
    if (!tokenResponse.ok) return null
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: unknown }
    if (typeof accessToken !== 'string') return null

    // A identidade vem direto do provedor, por TLS, com o token que ele acabou de emitir para nós
    const userResponse = await deps.fetch(provider.userUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
    if (!userResponse.ok) return null
    const profile = (await userResponse.json()) as Record<string, unknown>
    const id = name === 'google' ? profile['sub'] : profile['id']
    const verified = name === 'google' ? profile['email_verified'] : profile['verified']
    if (typeof id !== 'string' || typeof profile['email'] !== 'string') return null
    return {
      providerUserId: id,
      email: profile['email'].trim().toLowerCase(),
      emailVerified: verified === true || verified === 'true',
    }
  }

  app.get('/api/auth/oauth/:provider/start', async (request, reply) => {
    const name = providerOf((request.params as { provider: string }).provider)
    const link = (request.query as { link?: string }).link === '1'
    // Vincular a uma conta existente exige step-up
    const linkUserId = link ? requireReauth(deps, request).user.id : null

    const state = randomToken()
    const verifier = randomToken()
    setCookie(reply, COOKIES.oauth, encodeFlow({ provider: name, state, verifier, linkUserId }), {
      maxAgeMs: FLOW_MS,
    })
    const client = credentials(name)
    const url = new URL(PROVIDERS[name].authorizeUrl)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: client?.clientId ?? '',
      redirect_uri: redirectUri(name),
      scope: PROVIDERS[name].scope,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString()
    return reply.redirect(url.toString())
  })

  app.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const name = providerOf((request.params as { provider: string }).provider)
    const query = request.query as { code?: string; state?: string }
    const flow = decodeFlow(request.cookies[COOKIES.oauth])
    clearCookie(reply, COOKIES.oauth)
    if (
      !flow ||
      flow.provider !== name ||
      typeof query.state !== 'string' ||
      typeof query.code !== 'string' ||
      !safeEqual(flow.state, query.state)
    ) {
      return fail(reply, 'failed')
    }

    let identity: Identity | null
    try {
      identity = await fetchIdentity(name, query.code, flow.verifier)
    } catch {
      identity = null
    }
    if (!identity) return fail(reply, 'failed')
    // E-mail não verificado no provedor: recusa
    if (!identity.emailVerified) return fail(reply, 'unverified')

    const provider = PROVIDERS[name].id
    const linked = await db.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: identity.providerUserId } },
      include: { user: { include: { totp: { select: { enabledAt: true } } } } },
    })

    // Usuário logado vinculando em Options
    if (flow.linkUserId) {
      const settings = '/settings/security'
      if (request.auth?.user.id !== flow.linkUserId) return fail(reply, 'failed', settings)
      if (linked) return fail(reply, linked.userId === flow.linkUserId ? 'linked' : 'in_use', settings)
      try {
        await db.oAuthAccount.create({
          data: { provider, providerUserId: identity.providerUserId, userId: flow.linkUserId },
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        return fail(reply, 'in_use', settings)
      }
      await audit(deps, request, 'OAUTH_LINKED', { meta: { provider } })
      return reply.redirect(`${config.APP_ORIGIN}${settings}?oauth=linked`)
    }

    // Identidade já vinculada: entra na conta (com 2FA, se estiver ativo)
    if (linked) {
      if (linked.user.totp?.enabledAt) {
        try {
          await startPendingLogin(deps, reply, linked.userId)
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'MFA_REQUIRED') throw error
        }
        return reply.redirect(`${config.APP_ORIGIN}/login?mfa=1`)
      }
      await finishLogin(deps, request, reply, linked.user, name)
      return reply.redirect(`${config.APP_ORIGIN}/`)
    }

    // E-mail igual ao de uma conta existente: não vincula sozinho (ver o porquê no documento 02, §5.7)
    const sameEmail = await db.user.findUnique({ where: { email: identity.email }, select: { id: true } })
    if (sameEmail) return fail(reply, 'email_exists')

    // Identidade nova: a conta só existe depois do onboarding (username, idade e termos)
    const token = randomToken()
    await db.pendingOAuth.create({
      data: {
        id: hashToken(token),
        provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
        expiresAt: new Date(deps.now().getTime() + FLOW_MS),
      },
    })
    setCookie(reply, COOKIES.oauth, token, { maxAgeMs: FLOW_MS })
    return reply.redirect(`${config.APP_ORIGIN}/welcome`)
  })

  app.post('/api/auth/oauth/complete', async (request, reply) => {
    const token = request.cookies[COOKIES.oauth]
    const pending = token ? await db.pendingOAuth.findUnique({ where: { id: hashToken(token) } }) : null
    if (!pending || pending.expiresAt <= deps.now()) {
      clearCookie(reply, COOKIES.oauth)
      throw new ApiError('UNAUTHENTICATED', { detail: 'Please sign in again.' })
    }
    const body = oauthCompleteSchema(deps.now).parse(request.body)
    assertNameAllowed(await deps.filter(), body.username)
    const taken = new ApiError('VALIDATION_FAILED', {
      fields: [{ field: 'username', message: 'This username is taken.' }],
    })
    if (await isUsernameTaken(deps, body.username)) throw taken

    const now = deps.now()
    let user
    try {
      user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username: body.username,
            usernameLower: body.username.toLowerCase(),
            email: pending.email,
            // O provedor já confirmou o e-mail
            emailVerifiedAt: now,
            birthDate: new Date(`${body.birthDate}T00:00:00Z`),
            termsVersion: TERMS_VERSION,
            termsAcceptedAt: now,
          },
        })
        await tx.oAuthAccount.create({
          data: { provider: pending.provider, providerUserId: pending.providerUserId, userId: created.id },
        })
        await tx.pendingOAuth.deleteMany({ where: { id: pending.id } })
        return created
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (await isUsernameTaken(deps, body.username)) throw taken
      throw new ApiError('CONFLICT', {
        detail: 'An account with this email already exists. Sign in instead.',
      })
    }
    clearCookie(reply, COOKIES.oauth)
    await audit(deps, request, 'REGISTER', { actorId: user.id, meta: { provider: pending.provider } })
    await finishLogin(deps, request, reply, user, pending.provider.toLowerCase())
    return { ok: true }
  })
}
