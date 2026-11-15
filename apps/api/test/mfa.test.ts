// 2FA (TOTP), códigos de recuperação e login com Google/Discord (documento 02, §5.7 e §5.8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MINUTE } from '../src/context.ts'
import { decryptSecret, encryptSecret, totpCode, verifyTotp } from '../src/security/totp.ts'
import { zip } from '../src/services/zip.ts'
import {
  Client,
  codeFor,
  enableMfa,
  PASSWORD,
  signUp,
  testContext,
  uniqueName,
  type TestContext,
} from './helpers.ts'

let ctx: TestContext
beforeAll(async () => {
  ctx = await testContext()
})
afterAll(() => ctx.close())

describe('TOTP (RFC 6238)', () => {
  // Vetores do apêndice B da RFC, cortados para 6 dígitos (segredo "12345678901234567890")
  const secret = Buffer.from('12345678901234567890')
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('em %i s o código é %s', (seconds, code) => {
    expect(totpCode(secret, Math.floor(seconds / 30))).toBe(code)
  })

  it('aceita ±1 passo e nunca o mesmo código duas vezes', () => {
    const now = new Date(1234567890 * 1000)
    const step = Math.floor(1234567890 / 30)
    expect(verifyTotp(secret, totpCode(secret, step - 1), now, 0n)).toBe(step - 1)
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, 0n)).toBe(step + 1)
    expect(verifyTotp(secret, totpCode(secret, step + 2), now, 0n)).toBeNull()
    expect(verifyTotp(secret, totpCode(secret, step), now, BigInt(step))).toBeNull()
  })

  it('o segredo é cifrado com AES-256-GCM e não abre com outra chave', () => {
    const key = Buffer.alloc(32, 7)
    const encrypted = encryptSecret(secret, key)
    expect(encrypted.includes(secret)).toBe(false)
    expect(decryptSecret(encrypted, key)).toEqual(secret)
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8))).toThrow()
  })
})

describe('ativar o 2FA', () => {
  it('só liga depois de um código correto, e mostra os 10 códigos de recuperação uma única vez', async () => {
    const user = await signUp(ctx)
    const setup = await user.client.post('/api/me/mfa/totp/setup')
    expect(setup.json().uri).toMatch(/^otpauth:\/\/totp\/quillframe/)
    expect((await user.client.post('/api/me/mfa/totp/enable', { code: '000000' })).statusCode).toBe(401)
    expect((await user.client.get('/api/me')).json().mfaEnabled).toBe(false)

    const { recoveryCodes } = await enableMfa(ctx, user)
    expect(recoveryCodes).toHaveLength(10)
    expect(recoveryCodes[0]).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/)
    expect((await user.client.get('/api/me')).json().mfaEnabled).toBe(true)
    expect(ctx.mailer.last(user.email)?.subject).toBe('Two-factor authentication was turned on')

    // No banco: segredo cifrado e códigos só como hash
    const stored = await ctx.db.recoveryCode.findMany({ where: { userId: user.id } })
    expect(stored.some((row) => recoveryCodes.includes(row.codeHash))).toBe(false)
  })

  it('exige step-up', async () => {
    const user = await signUp(ctx)
    ctx.clock.advance(11 * MINUTE)
    const response = await user.client.post('/api/me/mfa/totp/setup')
    ctx.clock.advance(-11 * MINUTE)
    expect(response.json().code).toBe('REAUTH_REQUIRED')
  })
})

describe('login com 2FA', () => {
  it('senha certa não basta: pede o código, que vale uma vez só', async () => {
    const user = await signUp(ctx)
    const { secret } = await enableMfa(ctx, user)
    const client = new Client(ctx.app)
    const login = await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(login.statusCode).toBe(401)
    expect(login.json().code).toBe('MFA_REQUIRED')
    expect(client.cookies.has('__Host-qf_session')).toBe(false)
    expect(client.cookieAttributes.get('__Host-qf_mfa')).toContain('SameSite=Strict')
    expect((await client.get('/api/me')).statusCode).toBe(401)

    // O código usado na ativação não pode ser reutilizado: espera o próximo passo
    ctx.clock.advance(30_000)
    const code = codeFor(ctx, secret)
    expect((await client.post('/api/auth/login/mfa', { code: '123456' })).statusCode).toBe(401)
    expect((await client.post('/api/auth/login/mfa', { code })).statusCode).toBe(200)
    expect((await client.get('/api/me')).json().username).toBe(user.username)

    // Replay do mesmo código em outro login
    const replay = new Client(ctx.app)
    await replay.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect((await replay.post('/api/auth/login/mfa', { code })).statusCode).toBe(401)
    ctx.clock.advance(-30_000)
  })

  it('5 tentativas por login pendente; depois é preciso refazer o login', async () => {
    const user = await signUp(ctx)
    const { secret } = await enableMfa(ctx, user)
    const client = new Client(ctx.app)
    await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await client.post('/api/auth/login/mfa', { code: '000000' })).json().code).toBe(
        'INVALID_CREDENTIALS',
      )
    }
    ctx.clock.advance(30_000)
    const locked = await client.post('/api/auth/login/mfa', { code: codeFor(ctx, secret) })
    ctx.clock.advance(-30_000)
    expect(locked.json().code).toBe('UNAUTHENTICATED')
  })

  it('código de recuperação entra uma vez só', async () => {
    const user = await signUp(ctx)
    const { recoveryCodes } = await enableMfa(ctx, user)
    const recoveryCode = recoveryCodes[0] as string
    const first = new Client(ctx.app)
    await first.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(
      (await first.post('/api/auth/login/mfa', { recoveryCode: recoveryCode.toLowerCase() })).statusCode,
    ).toBe(200)

    const second = new Client(ctx.app)
    await second.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect((await second.post('/api/auth/login/mfa', { recoveryCode })).statusCode).toBe(401)
  })

  it('o login pendente vence em 5 minutos', async () => {
    const user = await signUp(ctx)
    const { secret } = await enableMfa(ctx, user)
    const client = new Client(ctx.app)
    await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    ctx.clock.advance(6 * MINUTE)
    const late = await client.post('/api/auth/login/mfa', { code: codeFor(ctx, secret) })
    ctx.clock.advance(-6 * MINUTE)
    expect(late.json().code).toBe('UNAUTHENTICATED')
  })

  it('desativar exige um código atual e avisa por e-mail; reset de senha não desliga o 2FA', async () => {
    const user = await signUp(ctx)
    const { secret } = await enableMfa(ctx, user)
    expect((await user.client.delete('/api/me/mfa/totp', { code: '000000' })).statusCode).toBe(401)

    const client = new Client(ctx.app)
    await client.post('/api/auth/forgot-password', { email: user.email, turnstileToken: 't' })
    const token = ctx.mailer.lastToken(user.email)
    const newPassword = 'a brand new sentence for my account'
    await client.post('/api/auth/reset-password', { token, newPassword })
    const login = await client.post('/api/auth/login', { email: user.email, password: newPassword })
    expect(login.json().code).toBe('MFA_REQUIRED')

    ctx.clock.advance(30_000)
    await client.post('/api/auth/login/mfa', { code: codeFor(ctx, secret) })
    ctx.clock.advance(30_000)
    expect((await client.delete('/api/me/mfa/totp', { code: codeFor(ctx, secret) })).statusCode).toBe(200)
    ctx.clock.advance(-60_000)
    expect(ctx.mailer.last(user.email)?.subject).toBe('Two-factor authentication was turned off')
    expect((await client.get('/api/me')).json().mfaEnabled).toBe(false)
  })
})

