// Quem vê o quê (documento 02, §3.2 e §5.9). Nenhuma rota consulta livros sem passar por aqui:
// isso evita IDOR (trocar o id na URL e ler o livro de outra pessoa).
import type { Db } from '../context.ts'
import type { Book, Prisma, Role } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'

/** Quem está pedindo. `null` é o visitante sem conta. */
export type Viewer = { id: string; role: Role } | null

/** Contas suspensas continuam visíveis; banidas e em exclusão somem na hora. */
const VISIBLE_OWNER: Prisma.UserWhereInput = { status: { in: ['ACTIVE', 'SUSPENDED'] } }

/** Nenhum dos dois bloqueou o outro. */
export function notBlockedWith(viewerId: string): Prisma.UserWhereInput {
  return {
    blocksMade: { none: { blockedId: viewerId } },
    blocksGot: { none: { blockerId: viewerId } },
  }
}

/** Amizade aceita com o viewer (o par é guardado em ordem canônica, então há dois lados). */
export function friendOf(viewerId: string): Prisma.UserWhereInput {
  return {
    OR: [
      { friendshipsA: { some: { userBId: viewerId, status: 'ACCEPTED' } } },
      { friendshipsB: { some: { userAId: viewerId, status: 'ACCEPTED' } } },
    ],
  }
}

/** Livros de outras pessoas que o viewer pode ver: assinados, fora de revisão, públicos ou de amigos. */
export function sharedBooksWhere(viewer: Viewer): Prisma.BookWhereInput {
  const shared: Prisma.BookWhereInput = { deletedAt: null, status: 'SIGNED', reviewState: 'NONE' }
  if (!viewer) return { ...shared, visibility: 'PUBLIC', owner: VISIBLE_OWNER }
  return {
    ...shared,
    OR: [
      { visibility: 'PUBLIC', owner: { AND: [VISIBLE_OWNER, notBlockedWith(viewer.id)] } },
      {
        visibility: 'FRIENDS',
        owner: { AND: [VISIBLE_OWNER, notBlockedWith(viewer.id), friendOf(viewer.id)] },
      },
    ],
  }
}

/** Tudo o que o viewer pode ver: os próprios livros (em qualquer estado) e os compartilhados com ele. */
export function visibleBooksWhere(viewer: Viewer): Prisma.BookWhereInput {
  if (!viewer) return sharedBooksWhere(null)
  return { OR: [{ deletedAt: null, ownerId: viewer.id }, sharedBooksWhere(viewer)] }
}

export function isStaff(viewer: Viewer): boolean {
  return viewer?.role === 'MODERATOR' || viewer?.role === 'ADMIN'
}

/**
 * Moderadores leem livros públicos, em revisão, ocultos ou removidos, e os de amigos só se foram
 * denunciados. Nunca rascunhos, e nunca um livro privado que não passou pela moderação.
 */
async function staffCanView(db: Db, book: Book): Promise<boolean> {
  if (book.deletedAt || book.status !== 'SIGNED') return false
  if (book.reviewState !== 'NONE') return true
  if (book.visibility === 'PRIVATE') return false
  if (book.visibility === 'PUBLIC' || book.filterFlag !== null) return true
  const reported = await db.report.count({ where: { targetType: 'BOOK', targetId: book.id } })
  return reported > 0
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Um id fora do formato nem chega ao banco. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * Carrega um livro se o viewer puder vê-lo. O que ele não pode ver responde 404, nunca 403, para
 * não confirmar que o recurso existe.
 */
export async function findVisibleBook<T extends Prisma.BookInclude>(
  db: Db,
  viewer: Viewer,
  id: unknown,
  include: T,
): Promise<Prisma.BookGetPayload<{ include: T }>> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND')
  const visible = await db.book.findFirst({ where: { id, AND: [visibleBooksWhere(viewer)] }, include })
  if (visible) return visible as Prisma.BookGetPayload<{ include: T }>
  if (isStaff(viewer)) {
    const book = await db.book.findUnique({ where: { id }, include })
    if (book && (await staffCanView(db, book))) return book as Prisma.BookGetPayload<{ include: T }>
  }
  throw new ApiError('NOT_FOUND')
}

/** O livro do próprio usuário, ou 404. */
export async function findOwnBook(db: Db, ownerId: string, id: unknown): Promise<Book> {
  if (!isUuid(id)) throw new ApiError('NOT_FOUND')
  const book = await db.book.findFirst({ where: { id, ownerId, deletedAt: null } })
  if (!book) throw new ApiError('NOT_FOUND')
  return book
}

/** Um dos dois bloqueou o outro? */
export async function isBlockedBetween(db: Db, a: string, b: string): Promise<boolean> {
  const count = await db.block.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  })
  return count > 0
}

export function friendshipKey(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a }
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const row = await db.friendship.findUnique({ where: { userAId_userBId: friendshipKey(a, b) } })
  return row?.status === 'ACCEPTED'
}
