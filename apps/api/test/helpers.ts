import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { randomBytes } from 'node:crypto'
import { buildApp, createDb } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { Deps } from '../src/context.ts'
import type { PrismaClient } from '../src/generated/prisma/client.ts'
import { totpCode, totpStep } from '../src/security/totp.ts'
import { MemoryMailer } from '../src/services/mailer.ts'

/** Segredos fixos só para os testes. O banco é o `quillframe_test` do docker-compose (ou o do CI). */
export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  DATABASE_URL:
    process.env['TEST_DATABASE_URL'] ??
    'postgresql://quillframe:quillframe_dev_only@127.0.0.1:5432/quillframe_test',
  CSRF_SECRET: Buffer.alloc(32, 1).toString('base64url'),
  PASSWORD_PEPPER_V1: Buffer.alloc(32, 2).toString('base64url'),
  PASSWORD_PEPPER_CURRENT: '1',
  MFA_ENC_KEY_V1: Buffer.alloc(32, 3).toString('base64url'),
  MFA_ENC_KEY_CURRENT: '1',
} satisfies NodeJS.ProcessEnv

export function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({ ...TEST_ENV, ...overrides })
}

export const PASSWORD = 'a quiet fox writes books at night'

/** Relógio dos testes: começa na hora real e pode ser adiantado. */
export class Clock {
  offset = 0
  now = () => new Date(Date.now() + this.offset)
  advance(ms: number) {
    this.offset += ms
  }
}

export interface TestContext {
  app: FastifyInstance
  db: PrismaClient
  mailer: MemoryMailer
  clock: Clock
  /** Resposta da API de senhas vazadas: por padrão, nada vazou */
  breached: { sha1Suffixes: string[] }
  /** Chamadas feitas a hosts externos */
  fetched: string[]
  close: () => Promise<void>
}

export async function testContext(
  env: NodeJS.ProcessEnv = {},
  overrides: Partial<Deps> = {},
): Promise<TestContext> {
  const config = testConfig(env)
  const db = createDb(config)
  const mailer = new MemoryMailer()
  const clock = new Clock()
  const breached = { sha1Suffixes: [] as string[] }
  const fetched: string[] = []
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input)
    fetched.push(url)
    if (url.startsWith('https://api.pwnedpasswords.com/')) {
      return new Response(breached.sha1Suffixes.map((suffix) => `${suffix}:3`).join('\n'))
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const app = await buildApp(config, { db, mailer, now: clock.now, fetch: fakeFetch, ...overrides })
  return {
    app,
    db,
    mailer,
    clock,
    breached,
    fetched,
    close: async () => {
      await app.close()
      await db.$disconnect()
    },
  }
}

/** Compatível com os testes da Fase 0. */
export async function testApp(overrides: NodeJS.ProcessEnv = {}) {
  return buildApp(testConfig(overrides))
}

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Um "navegador": guarda os cookies e envia o token CSRF nas mutações, como o front faz. */
export class Client {
  readonly cookies = new Map<string, string>()
  readonly app: FastifyInstance
  userAgent: string
  /** Cada "navegador" tem o seu IP, para os limites por IP não se misturarem entre os testes */
  readonly ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
  /** Os atributos de cada cookie, como o servidor os enviou */
  readonly cookieAttributes = new Map<string, string>()

  constructor(app: FastifyInstance, userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36') {
    this.app = app
    this.userAgent = userAgent
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    if (MUTATIONS.has(method) && !this.cookies.has('__Host-qf_csrf'))
      await this.request('GET', '/api/auth/csrf')
    const csrf = this.cookies.get('__Host-qf_csrf')
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      headers: {
        'user-agent': this.userAgent,
        ...(this.cookies.size > 0
          ? { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {}),
        ...(MUTATIONS.has(method)
          ? { origin: TEST_ENV.APP_ORIGIN, ...(csrf ? { 'x-csrf-token': csrf } : {}) }
          : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    })
    const setCookie = response.headers['set-cookie']
    for (const line of setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]) {
      const [pair = '', ...attributes] = line.split('; ')
      const name = pair.slice(0, pair.indexOf('='))
      const value = pair.slice(pair.indexOf('=') + 1)
      this.cookieAttributes.set(name, attributes.join('; '))
      if (value === '' || /Max-Age=0/i.test(line)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return response
  }

  get = (url: string) => this.request('GET', url)
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {})
  put = (url: string, body?: unknown) => this.request('PUT', url, body ?? {})
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body ?? {})
  delete = (url: string, body?: unknown) => this.request('DELETE', url, body)
}

