// Testes de segurança da Fase 1 (documento 02, §5): cadastro, login, sessões, CSRF, rate limit,
// enumeração, tokens de uso único.
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DAY, HOUR, MINUTE } from '../src/context.ts'
import { Client, PASSWORD, signUp, TEST_ENV, testContext, uniqueName, type TestContext } from './helpers.ts'

let ctx: TestContext
beforeAll(async () => {
  ctx = await testContext()
})
afterAll(() => ctx.close())

const registration = (username = uniqueName()) => ({
  username,
  email: `${username.toLowerCase()}@example.com`,
  password: PASSWORD,
  birthDate: '1990-05-20',
  acceptTerms: true,
  turnstileToken: 'test',
})

describe('cadastro', () => {
  it('cria a conta, envia o e-mail de verificação e responde sempre 202', async () => {
    const client = new Client(ctx.app)
    const body = registration()
    const response = await client.post('/api/auth/register', body)
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ message: 'Check your email to continue.' })
    expect(ctx.mailer.last(body.email)?.subject).toBe('Verify your email')

    const user = await ctx.db.user.findUniqueOrThrow({ where: { email: body.email } })
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user.passwordHash).not.toContain(PASSWORD)
    expect(user.emailVerifiedAt).toBeNull()
  })

  it('não revela que o e-mail já tem conta: mesma resposta, e o dono é avisado', async () => {
    const existing = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    const response = await client.post('/api/auth/register', { ...registration(), email: existing.email })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ message: 'Check your email to continue.' })
    expect(ctx.mailer.last(existing.email)?.subject).toBe(
      'Someone tried to create an account with your email',
    )
    expect(await ctx.db.user.count({ where: { email: existing.email } })).toBe(1)
  })

  it('recusa menores de 16 anos', async () => {
    const year = new Date().getUTCFullYear() - 15
    const response = await new Client(ctx.app).post('/api/auth/register', {
      ...registration(),
      birthDate: `${year}-01-01`,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().fields[0].message).toContain('at least 16')
  })

  it('recusa senha curta, senha vazada e senha feita do username', async () => {
    const client = new Client(ctx.app)
    const short = await client.post('/api/auth/register', { ...registration(), password: 'short password' })
    expect(short.json().code).toBe('VALIDATION_FAILED')

    const sha1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase()
    ctx.breached.sha1Suffixes = [sha1.slice(5)]
    const breached = await client.post('/api/auth/register', registration())
    ctx.breached.sha1Suffixes = []
    expect(breached.statusCode).toBe(422)
    expect(breached.json().code).toBe('BREACHED_PASSWORD')
    // k-anonimato: só os 5 primeiros caracteres do SHA-1 saem do servidor
    expect(ctx.fetched.at(-1)).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`)

    const body = registration('writer_of_books')
    const context = await client.post('/api/auth/register', { ...body, password: 'writer_of_books123' })
    expect(context.json().code).toBe('WEAK_PASSWORD')
  })

  it('recusa usernames reservados, tomados e campos desconhecidos (mass assignment)', async () => {
    const client = new Client(ctx.app)
    const reserved = await client.post('/api/auth/register', registration('admin'))
    expect(reserved.statusCode).toBe(400)

    const existing = await signUp(ctx, { login: false })
    const taken = await client.post('/api/auth/register', registration(existing.username.toUpperCase()))
    expect(taken.json().fields).toEqual([{ field: 'username', message: 'This username is taken.' }])

    const extra = await client.post('/api/auth/register', { ...registration(), role: 'ADMIN' })
    expect(extra.statusCode).toBe(400)
  })

  it('exige o Turnstile', async () => {
    const { turnstileToken: _token, ...body } = registration()
    void _token
    const response = await new Client(ctx.app).post('/api/auth/register', body)
    expect(response.statusCode).toBe(400)
  })
})

describe('verificação de e-mail', () => {
  it('o token vale uma vez só e fica no banco apenas como hash', async () => {
    const user = await signUp(ctx, { verify: false, login: false })
    const token = ctx.mailer.lastToken(user.email) as string
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await ctx.db.emailToken.count({ where: { tokenHash: token } })).toBe(0)

    const client = new Client(ctx.app)
    expect((await client.post('/api/auth/verify-email', { token })).statusCode).toBe(200)
    expect((await client.post('/api/auth/verify-email', { token })).statusCode).toBe(400)
    const saved = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(saved.emailVerifiedAt).not.toBeNull()
  })

  it('token vencido não vale', async () => {
    const user = await signUp(ctx, { verify: false, login: false })
    const token = ctx.mailer.lastToken(user.email)
    ctx.clock.advance(25 * HOUR)
    const response = await new Client(ctx.app).post('/api/auth/verify-email', { token })
    ctx.clock.advance(-25 * HOUR)
    expect(response.statusCode).toBe(400)
  })
})

describe('login e sessão', () => {
  it('entra, recebe cookies __Host- com HttpOnly/Secure/SameSite e lê /api/me', async () => {
    const user = await signUp(ctx)
    const session = user.client.cookieAttributes.get('__Host-qf_session') ?? ''
    expect(session).toContain('HttpOnly')
    expect(session).toContain('Secure')
    expect(session).toContain('SameSite=Lax')
    expect(session).toContain('Path=/')
    expect(session).not.toContain('Domain')
    // O cookie CSRF é legível pelo JavaScript (double-submit)
    expect(user.client.cookieAttributes.get('__Host-qf_csrf')).not.toContain('HttpOnly')

    const me = await user.client.get('/api/me')
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ username: user.username, emailVerified: true, role: 'USER' })
    expect(JSON.stringify(me.json())).not.toContain('argon2')
  })

  it('no banco fica só o hash do token de sessão', async () => {
    const user = await signUp(ctx)
    const token = user.client.cookies.get('__Host-qf_session') as string
    const sessions = await ctx.db.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).not.toBe(token)
  })

  it('a mesma mensagem para e-mail inexistente e senha errada', async () => {
    const user = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    const wrong = await client.post('/api/auth/login', {
      email: user.email,
      password: 'not the right password',
    })
    const missing = await client.post('/api/auth/login', { email: 'nobody@example.com', password: PASSWORD })
    expect(wrong.statusCode).toBe(401)
    expect(missing.statusCode).toBe(401)
    expect(wrong.json().detail).toBe('Invalid email or password.')
    expect(missing.json()).toEqual(wrong.json())
  })

  it('cada login cria uma sessão nova (sem session fixation)', async () => {
    const user = await signUp(ctx)
    const first = user.client.cookies.get('__Host-qf_session')
    await user.client.post('/api/auth/logout')
    await user.client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(user.client.cookies.get('__Host-qf_session')).not.toBe(first)
  })

  it('logout encerra a sessão no servidor', async () => {
    const user = await signUp(ctx)
    const token = user.client.cookies.get('__Host-qf_session') as string
    expect((await user.client.post('/api/auth/logout')).statusCode).toBe(200)
    const replay = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `__Host-qf_session=${token}` },
    })
    expect(replay.statusCode).toBe(401)
  })

  it('a sessão expira com 7 dias sem uso e, no máximo, em 30 dias', async () => {
    const idle = await signUp(ctx)
    ctx.clock.advance(7 * DAY + MINUTE)
    expect((await idle.client.get('/api/me')).statusCode).toBe(401)
    ctx.clock.advance(-(7 * DAY + MINUTE))

    const active = await signUp(ctx)
    for (let day = 0; day < 6; day++) {
      ctx.clock.advance(5 * DAY)
      const response = await active.client.get('/api/me')
      expect(response.statusCode).toBe(day < 5 ? 200 : 401)
    }
    ctx.clock.advance(-30 * DAY)
  })

  it('"Sign out everywhere" encerra as outras sessões', async () => {
    const user = await signUp(ctx)
    const other = new Client(ctx.app, 'Mozilla/5.0 (X11; Linux) Firefox/130.0')
    await other.post('/api/auth/login', { email: user.email, password: PASSWORD })
    const list = await user.client.get('/api/me/sessions')
    expect(list.json().items).toHaveLength(2)
    expect((await user.client.delete('/api/me/sessions')).json()).toEqual({ revoked: 1 })
    expect((await other.get('/api/me')).statusCode).toBe(401)
    expect((await user.client.get('/api/me')).statusCode).toBe(200)
  })

  it('avisa por e-mail quando o login vem de um dispositivo novo', async () => {
    const user = await signUp(ctx)
    const other = new Client(ctx.app, 'Mozilla/5.0 (iPhone) Safari/605')
    await other.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(ctx.mailer.last(user.email)?.subject).toBe('New sign-in to your account')
  })
})

describe('CSRF (documento 02, §5.4)', () => {
  it('recusa mutação sem token, com token errado ou de outra origem', async () => {
    const user = await signUp(ctx)
    const cookie = [...user.client.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    const csrf = user.client.cookies.get('__Host-qf_csrf') as string
    const send = (headers: Record<string, string>) =>
      ctx.app.inject({
        method: 'PATCH',
        url: '/api/me/profile',
        headers: { cookie, ...headers },
        payload: { bio: 'x' },
      })

    expect((await send({})).json().code).toBe('CSRF_FAILED')
    expect((await send({ 'x-csrf-token': 'forged.token' })).json().code).toBe('CSRF_FAILED')
    expect((await send({ 'x-csrf-token': csrf, origin: 'https://evil.example' })).json().code).toBe(
      'CSRF_FAILED',
    )
    expect((await send({ 'x-csrf-token': csrf, 'sec-fetch-site': 'cross-site' })).json().code).toBe(
      'CSRF_FAILED',
    )
    expect((await send({ 'x-csrf-token': csrf, origin: TEST_ENV.APP_ORIGIN })).statusCode).toBe(200)
  })

  it('o token de uma sessão não vale em outra', async () => {
    const a = await signUp(ctx)
    const b = await signUp(ctx)
    const cookie = `__Host-qf_session=${b.client.cookies.get('__Host-qf_session')}; __Host-qf_csrf=${a.client.cookies.get('__Host-qf_csrf')}`
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/me/profile',
      headers: { cookie, 'x-csrf-token': a.client.cookies.get('__Host-qf_csrf') as string },
      payload: { bio: 'x' },
    })
    expect(response.json().code).toBe('CSRF_FAILED')
  })

  it('só aceita JSON: um formulário de outro site não passa', async () => {
    const client = new Client(ctx.app)
    await client.get('/api/auth/csrf')
    const response = await client.request('POST', '/api/auth/login', 'email=a&password=b', {
      'content-type': 'text/plain',
    })
    expect(response.statusCode).toBe(415)
  })
})

describe('força bruta (documento 02, §5.5)', () => {
  it('5 tentativas por minuto por IP + e-mail; depois 429 com Retry-After', async () => {
    const user = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await client.post('/api/auth/login', {
        email: user.email,
        password: 'wrong password here',
      })
      expect(response.statusCode).toBe(401)
    }
    const limited = await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().code).toBe('RATE_LIMITED')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('depois de 5 falhas seguidas na conta, o login pede o Turnstile', async () => {
    const user = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.post('/api/auth/login', { email: user.email, password: 'wrong password here' })
    }
    ctx.clock.advance(2 * MINUTE)
    const captcha = await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(captcha.statusCode).toBe(403)
    expect(captcha.json().code).toBe('CAPTCHA_REQUIRED')
    const solved = await client.post('/api/auth/login', {
      email: user.email,
      password: PASSWORD,
      turnstileToken: 'ok',
    })
    ctx.clock.advance(-2 * MINUTE)
    expect(solved.statusCode).toBe(200)
  })

  it('registra as falhas na auditoria, sem a senha', async () => {
    const user = await signUp(ctx, { login: false })
    await new Client(ctx.app).post('/api/auth/login', { email: user.email, password: 'wrong password here' })
    const events = await ctx.db.auditLog.findMany({ where: { actorId: user.id, event: 'LOGIN_FAILED' } })
    expect(events).toHaveLength(1)
    expect(JSON.stringify(events.map(({ event, meta }) => ({ event, meta })))).not.toContain('wrong password')
  })
})

describe('recuperação de senha (documento 02, §5.6)', () => {
  it('responde igual para e-mail com e sem conta', async () => {
    const user = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    const known = await client.post('/api/auth/forgot-password', { email: user.email, turnstileToken: 't' })
    const unknown = await client.post('/api/auth/forgot-password', {
      email: 'ghost@example.com',
      turnstileToken: 't',
    })
    expect(known.statusCode).toBe(202)
    expect(unknown.statusCode).toBe(202)
    expect(unknown.json()).toEqual(known.json())
    expect(ctx.mailer.last('ghost@example.com')).toBeUndefined()
  })

  it('troca a senha, encerra todas as sessões e o link não vale de novo', async () => {
    const user = await signUp(ctx)
    const client = new Client(ctx.app)
    await client.post('/api/auth/forgot-password', { email: user.email, turnstileToken: 't' })
    const mail = ctx.mailer.last(user.email)
    expect(mail?.subject).toBe('Reset your password')
    // O token vai no fragmento da URL, nunca na query string
    expect(mail?.text).toContain('/reset-password#token=')
    const token = ctx.mailer.lastToken(user.email)

    const newPassword = 'a brand new sentence for my account'
    expect((await client.post('/api/auth/reset-password', { token, newPassword })).statusCode).toBe(200)
    expect(ctx.mailer.last(user.email)?.subject).toBe('Your password was changed')
    expect((await user.client.get('/api/me')).statusCode).toBe(401)
    expect((await client.post('/api/auth/reset-password', { token, newPassword })).statusCode).toBe(400)

    const old = await client.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect(old.statusCode).toBe(401)
    const fresh = await client.post('/api/auth/login', { email: user.email, password: newPassword })
    expect(fresh.statusCode).toBe(200)
  })

  it('o link de reset vence em 30 minutos', async () => {
    const user = await signUp(ctx, { login: false })
    const client = new Client(ctx.app)
    await client.post('/api/auth/forgot-password', { email: user.email, turnstileToken: 't' })
    const token = ctx.mailer.lastToken(user.email)
    ctx.clock.advance(31 * MINUTE)
    const response = await client.post('/api/auth/reset-password', {
      token,
      newPassword: 'a brand new sentence for my account',
    })
    ctx.clock.advance(-31 * MINUTE)
    expect(response.statusCode).toBe(400)
  })
})

describe('step-up e conta (documento 02, §5.8)', () => {
  it('trocar a senha exige confirmação recente e encerra as outras sessões', async () => {
    const user = await signUp(ctx)
    const other = new Client(ctx.app)
    await other.post('/api/auth/login', { email: user.email, password: PASSWORD })
    const body = { currentPassword: PASSWORD, newPassword: 'another long sentence that I like' }

    ctx.clock.advance(11 * MINUTE)
    const stale = await user.client.post('/api/me/password', body)
    expect(stale.statusCode).toBe(403)
    expect(stale.json().code).toBe('REAUTH_REQUIRED')
    expect(
      (await user.client.post('/api/auth/reauth', { password: 'not my password at all' })).statusCode,
    ).toBe(401)
    expect((await user.client.post('/api/auth/reauth', { password: PASSWORD })).statusCode).toBe(200)
    const changed = await user.client.post('/api/me/password', body)
    ctx.clock.advance(-11 * MINUTE)

    expect(changed.statusCode).toBe(200)
    expect((await other.get('/api/me')).statusCode).toBe(401)
    expect((await user.client.get('/api/me')).statusCode).toBe(200)
  })

  it('trocar o e-mail confirma pelo endereço novo e avisa o antigo', async () => {
    const user = await signUp(ctx)
    const newEmail = `${uniqueName('new')}@example.com`
    expect((await user.client.post('/api/me/email', { newEmail })).statusCode).toBe(202)
    const token = ctx.mailer.lastToken(newEmail)
    expect((await user.client.post('/api/auth/verify-email', { token })).statusCode).toBe(200)
    expect(ctx.mailer.last(user.email)?.subject).toBe('Your email was changed')
    expect((await user.client.get('/api/me')).json().email).toBe(newEmail)
  })

  it('perfil: recusa campos desconhecidos e não deixa mudar o papel', async () => {
    const user = await signUp(ctx)
    const response = await user.client.patch('/api/me/profile', { bio: 'hello', role: 'ADMIN' })
    expect(response.statusCode).toBe(400)
    const saved = await ctx.db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(saved.role).toBe('USER')
  })

  it('16 e 17 anos: proteções ligadas e travadas', async () => {
    const year = new Date().getUTCFullYear() - 17
    const teen = await signUp(ctx, { birthDate: `${year}-01-01` })
    const me = (await teen.client.get('/api/me')).json()
    expect(me.minor).toBe(true)
    expect(me.privacy).toEqual({
      searchable: false,
      showFavorites: false,
      friendRequestPolicy: 'FRIENDS_OF_FRIENDS',
      locked: true,
    })
    expect((await teen.client.patch('/api/me/privacy', { searchable: true })).statusCode).toBe(403)
  })

  it('excluir a conta: 30 dias para desistir, e o perfil some na hora', async () => {
    const user = await signUp(ctx)
    const wrong = await user.client.delete('/api/me', { username: 'someone_else' })
    expect(wrong.statusCode).toBe(400)
    expect((await user.client.delete('/api/me', { username: user.username })).statusCode).toBe(200)
    expect((await new Client(ctx.app).get(`/api/users/${user.username}`)).statusCode).toBe(404)

    const back = new Client(ctx.app)
    await back.post('/api/auth/login', { email: user.email, password: PASSWORD })
    expect((await back.get('/api/me')).json().status).toBe('PENDING_DELETION')
    expect((await back.post('/api/books')).json().code).toBe('ACCOUNT_SUSPENDED')
    expect((await back.post('/api/me/restore')).json().status).toBe('ACTIVE')
  })

  it('exporta os dados em ZIP, uma vez por dia', async () => {
    const user = await signUp(ctx)
    const first = await user.client.get('/api/me/export')
    expect(first.statusCode).toBe(200)
    expect(first.headers['content-type']).toBe('application/zip')
    expect(first.rawPayload.subarray(0, 2).toString()).toBe('PK')
    expect(first.rawPayload.includes(Buffer.from('profile.json'))).toBe(true)
    expect((await user.client.get('/api/me/export')).statusCode).toBe(429)
  })
})

describe('sistema', () => {
  it('publica o security.txt', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/.well-known/security.txt' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Contact: ')
    expect(response.body).toContain('Expires: ')
  })

  it('rotas de moderação não existem para quem não é da equipe', async () => {
    const user = await signUp(ctx)
    expect((await user.client.get('/api/mod/queue')).statusCode).toBe(404)
    expect((await new Client(ctx.app).get('/api/admin/audit')).statusCode).toBe(404)
  })
})
