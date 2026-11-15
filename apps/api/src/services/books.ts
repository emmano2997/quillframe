// Formas de livro devolvidas pela API, paginação por cursor e notificações.
import type { Page } from '@quillframe/shared'
import type { Db, Deps, Tx } from '../context.ts'
import type { Book, Prisma } from '../generated/prisma/client.ts'
import { isUuid } from '../authz/books.ts'
import { ApiError } from '../http/problem.ts'

export const OWNER_SELECT = { select: { username: true, avatarId: true } } as const

export type BookWithOwner = Book & { owner: { username: string; avatarId: number } }

/** Item de lista (My Books, Community, perfil): sem as páginas. */
export function bookSummary(book: BookWithOwner, viewerId: string | null) {
  const own = book.ownerId === viewerId
  return {
    id: book.id,
    title: book.title,
    author: book.owner,
    status: book.status,
    visibility: book.visibility,
    // Só o dono sabe que o próprio livro está em revisão ou oculto
    reviewState: own ? book.reviewState : 'NONE',
    pageCount: book.pageCount,
    likeCount: book.likeCount,
    favoriteCount: book.favoriteCount,
    allowCopies: book.allowCopies,
    signedAt: book.signedAt,
    publishedAt: book.publishedAt,
    updatedAt: book.updatedAt,
    createdAt: book.createdAt,
  }
}

export type BookSummary = ReturnType<typeof bookSummary>

/**
 * Paginação por cursor (§4.1): o cursor é o id do último item. Busca um item a mais para saber se
 * há próxima página.
 */
export async function paginateBooks(
  db: Db,
  args: { where: Prisma.BookWhereInput; orderBy: Prisma.BookOrderByWithRelationInput[] },
  query: { cursor?: string | undefined; limit: number },
  viewerId: string | null,
): Promise<Page<BookSummary>> {
  if (query.cursor !== undefined && !isUuid(query.cursor)) throw new ApiError('VALIDATION_FAILED')
  const rows = await db.book.findMany({
    where: args.where,
    orderBy: [...args.orderBy, { id: 'desc' }],
    include: { owner: OWNER_SELECT },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
  const items = rows.slice(0, query.limit)
  return {
    items: items.map((book) => bookSummary(book, viewerId)),
    nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
  }
}

type Payload = Record<string, string | number | boolean | null>

/** Cria uma notificação (documento 02, §3.7). */
export async function notify(db: Db | Tx, userId: string, type: string, payload: Payload): Promise<void> {
  await db.notification.create({ data: { userId, type, payload } })
}

/**
 * Likes e comentários são agrupados: enquanto houver uma notificação não lida do mesmo livro, ela
 * só ganha mais um na contagem ("3 people liked...").
 */
export async function notifyGrouped(
  deps: Deps,
  userId: string,
  type: 'BOOK_LIKED' | 'BOOK_COMMENTED',
  book: { id: string; title: string },
  actor: string,
): Promise<void> {
  const existing = await deps.db.notification.findFirst({
    where: { userId, type, readAt: null, payload: { path: ['bookId'], equals: book.id } },
    orderBy: { createdAt: 'desc' },
  })
  const previous = existing?.payload as { count?: number } | undefined
  if (existing) {
    await deps.db.notification.update({
      where: { id: existing.id },
      data: {
        payload: { bookId: book.id, title: book.title, username: actor, count: (previous?.count ?? 1) + 1 },
        createdAt: deps.now(),
      },
    })
    return
  }
  await notify(deps.db, userId, type, { bookId: book.id, title: book.title, username: actor, count: 1 })
}
