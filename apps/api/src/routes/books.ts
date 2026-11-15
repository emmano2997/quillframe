// Biblioteca: rascunhos com autosave, assinatura, visibilidade, importação, exportação e cópias
// (documento 02, §3.1–3.6).
import {
  changeVisibilitySchema,
  copyBookSchema,
  exportFileName,
  importBookSchema,
  insertPageSchema,
  LIMITS,
  pageQuerySchema,
  parseStendhal,
  removePageSchema,
  replacePagesSchema,
  sanitizeLine,
  sanitizePageContent,
  savePageSchema,
  serializeStendhal,
  signBookSchema,
  StendhalFormatError,
  stendhalIssues,
  truncateUtf16,
  updateBookSchema,
} from '@quillframe/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { findOwnBook, findVisibleBook, isUuid, sharedBooksWhere, type Viewer } from '../authz/books.ts'
import type { Deps, Tx } from '../context.ts'
import type { FilterSeverity } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import { audit, requireActive, requireAuth, requireVerified, type Auth } from '../http/session.ts'
import { isUniqueViolation } from '../services/accounts.ts'
import { bookSummary, OWNER_SELECT, paginateBooks } from '../services/books.ts'

const MAX_DRAFTS = 200
/** Deslocamento usado para mover índices de página sem esbarrar na chave (bookId, index). */
const SHIFT = 100_000

const libraryQuerySchema = pageQuerySchema
  .extend({ status: z.enum(['draft', 'signed']).default('draft') })
  .strict()

export function viewerOf(auth: Auth | null): Viewer {
  return auth ? { id: auth.user.id, role: auth.user.role } : null
}

/**
 * Concorrência otimista do autosave (§3.3): a alteração só vale se `baseVersion` ainda for a versão
 * do livro. Devolve a versão nova.
 */
async function claimDraft(tx: Tx, bookId: string, ownerId: string, baseVersion: number): Promise<number> {
  const claimed = await tx.book.updateMany({
    where: { id: bookId, ownerId, deletedAt: null, status: 'DRAFT', version: baseVersion },
    data: { version: { increment: 1 } },
  })
  if (claimed.count === 1) return baseVersion + 1
  const book = await tx.book.findFirst({
    where: { id: bookId, ownerId, deletedAt: null },
    select: { status: true, version: true },
  })
  if (!book) throw new ApiError('NOT_FOUND')
  if (book.status === 'SIGNED') throw new ApiError('BOOK_SIGNED')
  throw new ApiError('VERSION_CONFLICT', { extra: { currentVersion: book.version } })
}

function bookIdOf(params: unknown): string {
  const { id } = params as { id?: string }
  if (!isUuid(id)) throw new ApiError('NOT_FOUND')
  return id
}

function pageIndexOf(params: unknown): number {
  const { index } = params as { index?: string }
  if (!index || !/^\d{1,4}$/.test(index)) throw new ApiError('NOT_FOUND')
  return Number(index)
}

