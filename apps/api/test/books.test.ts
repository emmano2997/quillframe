// Livros: autosave, assinatura, importação/exportação, cópias e a matriz de autorização
// (documento 02, §3 e §5.9).
import { parseStendhal } from '@quillframe/shared'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  befriend,
  Client,
  signedBook,
  signUp,
  signUpStaff,
  testContext,
  type TestContext,
  type TestUser,
} from './helpers.ts'

let ctx: TestContext
let owner: TestUser
beforeAll(async () => {
  ctx = await testContext()
  owner = await signUp(ctx)
})
afterAll(() => ctx.close())

const fixture = (name: string) =>
  fs.readFileSync(
    path.resolve(import.meta.dirname, `../../../packages/shared/test/fixtures/books/${name}.stendhal`),
    'utf8',
  )

async function newDraft(user: TestUser = owner): Promise<string> {
  const response = await user.client.post('/api/books')
  expect(response.statusCode).toBe(201)
  return response.json<{ id: string }>().id
}

describe('rascunho e autosave (§3.3)', () => {
  it('nasce privado, com uma página vazia', async () => {
    const id = await newDraft()
    const book = (await owner.client.get(`/api/books/${id}`)).json()
    expect(book).toMatchObject({
      status: 'DRAFT',
      visibility: 'PRIVATE',
      pageCount: 1,
      pages: [''],
      version: 0,
    })
  })

  it('salva a página e incrementa a versão; versão antiga dá 409 VERSION_CONFLICT', async () => {
    const id = await newDraft()
    const saved = await owner.client.put(`/api/books/${id}/pages/0`, { content: 'first', baseVersion: 0 })
    expect(saved.json()).toEqual({ version: 1 })
    const stale = await owner.client.put(`/api/books/${id}/pages/0`, { content: 'other tab', baseVersion: 0 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 1 })
    expect((await owner.client.get(`/api/books/${id}`)).json().pages).toEqual(['first'])
  })

  it('limpa o conteúdo: mantém os códigos §, inclusive os inválidos; tira controles e direção de texto', async () => {
    const id = await newDraft()
    const content = '§cred§ §§x\r\nline‮ two\u0007\ttab'
    await owner.client.put(`/api/books/${id}/pages/0`, { content, baseVersion: 0 })
    expect((await owner.client.get(`/api/books/${id}`)).json().pages[0]).toBe('§cred§ §§x\nline twotab')
  })

  it('recusa página com mais de 1024 unidades UTF-16 (um emoji conta 2)', async () => {
    const id = await newDraft()
    const fits = await owner.client.put(`/api/books/${id}/pages/0`, {
      content: '💔'.repeat(512),
      baseVersion: 0,
    })
    expect(fits.statusCode).toBe(200)
    const over = await owner.client.put(`/api/books/${id}/pages/0`, {
      content: `${'💔'.repeat(512)}a`,
      baseVersion: 1,
    })
    expect(over.statusCode).toBe(400)
  })

  it('insere e remove páginas ajustando os índices', async () => {
    const id = await newDraft()
    await owner.client.put(`/api/books/${id}/pages`, { pages: ['A', 'B', 'C'], baseVersion: 0 })
    const inserted = await owner.client.post(`/api/books/${id}/pages`, {
      index: 1,
      baseVersion: 1,
      content: 'new',
    })
    expect(inserted.json()).toEqual({ version: 2, pageCount: 4 })
    expect((await owner.client.get(`/api/books/${id}`)).json().pages).toEqual(['A', 'new', 'B', 'C'])

    const removed = await owner.client.delete(`/api/books/${id}/pages/0`, { baseVersion: 2 })
    expect(removed.json()).toEqual({ version: 3, pageCount: 3 })
    expect((await owner.client.get(`/api/books/${id}`)).json().pages).toEqual(['new', 'B', 'C'])
    expect((await owner.client.delete(`/api/books/${id}/pages/9`, { baseVersion: 3 })).statusCode).toBe(404)
  })
})