let counter = 0
/** Nome único por teste: os arquivos de teste rodam em paralelo no mesmo banco. */
export function uniqueName(prefix = 'u'): string {
  counter++
  return `${prefix}${randomBytes(4).toString('hex')}${counter}`.slice(0, 16)
}

export interface TestUser {
  id: string
  username: string
  email: string
  password: string
  client: Client
}

/** Cadastra, confirma o e-mail (a não ser que `verify` seja false) e entra. */
export async function signUp(
  ctx: TestContext,
  options: { username?: string; birthDate?: string; verify?: boolean; login?: boolean } = {},
): Promise<TestUser> {
  const username = options.username ?? uniqueName()
  const email = `${username.toLowerCase()}@example.com`
  const client = new Client(ctx.app)
  const registered = await client.post('/api/auth/register', {
    username,
    email,
    password: PASSWORD,
    birthDate: options.birthDate ?? '1990-05-20',
    acceptTerms: true,
    turnstileToken: 'test',
  })
  if (registered.statusCode !== 202) throw new Error(`cadastro falhou: ${registered.body}`)
  if (options.verify !== false) {
    const token = ctx.mailer.lastToken(email)
    const verified = await client.post('/api/auth/verify-email', { token })
    if (verified.statusCode !== 200) throw new Error(`verificação falhou: ${verified.body}`)
  }
  if (options.login !== false) {
    const login = await client.post('/api/auth/login', { email, password: PASSWORD })
    if (login.statusCode !== 200) throw new Error(`login falhou: ${login.body}`)
  }
  const user = await ctx.db.user.findUniqueOrThrow({ where: { email } })
  return { id: user.id, username, email, password: PASSWORD, client }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32Decode(text: string): Buffer {
  let bits = ''
  for (const ch of text) bits += BASE32.indexOf(ch).toString(2).padStart(5, '0')
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)))
}

/** Liga o 2FA da conta e devolve o segredo e os códigos de recuperação. */
export async function enableMfa(ctx: TestContext, user: TestUser) {
  const setup = await user.client.post('/api/me/mfa/totp/setup')
  if (setup.statusCode !== 200) throw new Error(`setup do 2FA falhou: ${setup.body}`)
  const secret = base32Decode(setup.json<{ secret: string }>().secret)
  const enabled = await user.client.post('/api/me/mfa/totp/enable', { code: codeFor(ctx, secret) })
  if (enabled.statusCode !== 200) throw new Error(`ativação do 2FA falhou: ${enabled.body}`)
  return { secret, recoveryCodes: enabled.json<{ recoveryCodes: string[] }>().recoveryCodes }
}

export function codeFor(ctx: TestContext, secret: Buffer, stepOffset = 0): string {
  return totpCode(secret, totpStep(ctx.clock.now()) + stepOffset)
}

/** Usuário da equipe, já com 2FA (sem ele o painel não abre). */
export async function signUpStaff(ctx: TestContext, role: 'MODERATOR' | 'ADMIN'): Promise<TestUser> {
  const user = await signUp(ctx)
  await ctx.db.user.update({ where: { id: user.id }, data: { role } })
  await enableMfa(ctx, user)
  return user
}

/** Cria um livro assinado direto pela API. */
export async function signedBook(
  user: TestUser,
  options: { visibility?: 'PRIVATE' | 'FRIENDS' | 'PUBLIC'; title?: string; pages?: string[] } = {},
): Promise<string> {
  const created = await user.client.post('/api/books')
  const { id } = created.json<{ id: string }>()
  const pages = options.pages ?? ['Hello §cworld']
  const replaced = await user.client.put(`/api/books/${id}/pages`, { pages, baseVersion: 0 })
  if (replaced.statusCode !== 200) throw new Error(`páginas: ${replaced.body}`)
  const visibility = options.visibility ?? 'PUBLIC'
  const signed = await user.client.post(`/api/books/${id}/sign`, {
    title: options.title ?? 'A Test Book',
    visibility,
    acceptGuidelines: visibility !== 'PRIVATE',
  })
  if (signed.statusCode !== 200) throw new Error(`assinatura falhou: ${signed.body}`)
  return id
}

export async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const sent = await a.client.post('/api/friend-requests', { username: b.username })
  if (sent.statusCode !== 201) throw new Error(`pedido falhou: ${sent.body}`)
  const accepted = await b.client.post(`/api/friend-requests/${a.id}/accept`)
  if (accepted.statusCode !== 200) throw new Error(`aceite falhou: ${accepted.body}`)
}
