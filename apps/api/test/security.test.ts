import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkBreachedPassword, containsContextWord, type Fetch } from '../src/security/breached-passwords.ts'
import { PasswordHasher } from '../src/security/password.ts'
import { hashToken, randomToken, safeEqual } from '../src/security/tokens.ts'

const pepperV1 = Buffer.alloc(32, 2)
const pepperV2 = Buffer.alloc(32, 3)
const hasher = new PasswordHasher(new Map([[1, pepperV1]]), 1)

describe('PasswordHasher (documento 02, §5.2)', () => {
  it('gera Argon2id com os parâmetros mínimos da OWASP', async () => {
    const stored = await hasher.hash('my cat writes books at night')
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/)
    expect(stored.pepperVersion).toBe(1)
  })

  it('confere a senha e recusa a errada', async () => {
    const stored = await hasher.hash('my cat writes books at night')
    expect(await hasher.verify('my cat writes books at night', stored)).toEqual({ ok: true, rehash: null })
    expect(await hasher.verify('my cat writes books at noon', stored)).toEqual({ ok: false })
  })

  it('normaliza com NFKC: o mesmo acento digitado de dois jeitos é a mesma senha', async () => {
    const stored = await hasher.hash('café com pão de queijo')
    expect((await hasher.verify('café com pão de queijo', stored)).ok).toBe(true)
  })

  it('sem o pepper certo, o hash não confere (o banco sozinho não basta)', async () => {
    const stored = await hasher.hash('my cat writes books at night')
    const otherPepper = new PasswordHasher(new Map([[1, pepperV2]]), 1)
    expect((await otherPepper.verify('my cat writes books at night', stored)).ok).toBe(false)
  })

  it('refaz o hash quando o pepper muda de versão', async () => {
    const stored = await hasher.hash('my cat writes books at night')
    const rotated = new PasswordHasher(
      new Map([
        [1, pepperV1],
        [2, pepperV2],
      ]),
      2,
    )
    const result = await rotated.verify('my cat writes books at night', stored)
    expect(result.ok && result.rehash?.pepperVersion).toBe(2)
    if (result.ok && result.rehash) {
      expect((await rotated.verify('my cat writes books at night', result.rehash)).ok).toBe(true)
    }
  })

  it('usuário inexistente também gasta um Argon2 e falha', async () => {
    expect(await hasher.verify('qualquer coisa aqui', null)).toEqual({ ok: false })
  })

  it('hash corrompido falha fechado', async () => {
    expect(await hasher.verify('x', { passwordHash: 'lixo', pepperVersion: 1 })).toEqual({ ok: false })
  })

  it('aguenta muitos hashes simultâneos pela fila', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hasher.hash('my cat writes books at night')),
    )
    expect(new Set(results.map((r) => r.passwordHash)).size).toBe(10)
  })
})

describe('tokens', () => {
  it('têm 256 bits em base64url e são guardados como SHA-256', () => {
    const token = randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken()).not.toBe(token)
    expect(hashToken(token)).not.toBe(token)
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('safeEqual compara conteúdo e tamanho', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('senhas vazadas (k-anonimato)', () => {
  const password = 'password1234567890'
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()

  function fakeFetch(
    body: string,
    status = 200,
  ): { fetch: Fetch; urls: string[]; headers: RequestInit['headers'][] } {
    const urls: string[] = []
    const headers: RequestInit['headers'][] = []
    return {
      urls,
      headers,
      fetch: async (url, init) => {
        urls.push(url)
        headers.push(init.headers ?? {})
        return new Response(body, { status })
      },
    }
  }

  it('envia só os 5 primeiros caracteres do SHA-1, com padding', async () => {
    const fake = fakeFetch('')
    await checkBreachedPassword(password, fake.fetch)
    expect(fake.urls).toEqual([`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`])
    expect(fake.urls[0]).not.toContain(sha1.slice(5))
    expect(fake.headers[0]).toMatchObject({ 'Add-Padding': 'true' })
  })

  it('detecta a senha vazada e ignora linhas de padding', async () => {
    expect(await checkBreachedPassword(password, fakeFetch(`AAAA:3\r\n${sha1.slice(5)}:42\r\n`).fetch)).toBe(
      'breached',
    )
    expect(await checkBreachedPassword(password, fakeFetch(`${sha1.slice(5)}:0\r\n`).fetch)).toBe('clean')
  })

  it('API fora do ar não bloqueia o cadastro', async () => {
    expect(await checkBreachedPassword(password, fakeFetch('', 503).fetch)).toBe('unknown')
    const failing: Fetch = async () => {
      throw new Error('rede')
    }
    expect(await checkBreachedPassword(password, failing)).toBe('unknown')
  })
})

describe('palavras do contexto', () => {
  it('recusa senha que é basicamente o username, o e-mail ou o nome do site', () => {
    expect(containsContextWord('quillframe12345', {})).toBe(true)
    expect(containsContextWord('Steve_writes2026', { username: 'Steve_writes' })).toBe(true)
    expect(containsContextWord('alice.smith!!', { email: 'alice.smith@example.com' })).toBe(true)
  })

  it('aceita frase longa que só menciona a palavra', () => {
    expect(containsContextWord('i write minecraft books every night', {})).toBe(false)
  })
})