describe('assinatura (§3.4)', () => {
  it('assinar trava o livro: a API responde 409 BOOK_SIGNED', async () => {
    const id = await signedBook(owner, { visibility: 'PRIVATE', title: '  Two Birds  ' })
    const book = (await owner.client.get(`/api/books/${id}`)).json()
    expect(book).toMatchObject({ status: 'SIGNED', title: 'Two Birds', visibility: 'PRIVATE' })

    const version = book.version as number
    expect(
      (await owner.client.put(`/api/books/${id}/pages/0`, { content: 'x', baseVersion: version })).json()
        .code,
    ).toBe('BOOK_SIGNED')
    expect(
      (await owner.client.post(`/api/books/${id}/pages`, { index: 0, baseVersion: version })).json().code,
    ).toBe('BOOK_SIGNED')
    expect(
      (await owner.client.delete(`/api/books/${id}/pages/0`, { baseVersion: version })).json().code,
    ).toBe('BOOK_SIGNED')
    expect((await owner.client.patch(`/api/books/${id}`, { title: 'Other' })).json().code).toBe('BOOK_SIGNED')
    expect(
      (await owner.client.post(`/api/books/${id}/sign`, { title: 'Again', visibility: 'PRIVATE' })).json()
        .code,
    ).toBe('BOOK_SIGNED')
  })

  it('o banco também trava: nem SQL direto altera as páginas de um livro assinado', async () => {
    const id = await signedBook(owner, { visibility: 'PRIVATE' })
    await expect(
      ctx.db.page.updateMany({ where: { bookId: id }, data: { content: 'tampered' } }),
    ).rejects.toThrow()
    await expect(ctx.db.page.deleteMany({ where: { bookId: id } })).rejects.toThrow()
    await expect(ctx.db.book.update({ where: { id }, data: { status: 'DRAFT' } })).rejects.toThrow()
  })

  it('rascunho é sempre privado, mesmo por SQL direto', async () => {
    const id = await newDraft()
    await expect(ctx.db.book.update({ where: { id }, data: { visibility: 'PUBLIC' } })).rejects.toThrow()
    expect(
      (
        await owner.client.patch(`/api/books/${id}/visibility`, {
          visibility: 'PUBLIC',
          acceptGuidelines: true,
        })
      ).statusCode,
    ).toBe(409)
  })

  it('compartilhar exige aceitar as diretrizes e ter o e-mail verificado', async () => {
    const id = await newDraft()
    const noGuidelines = await owner.client.post(`/api/books/${id}/sign`, {
      title: 'T',
      visibility: 'PUBLIC',
    })
    expect(noGuidelines.statusCode).toBe(400)

    const unverified = await signUp(ctx, { verify: false })
    const draft = await newDraft(unverified)
    const blocked = await unverified.client.post(`/api/books/${draft}/sign`, {
      title: 'T',
      visibility: 'PUBLIC',
      acceptGuidelines: true,
    })
    expect(blocked.json().code).toBe('EMAIL_NOT_VERIFIED')
    // Assinar em privado não exige e-mail verificado
    expect(
      (await unverified.client.post(`/api/books/${draft}/sign`, { title: 'T', visibility: 'PRIVATE' }))
        .statusCode,
    ).toBe(200)
  })

  it('título: de 1 a 64 caracteres, sem controles', async () => {
    const id = await newDraft()
    expect(
      (await owner.client.post(`/api/books/${id}/sign`, { title: '   ', visibility: 'PRIVATE' })).statusCode,
    ).toBe(400)
    expect(
      (await owner.client.post(`/api/books/${id}/sign`, { title: 'x'.repeat(65), visibility: 'PRIVATE' }))
        .statusCode,
    ).toBe(400)
    expect(
      (await owner.client.post(`/api/books/${id}/sign`, { title: 'x'.repeat(64), visibility: 'PRIVATE' }))
        .statusCode,
    ).toBe(200)
  })
})

describe('importação e exportação .stendhal (§3.6)', () => {
  it('importa um livro do autor como rascunho e exporta de volta idêntico', async () => {
    const original = fixture('two_birds')
    const parsed = parseStendhal(original)
    const imported = await owner.client.post('/api/books/import', { content: original })
    expect(imported.statusCode).toBe(201)
    const { id } = imported.json<{ id: string }>()
    const book = (await owner.client.get(`/api/books/${id}`)).json()
    expect(book.status).toBe('DRAFT')
    expect(book.title).toBe(parsed.title)
    expect(book.pages).toEqual(parsed.pages)
    // A linha "author:" é ignorada: o autor é sempre a conta
    expect(book.author.username).toBe(owner.username)

    const exported = await owner.client.get(`/api/books/${id}/export`)
    expect(exported.headers['content-disposition']).toMatch(/^attachment; filename="[a-z0-9_-]+\.stendhal"$/)
    expect(parseStendhal(exported.body).pages).toEqual(parsed.pages)
  })

  it('recusa arquivo fora do formato e páginas acima do limite', async () => {
    expect((await owner.client.post('/api/books/import', { content: 'not a book' })).statusCode).toBe(400)
    const long = `title: T\nauthor: A\npages:\n#- ${'x'.repeat(1025)}`
    const response = await owner.client.post('/api/books/import', { content: long })
    expect(response.statusCode).toBe(400)
    expect(response.json().detail).toContain('Page 1')
  })

  it('só o dono exporta (B13)', async () => {
    const id = await signedBook(owner, { visibility: 'PUBLIC' })
    const other = await signUp(ctx)
    expect((await other.client.get(`/api/books/${id}/export`)).statusCode).toBe(404)
    expect((await new Client(ctx.app).get(`/api/books/${id}/export`)).statusCode).toBe(401)
  })

  it('o nome do arquivo nunca leva caracteres do título para o header', async () => {
    const id = await signedBook(owner, { visibility: 'PRIVATE', title: 'evil"; filename="x.exe' })
    const exported = await owner.client.get(`/api/books/${id}/export`)
    expect(exported.headers['content-disposition']).toBe(
      'attachment; filename="evil_filename_x_exe.stendhal"',
    )
  })
})