export function registerBookRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps

  /** O filtro roda ao compartilhar (§6.2): título e todas as páginas. */
  async function filterVerdict(title: string, pages: string[]): Promise<FilterSeverity | null> {
    return (await deps.filter()).worst([title, ...pages])
  }

  app.get('/api/me/books', async (request) => {
    const auth = requireAuth(request)
    const query = libraryQuerySchema.parse(request.query)
    const { status, ...page } = query
    return paginateBooks(
      db,
      {
        where: { ownerId: auth.user.id, deletedAt: null, status: status === 'draft' ? 'DRAFT' : 'SIGNED' },
        orderBy: [{ updatedAt: 'desc' }],
      },
      page,
      auth.user.id,
    )
  })

  app.post('/api/books', async (request, reply) => {
    const auth = requireActive(request)
    await deps.limiter.consume('bookCreate', auth.user.id)
    const drafts = await db.book.count({ where: { ownerId: auth.user.id, status: 'DRAFT', deletedAt: null } })
    if (drafts >= MAX_DRAFTS) {
      throw new ApiError('LIMIT_REACHED', { detail: `You can have up to ${MAX_DRAFTS} drafts.` })
    }
    const book = await db.book.create({
      data: { ownerId: auth.user.id, pages: { create: { index: 0, content: '' } } },
      include: { owner: OWNER_SELECT },
    })
    return reply.code(201).send(bookSummary(book, auth.user.id))
  })

  // O arquivo .stendhal chega como texto dentro do JSON; o limite do corpo cobre os 2 MB com folga
  app.post('/api/books/import', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    const auth = requireActive(request)
    await deps.limiter.consume('bookCreate', auth.user.id)
    const { content } = importBookSchema.parse(request.body)
    let parsed
    try {
      parsed = parseStendhal(content)
    } catch (error) {
      if (error instanceof StendhalFormatError)
        throw new ApiError('VALIDATION_FAILED', { detail: error.message })
      throw error
    }
    const pages = (parsed.pages.length === 0 ? [''] : parsed.pages).map(sanitizePageContent)
    if (pages.length > LIMITS.sitePages) {
      throw new ApiError('VALIDATION_FAILED', {
        detail: `A book can have at most ${LIMITS.sitePages} pages.`,
      })
    }
    const tooLong = pages.findIndex((page) => page.length > LIMITS.pageChars)
    if (tooLong !== -1) {
      throw new ApiError('VALIDATION_FAILED', {
        detail: `Page ${tooLong + 1} has more than ${LIMITS.pageChars} characters.`,
      })
    }
    const drafts = await db.book.count({ where: { ownerId: auth.user.id, status: 'DRAFT', deletedAt: null } })
    if (drafts >= MAX_DRAFTS) {
      throw new ApiError('LIMIT_REACHED', { detail: `You can have up to ${MAX_DRAFTS} drafts.` })
    }
    // A linha "author:" é ignorada: o autor é sempre a conta (D4). O resultado é um rascunho.
    const book = await db.book.create({
      data: {
        ownerId: auth.user.id,
        title: truncateUtf16(sanitizeLine(parsed.title), LIMITS.titleChars),
        pageCount: pages.length,
        pages: { create: pages.map((page, index) => ({ index, content: page })) },
      },
      include: { owner: OWNER_SELECT },
    })
    return reply.code(201).send(bookSummary(book, auth.user.id))
  })

  app.get('/api/books/:id', async (request) => {
    const viewer = viewerOf(request.auth)
    const book = await findVisibleBook(db, viewer, (request.params as { id: string }).id, {
      owner: OWNER_SELECT,
      pages: { orderBy: { index: 'asc' }, select: { content: true } },
    })
    const viewerId = viewer?.id ?? null
    const own = book.ownerId === viewerId
    const [liked, favorited, copies, action] = await Promise.all([
      viewerId ? db.like.count({ where: { userId: viewerId, bookId: book.id } }) : 0,
      viewerId ? db.favorite.count({ where: { userId: viewerId, bookId: book.id } }) : 0,
      viewerId
        ? db.bookCopy.findMany({
            where: { ownerId: viewerId, sourceBookId: book.id },
            select: { id: true, generation: true },
          })
        : [],
      // Nada some sem explicação para o autor: a última decisão vem junto (§6.7)
      own && book.reviewState !== 'NONE'
        ? db.moderationAction.findFirst({
            where: { targetType: 'BOOK', targetId: book.id, type: { in: ['HIDE', 'REMOVE', 'STRIKE'] } },
            orderBy: { createdAt: 'desc' },
            include: { appeal: { select: { status: true } } },
          })
        : null,
    ])
    return {
      ...bookSummary(book, viewerId),
      // Moderadores veem o estado real; o dono também
      reviewState: own || viewer?.role !== 'USER' ? book.reviewState : 'NONE',
      allowComments: book.allowComments,
      version: own ? book.version : undefined,
      pages: book.pages.map((page) => page.content),
      viewer: {
        isOwner: own,
        liked: liked > 0,
        favorited: favorited > 0,
        copies,
      },
      moderation: action
        ? {
            actionId: action.id,
            type: action.type,
            guideline: action.guideline,
            reason: action.reason,
            automated: action.automated,
            createdAt: action.createdAt,
            appealStatus: action.appeal?.status ?? null,
          }
        : null,
    }
  })

  app.patch('/api/books/:id', async (request) => {
    const auth = requireActive(request)
    const body = updateBookSchema.parse(request.body)
    const book = await findOwnBook(db, auth.user.id, bookIdOf(request.params))
    if (body.title !== undefined && book.status !== 'DRAFT') throw new ApiError('BOOK_SIGNED')
    const updated = await db.book.update({
      where: { id: book.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.allowCopies !== undefined ? { allowCopies: body.allowCopies } : {}),
        ...(body.allowComments !== undefined ? { allowComments: body.allowComments } : {}),
      },
      include: { owner: OWNER_SELECT },
    })
    return bookSummary(updated, auth.user.id)
  })

  // --- Autosave (§3.3) -----------------------------------------------------------------------

  app.put('/api/books/:id/pages/:index', async (request) => {
    const auth = requireActive(request)
    await deps.limiter.consume('autosave', auth.user.id)
    const bookId = bookIdOf(request.params)
    const index = pageIndexOf(request.params)
    const body = savePageSchema.parse(request.body)
    const version = await db.$transaction(async (tx) => {
      const next = await claimDraft(tx, bookId, auth.user.id, body.baseVersion)
      const saved = await tx.page.updateMany({ where: { bookId, index }, data: { content: body.content } })
      if (saved.count !== 1) throw new ApiError('NOT_FOUND')
      return next
    })
    return { version }
  })

  app.post('/api/books/:id/pages', async (request, reply) => {
    const auth = requireActive(request)
    await deps.limiter.consume('autosave', auth.user.id)
    const bookId = bookIdOf(request.params)
    const body = insertPageSchema.parse(request.body)
    const result = await db.$transaction(async (tx) => {
      const version = await claimDraft(tx, bookId, auth.user.id, body.baseVersion)
      const book = await tx.book.findUniqueOrThrow({ where: { id: bookId }, select: { pageCount: true } })
      if (body.index > book.pageCount) throw new ApiError('VALIDATION_FAILED')
      if (book.pageCount >= LIMITS.sitePages) {
        throw new ApiError('LIMIT_REACHED', { detail: `A book can have at most ${LIMITS.sitePages} pages.` })
      }
      // As páginas seguintes sobem um índice, em dois passos para não repetir a chave no caminho
      await tx.page.updateMany({
        where: { bookId, index: { gte: body.index } },
        data: { index: { increment: SHIFT } },
      })
      await tx.page.updateMany({
        where: { bookId, index: { gte: SHIFT } },
        data: { index: { decrement: SHIFT - 1 } },
      })
      await tx.page.create({ data: { bookId, index: body.index, content: body.content ?? '' } })
      await tx.book.update({ where: { id: bookId }, data: { pageCount: { increment: 1 } } })
      return { version, pageCount: book.pageCount + 1 }
    })
    return reply.code(201).send(result)
  })

  app.delete('/api/books/:id/pages/:index', async (request) => {
    const auth = requireActive(request)
    await deps.limiter.consume('autosave', auth.user.id)
    const bookId = bookIdOf(request.params)
    const index = pageIndexOf(request.params)
    const body = removePageSchema.parse(request.body)
    return db.$transaction(async (tx) => {
      const version = await claimDraft(tx, bookId, auth.user.id, body.baseVersion)
      const book = await tx.book.findUniqueOrThrow({ where: { id: bookId }, select: { pageCount: true } })
      if (index >= book.pageCount) throw new ApiError('NOT_FOUND')
      // Um livro tem sempre pelo menos uma página: remover a única só a esvazia
      if (book.pageCount === 1) {
        await tx.page.updateMany({ where: { bookId, index: 0 }, data: { content: '' } })
        return { version, pageCount: 1 }
      }
      await tx.page.deleteMany({ where: { bookId, index } })
      await tx.page.updateMany({
        where: { bookId, index: { gt: index } },
        data: { index: { increment: SHIFT } },
      })
      await tx.page.updateMany({
        where: { bookId, index: { gte: SHIFT } },
        data: { index: { decrement: SHIFT + 1 } },
      })
      await tx.book.update({ where: { id: bookId }, data: { pageCount: { decrement: 1 } } })
      return { version, pageCount: book.pageCount - 1 }
    })
  })

  // Troca todas as páginas de uma vez ("Paste Book", "Clear Book")
  app.put('/api/books/:id/pages', { bodyLimit: 6 * 1024 * 1024 }, async (request) => {
    const auth = requireActive(request)
    await deps.limiter.consume('autosave', auth.user.id)
    const bookId = bookIdOf(request.params)
    const body = replacePagesSchema.parse(request.body)
    return db.$transaction(async (tx) => {
      const version = await claimDraft(tx, bookId, auth.user.id, body.baseVersion)
      await tx.page.deleteMany({ where: { bookId } })
      await tx.page.createMany({ data: body.pages.map((content, index) => ({ bookId, index, content })) })
      await tx.book.update({ where: { id: bookId }, data: { pageCount: body.pages.length } })
      return { version, pageCount: body.pages.length }
    })
  })

  // --- Assinatura e visibilidade (§3.4) ------------------------------------------------------

  app.post('/api/books/:id/sign', async (request) => {
    const auth = requireActive(request)
    const body = signBookSchema.parse(request.body)
    const book = await findOwnBook(db, auth.user.id, bookIdOf(request.params))
    if (book.status !== 'DRAFT') throw new ApiError('BOOK_SIGNED')
    const shared = body.visibility !== 'PRIVATE'
    // Compartilhar exige e-mail verificado; assinar em privado, não
    if (shared) requireVerified(request)

    const pages = await db.page.findMany({ where: { bookId: book.id }, orderBy: { index: 'asc' } })
    const flag = shared
      ? await filterVerdict(
          body.title,
          pages.map((page) => page.content),
        )
      : null
    const now = deps.now()
    // A assinatura é irreversível (D7). A condição no WHERE evita assinar duas vezes em paralelo.
    const signed = await db.book.updateMany({
      where: { id: book.id, status: 'DRAFT' },
      data: {
        status: 'SIGNED',
        title: body.title,
        visibility: body.visibility,
        signedAt: now,
        publishedAt: shared ? now : null,
        // Termo de alto risco: só o autor vê o livro até um moderador aprovar
        reviewState: flag === 'HIGH' ? 'PENDING_REVIEW' : 'NONE',
        filterFlag: flag,
        version: { increment: 1 },
      },
    })
    if (signed.count !== 1) throw new ApiError('BOOK_SIGNED')
    await audit(deps, request, 'BOOK_SIGNED', { targetId: book.id, meta: { visibility: body.visibility } })
    const result = await db.book.findUniqueOrThrow({
      where: { id: book.id },
      include: { owner: OWNER_SELECT },
    })
    return bookSummary(result, auth.user.id)
  })

  app.patch('/api/books/:id/visibility', async (request) => {
    const auth = requireActive(request)
    const body = changeVisibilitySchema.parse(request.body)
    const book = await findOwnBook(db, auth.user.id, bookIdOf(request.params))
    // Rascunho é sempre privado: só livro assinado muda de visibilidade
    if (book.status !== 'SIGNED')
      throw new ApiError('CONFLICT', { detail: 'Sign the book before sharing it.' })
    const shared = body.visibility !== 'PRIVATE'
    if (shared) requireVerified(request)

    // Ao sair de PRIVATE pela primeira vez, o filtro roda
    let review = {}
    if (shared && book.publishedAt === null) {
      const pages = await db.page.findMany({ where: { bookId: book.id }, orderBy: { index: 'asc' } })
      const flag = await filterVerdict(
        book.title,
        pages.map((page) => page.content),
      )
      review = {
        publishedAt: deps.now(),
        filterFlag: flag,
        ...(flag === 'HIGH' && book.reviewState === 'NONE' ? { reviewState: 'PENDING_REVIEW' as const } : {}),
      }
    }
    const updated = await db.book.update({
      where: { id: book.id },
      data: { visibility: body.visibility, ...review },
      include: { owner: OWNER_SELECT },
    })
    await audit(deps, request, 'BOOK_VISIBILITY', {
      targetId: book.id,
      meta: { visibility: body.visibility },
    })
    return bookSummary(updated, auth.user.id)
  })

  app.delete('/api/books/:id', async (request) => {
    const auth = requireAuth(request)
    const book = await findOwnBook(db, auth.user.id, bookIdOf(request.params))
    // Exclusão lógica; o job diário apaga de vez depois do prazo (§2.5)
    await db.book.update({ where: { id: book.id }, data: { deletedAt: deps.now() } })
    await audit(deps, request, 'BOOK_DELETED', { targetId: book.id })
    return { ok: true }
  })

  // Só o dono exporta (B13). Contas suspensas também podem exportar os próprios livros (§6.6).
  app.get('/api/books/:id/export', async (request, reply) => {
    const auth = requireAuth(request)
    const book = await findOwnBook(db, auth.user.id, bookIdOf(request.params))
    const pages = await db.page.findMany({ where: { bookId: book.id }, orderBy: { index: 'asc' } })
    const stendhal = {
      title: book.title,
      author: auth.user.username,
      pages: pages.map((page) => page.content),
    }
    const issues = stendhalIssues(stendhal)
    if (issues.length > 0) throw new ApiError('VALIDATION_FAILED', { detail: issues.join(' ') })
    return (
      reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        // O nome só tem [a-z0-9_-]: nada do título chega ao header
        .header('Content-Disposition', `attachment; filename="${exportFileName(book.title)}"`)
        .send(serializeStendhal(stendhal))
    )
  })

  // --- Cópias (§3.5) -------------------------------------------------------------------------

  app.post('/api/books/:id/copy', async (request, reply) => {
    const auth = requireVerified(request)
    await deps.limiter.consume('interact', auth.user.id)
    const body = copyBookSchema.parse(request.body ?? {})
    const book = await findVisibleBook(db, viewerOf(auth), bookIdOf(request.params), {})
    if (book.status !== 'SIGNED' || book.reviewState !== 'NONE') throw new ApiError('NOT_FOUND')
    if (!book.allowCopies && book.ownerId !== auth.user.id) {
      throw new ApiError('FORBIDDEN', { detail: "The author doesn't allow copies of this book." })
    }
    // Copiar o original dá a geração 1; copiar uma cópia dá a 2; cópia da cópia não é copiável
    let generation = 1
    if (body.fromCopyId) {
      const source = await db.bookCopy.findFirst({ where: { id: body.fromCopyId, sourceBookId: book.id } })
      if (!source) throw new ApiError('NOT_FOUND')
      if (source.generation !== 1) {
        throw new ApiError('FORBIDDEN', { detail: "A copy of a copy can't be copied." })
      }
      generation = 2
    }
    try {
      const copy = await db.bookCopy.create({
        data: { ownerId: auth.user.id, sourceBookId: book.id, generation },
      })
      return reply.code(201).send({ id: copy.id, generation })
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('CONFLICT', { detail: 'You already have this copy.' })
      throw error
    }
  })

  app.delete('/api/me/copies/:id', async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    const removed = await db.bookCopy.deleteMany({ where: { id, ownerId: auth.user.id } })
    if (removed.count === 0) throw new ApiError('NOT_FOUND')
    return { ok: true }
  })

  app.get('/api/me/copies', async (request) => {
    const auth = requireAuth(request)
    const copies = await db.bookCopy.findMany({
      where: { ownerId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    // A cópia aponta para o original: se ele saiu do ar, a cópia mostra que não está mais disponível
    const visible = await db.book.findMany({
      where: {
        id: { in: copies.map((copy) => copy.sourceBookId) },
        OR: [{ ownerId: auth.user.id, deletedAt: null, status: 'SIGNED' }, sharedBooksWhere(viewerOf(auth))],
      },
      include: { owner: OWNER_SELECT },
    })
    const byId = new Map(visible.map((book) => [book.id, book]))
    return {
      items: copies.map((copy) => {
        const book = byId.get(copy.sourceBookId)
        return {
          id: copy.id,
          generation: copy.generation,
          createdAt: copy.createdAt,
          book: book ? bookSummary(book, auth.user.id) : null,
        }
      }),
    }
  })
}