describe('Google e Discord (OAuth 2.0 com state + PKCE)', () => {
  const env = { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret' }
  let identity: { sub: string; email: string; email_verified: boolean }
  let oauth: TestContext

  beforeAll(async () => {
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token')
        return Response.json({ access_token: 'provider-token' })
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(identity)
      return new Response('', { status: 200 })
    }) as typeof fetch
    oauth = await testContext(env, { fetch: fakeFetch })
  })
  afterAll(() => oauth.close())

  /** Faz o fluxo até o callback e devolve a resposta dele. */
  async function flow(client: Client, tamper?: (state: string) => string) {
    const start = await client.get('/api/auth/oauth/google/start')
    expect(start.statusCode).toBe(302)
    const location = new URL(String(start.headers.location))
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('scope')).toBe('openid email')
    const state = location.searchParams.get('state') as string
    return client.get(`/api/auth/oauth/google/callback?code=abc&state=${tamper ? tamper(state) : state}`)
  }

  it('identidade nova passa pelo onboarding antes de a conta existir', async () => {
    const email = `${uniqueName('g')}@example.com`
    identity = { sub: uniqueName('sub'), email, email_verified: true }
    const client = new Client(oauth.app)
    const callback = await flow(client)
    expect(callback.headers.location).toBe('http://localhost:5173/welcome')
    expect(await oauth.db.user.count({ where: { email } })).toBe(0)

    const username = uniqueName()
    const done = await client.post('/api/auth/oauth/complete', {
      username,
      birthDate: '1995-03-10',
      acceptTerms: true,
    })
    expect(done.statusCode).toBe(200)
    const me = (await client.get('/api/me')).json()
    expect(me).toMatchObject({ username, email, emailVerified: true, hasPassword: false })

    // Na segunda vez a identidade já está vinculada: entra direto
    const again = new Client(oauth.app)
    expect((await flow(again)).headers.location).toBe('http://localhost:5173/')
    expect((await again.get('/api/me')).json().username).toBe(username)
  })

  it('recusa state adulterado e e-mail não verificado no provedor', async () => {
    identity = { sub: uniqueName('sub'), email: `${uniqueName('g')}@example.com`, email_verified: true }
    const tampered = await flow(new Client(oauth.app), (state) => `${state}x`)
    expect(tampered.headers.location).toBe('http://localhost:5173/login?oauth=failed')

    identity = { ...identity, email_verified: false }
    const unverified = await flow(new Client(oauth.app))
    expect(unverified.headers.location).toBe('http://localhost:5173/login?oauth=unverified')
  })

  it('não vincula sozinho a uma conta com o mesmo e-mail', async () => {
    const user = await signUp(oauth, { login: false })
    identity = { sub: uniqueName('sub'), email: user.email, email_verified: true }
    const client = new Client(oauth.app)
    const callback = await flow(client)
    expect(callback.headers.location).toBe('http://localhost:5173/login?oauth=email_exists')
    expect((await client.get('/api/me')).statusCode).toBe(401)
    expect(await oauth.db.oAuthAccount.count({ where: { userId: user.id } })).toBe(0)
  })

  it('provedor não configurado responde 404', async () => {
    expect((await new Client(oauth.app).get('/api/auth/oauth/discord/start')).statusCode).toBe(404)
    expect((await new Client(ctx.app).get('/api/auth/oauth/google/start')).statusCode).toBe(404)
  })
})

describe('ZIP da exportação', () => {
  it('gera um arquivo com assinatura e diretório central válidos', () => {
    const file = zip([{ name: 'a.txt', data: Buffer.from('hello') }], new Date('2026-11-14T10:00:00Z'))
    expect(file.readUInt32LE(0)).toBe(0x04034b50)
    expect(file.readUInt32LE(file.length - 22)).toBe(0x06054b50)
    expect(file.readUInt16LE(file.length - 12)).toBe(1)
    expect(file.includes(Buffer.from('hello'))).toBe(true)
  })
})