describe('cópias (§3.5)', () => {
  it('copia o original (geração 1) e a cópia (geração 2); cópia da cópia não é copiável', async () => {
    const id = await signedBook(owner, { visibility: 'PUBLIC' })
    const reader = await signUp(ctx)
    const second = await signUp(ctx)

    const first = await reader.client.post(`/api/books/${id}/copy`)
    expect(first.json()).toMatchObject({ generation: 1 })
    expect((await reader.client.post(`/api/books/${id}/copy`)).statusCode).toBe(409)

    const fromCopy = await second.client.post(`/api/books/${id}/copy`, { fromCopyId: first.json().id })
    expect(fromCopy.json()).toMatchObject({ generation: 2 })
    const third = await signUp(ctx)
    const blocked = await third.client.post(`/api/books/${id}/copy`, { fromCopyId: fromCopy.json().id })
    expect(blocked.statusCode).toBe(403)

    // A cópia aponta para o original: o autor exibido é sempre o original
    const copies = (await reader.client.get('/api/me/copies')).json().items
    expect(copies[0].book.author.username).toBe(owner.username)
  })

  it('se o original ficar privado, a cópia mostra que não está mais disponível', async () => {
    const id = await signedBook(owner, { visibility: 'PUBLIC' })
    const reader = await signUp(ctx)
    await reader.client.post(`/api/books/${id}/copy`)
    await owner.client.patch(`/api/books/${id}/visibility`, { visibility: 'PRIVATE' })
    const copies = (await reader.client.get('/api/me/copies')).json().items
    expect(copies[0].book).toBeNull()
  })

  it('respeita "Allow copies"', async () => {
    const id = await signedBook(owner, { visibility: 'PUBLIC' })
    await owner.client.patch(`/api/books/${id}`, { allowCopies: false })
    const reader = await signUp(ctx)
    expect((await reader.client.post(`/api/books/${id}/copy`)).statusCode).toBe(403)
  })
})

// Cada rota × cada ator × cada estado. O que alguém não pode ver responde 404, nunca 403.
describe('matriz de autorização (§3.2 e §5.9)', () => {
  type State = 'DRAFT' | 'PRIVATE' | 'FRIENDS' | 'PUBLIC' | 'PENDING_REVIEW' | 'HIDDEN' | 'REMOVED'
  type Actor = 'owner' | 'friend' | 'stranger' | 'blocked' | 'visitor' | 'moderator' | 'admin'
  const books = {} as Record<State, string>
  const actors = {} as Record<Actor, Client>

  beforeAll(async () => {
    const author = await signUp(ctx)
    const friend = await signUp(ctx)
    const stranger = await signUp(ctx)
    const blocked = await signUp(ctx)
    await befriend(friend, author)
    await author.client.put(`/api/blocks/${blocked.username}`)
    actors.owner = author.client
    actors.friend = friend.client
    actors.stranger = stranger.client
    actors.blocked = blocked.client
    actors.visitor = new Client(ctx.app)
    actors.moderator = (await signUpStaff(ctx, 'MODERATOR')).client
    actors.admin = (await signUpStaff(ctx, 'ADMIN')).client

    books.DRAFT = await newDraft(author)
    books.PRIVATE = await signedBook(author, { visibility: 'PRIVATE' })
    books.FRIENDS = await signedBook(author, { visibility: 'FRIENDS' })
    books.PUBLIC = await signedBook(author, { visibility: 'PUBLIC' })
    for (const state of ['PENDING_REVIEW', 'HIDDEN', 'REMOVED'] as const) {
      books[state] = await signedBook(author, { visibility: 'PUBLIC' })
      await ctx.db.book.update({ where: { id: books[state] }, data: { reviewState: state } })
    }
  })

  // 200 = lê; 404 = não existe para esse ator
  const READ: Record<State, Record<Actor, number>> = {
    DRAFT: { owner: 200, friend: 404, stranger: 404, blocked: 404, visitor: 404, moderator: 404, admin: 404 },
    PRIVATE: {
      owner: 200,
      friend: 404,
      stranger: 404,
      blocked: 404,
      visitor: 404,
      moderator: 404,
      admin: 404,
    },
    // Moderador só lê livro de amigos se ele foi denunciado
    FRIENDS: {
      owner: 200,
      friend: 200,
      stranger: 404,
      blocked: 404,
      visitor: 404,
      moderator: 404,
      admin: 404,
    },
    PUBLIC: {
      owner: 200,
      friend: 200,
      stranger: 200,
      blocked: 404,
      visitor: 200,
      moderator: 200,
      admin: 200,
    },
    PENDING_REVIEW: {
      owner: 200,
      friend: 404,
      stranger: 404,
      blocked: 404,
      visitor: 404,
      moderator: 200,
      admin: 200,
    },
    HIDDEN: {
      owner: 200,
      friend: 404,
      stranger: 404,
      blocked: 404,
      visitor: 404,
      moderator: 200,
      admin: 200,
    },
    REMOVED: {
      owner: 200,
      friend: 404,
      stranger: 404,
      blocked: 404,
      visitor: 404,
      moderator: 200,
      admin: 200,
    },
  }

  for (const [state, row] of Object.entries(READ) as [State, Record<Actor, number>][]) {
    for (const [actor, expected] of Object.entries(row) as [Actor, number][]) {
      it(`GET /api/books/:id · ${actor} · ${state} → ${expected}`, async () => {
        const response = await actors[actor].get(`/api/books/${books[state]}`)
        expect(response.statusCode).toBe(expected)
      })
    }
  }

  const others: Actor[] = ['friend', 'stranger', 'blocked', 'moderator', 'admin']
  for (const actor of others) {
    it(`escrita no rascunho de outra pessoa · ${actor} → 404`, async () => {
      const client = actors[actor]
      const id = books.DRAFT
      expect(
        (await client.put(`/api/books/${id}/pages/0`, { content: 'x', baseVersion: 0 })).statusCode,
      ).toBe(404)
      expect((await client.post(`/api/books/${id}/pages`, { index: 0, baseVersion: 0 })).statusCode).toBe(404)
      expect(
        (await client.post(`/api/books/${id}/sign`, { title: 'Mine now', visibility: 'PRIVATE' })).statusCode,
      ).toBe(404)
      expect((await client.patch(`/api/books/${id}`, { title: 'Mine now' })).statusCode).toBe(404)
      expect((await client.delete(`/api/books/${id}`)).statusCode).toBe(404)
      expect(
        (await client.patch(`/api/books/${books.PUBLIC}/visibility`, { visibility: 'PRIVATE' })).statusCode,
      ).toBe(404)
    })
  }

  it('visitante sem conta não escreve nada (401)', async () => {
    expect((await actors.visitor.post('/api/books')).statusCode).toBe(401)
    expect(
      (await actors.visitor.put(`/api/books/${books.DRAFT}/pages/0`, { content: 'x', baseVersion: 0 }))
        .statusCode,
    ).toBe(401)
  })

  it('livros em revisão ou ocultos não recebem like, cópia nem comentário', async () => {
    for (const state of ['PENDING_REVIEW', 'HIDDEN', 'REMOVED'] as const) {
      expect((await actors.stranger.put(`/api/books/${books[state]}/like`)).statusCode).toBe(404)
      expect((await actors.stranger.post(`/api/books/${books[state]}/copy`)).statusCode).toBe(404)
      expect((await actors.stranger.put(`/api/books/${books[state]}/comments/0`)).statusCode).toBe(404)
    }
  })

  it('ids fora do formato respondem 404 sem chegar ao banco', async () => {
    expect((await actors.owner.get('/api/books/not-a-uuid')).statusCode).toBe(404)
    expect((await actors.owner.get("/api/books/' OR 1=1 --")).statusCode).toBe(404)
  })

  it('as listas seguem a mesma regra: o perfil só mostra o que o ator pode ver', async () => {
    const author = (await actors.owner.get('/api/me')).json().username as string
    const titlesFor = async (client: Client) => {
      const response = await client.get(`/api/users/${author}/books`)
      return response.statusCode === 200
        ? (response.json().items as { id: string }[]).map((book) => book.id)
        : null
    }
    expect((await titlesFor(actors.stranger))?.sort()).toEqual([books.PUBLIC].sort())
    expect((await titlesFor(actors.friend))?.sort()).toEqual([books.PUBLIC, books.FRIENDS].sort())
    expect(await titlesFor(actors.blocked)).toBeNull()
    expect(await titlesFor(actors.owner)).toHaveLength(6)
  })
})
