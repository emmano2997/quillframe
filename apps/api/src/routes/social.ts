// Rede social: perfis, amizades, bloqueios, likes, favoritos, comentários predefinidos, feed, busca
// e notificações (documento 02, §3.7).
import {
  COMMENT_PRESETS,
  feedQuerySchema,
  friendRequestSchema,
  isMinor,
  MODERATION,
  notificationsReadSchema,
  pageQuerySchema,
  presetIdSchema,
  searchQuerySchema,
  USERNAME_PATTERN,
} from '@quillframe/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  findVisibleBook,
  friendOf,
  friendshipKey,
  isBlockedBetween,
  isUuid,
  notBlockedWith,
  sharedBooksWhere,
  type Viewer,
} from '../authz/books.ts'
import { HOUR, DAY, type Deps } from '../context.ts'
import type { Prisma, User } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import { requireAuth, requireVerified, type Auth } from '../http/session.ts'
import { isUniqueViolation, privacyOf } from '../services/accounts.ts'
import { bookSummary, notify, notifyGrouped, OWNER_SELECT, paginateBooks } from '../services/books.ts'
import { viewerOf } from './books.ts'

const MAX_PENDING_REQUESTS = 50
const USER_CARD = { select: { id: true, username: true, avatarId: true } } as const

export function registerSocialRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, limiter } = deps

  /**
   * Perfil visível para quem pergunta, ou 404: conta inexistente, banida, em exclusão ou com
   * bloqueio entre os dois (nenhum dos dois vê o outro, §3.2).
   */
  async function findProfile(request: FastifyRequest): Promise<User> {
    const { username } = request.params as { username: string }
    if (!USERNAME_PATTERN.test(username)) throw new ApiError('NOT_FOUND')
    const user = await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } })
    if (!user || (user.status !== 'ACTIVE' && user.status !== 'SUSPENDED')) throw new ApiError('NOT_FOUND')
    const viewerId = request.auth?.user.id
    if (viewerId && viewerId !== user.id && (await isBlockedBetween(db, viewerId, user.id))) {
      throw new ApiError('NOT_FOUND')
    }
    return user
  }

  /** Livro que o usuário pode ver e com o qual pode interagir (assinado, fora de revisão). */
  async function findInteractable(auth: Auth, id: unknown) {
    const book = await findVisibleBook(db, viewerOf(auth), id, { owner: OWNER_SELECT })
    if (book.status !== 'SIGNED' || book.reviewState !== 'NONE') throw new ApiError('NOT_FOUND')
    return book
  }

  // --- Perfis --------------------------------------------------------------------------------

  app.get('/api/users/:username', async (request) => {
    const user = await findProfile(request)
    const viewer = viewerOf(request.auth)
    const minor = isMinor(user.birthDate, deps.now())
    const own = viewer?.id === user.id
    const [bookCount, friendship] = await Promise.all([
      db.book.count({
        where: {
          ownerId: user.id,
          AND: [own ? { deletedAt: null, status: 'SIGNED' } : sharedBooksWhere(viewer)],
        },
      }),
      viewer && !own
        ? db.friendship.findUnique({ where: { userAId_userBId: friendshipKey(viewer.id, user.id) } })
        : null,
    ])
    const relation = own
      ? 'self'
      : !friendship
        ? 'none'
        : friendship.status === 'ACCEPTED'
          ? 'friends'
          : friendship.requestedBy === viewer?.id
            ? 'request_sent'
            : 'request_received'
    return {
      id: user.id,
      username: user.username,
      avatarId: user.avatarId,
      bio: user.bio ?? '',
      memberSince: user.createdAt,
      bookCount,
      relation,
      showsFavorites: own || privacyOf(user, minor).showFavorites,
    }
  })

  app.get('/api/users/:username/books', async (request) => {
    const user = await findProfile(request)
    const viewer = viewerOf(request.auth)
    const query = pageQuerySchema.parse(request.query)
    const where: Prisma.BookWhereInput =
      viewer?.id === user.id
        ? { ownerId: user.id, deletedAt: null, status: 'SIGNED' }
        : { ownerId: user.id, AND: [sharedBooksWhere(viewer)] }
    return paginateBooks(db, { where, orderBy: [{ signedAt: 'desc' }] }, query, viewer?.id ?? null)
  })

  app.get('/api/users/:username/favorites', async (request) => {
    const user = await findProfile(request)
    const viewer = viewerOf(request.auth)
    const visible =
      viewer?.id === user.id || privacyOf(user, isMinor(user.birthDate, deps.now())).showFavorites
    if (!visible) throw new ApiError('NOT_FOUND')
    return favoritesOf(user.id, viewer)
  })

  app.get('/api/users/:username/copies', async (request) => {
    const user = await findProfile(request)
    const viewer = viewerOf(request.auth)
    const copies = await db.bookCopy.findMany({
      where: { ownerId: user.id, source: sharedBooksWhere(viewer) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { source: { include: { owner: OWNER_SELECT } } },
    })
    return {
      items: copies.map((copy) => ({
        id: copy.id,
        generation: copy.generation,
        createdAt: copy.createdAt,
        book: bookSummary(copy.source, viewer?.id ?? null),
      })),
    }
  })

  async function favoritesOf(userId: string, viewer: Viewer) {
    const favorites = await db.favorite.findMany({
      where: {
        userId,
        book:
          viewer?.id === userId
            ? { OR: [{ ownerId: userId, deletedAt: null }, sharedBooksWhere(viewer)] }
            : sharedBooksWhere(viewer),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { book: { include: { owner: OWNER_SELECT } } },
    })
    return { items: favorites.map((favorite) => bookSummary(favorite.book, viewer?.id ?? null)) }
  }

  // --- Likes e favoritos: idempotentes (PUT adiciona, DELETE remove) ---------------------------

  app.put('/api/books/:id/like', async (request) => {
    const auth = requireVerified(request)
    await limiter.consume('interact', auth.user.id)
    const book = await findInteractable(auth, (request.params as { id: string }).id)
    try {
      // O contador é atualizado na mesma transação da ação (§2.5)
      await db.$transaction([
        db.like.create({ data: { userId: auth.user.id, bookId: book.id } }),
        db.book.update({ where: { id: book.id }, data: { likeCount: { increment: 1 } } }),
      ])
      if (book.ownerId !== auth.user.id)
        await notifyGrouped(deps, book.ownerId, 'BOOK_LIKED', book, auth.user.username)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
    const fresh = await db.book.findUniqueOrThrow({ where: { id: book.id }, select: { likeCount: true } })
    return { liked: true, likeCount: fresh.likeCount }
  })

  app.delete('/api/books/:id/like', async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    await db.$transaction(async (tx) => {
      const removed = await tx.like.deleteMany({ where: { userId: auth.user.id, bookId: id } })
      if (removed.count === 1) await tx.book.update({ where: { id }, data: { likeCount: { decrement: 1 } } })
    })
    const fresh = await db.book.findUnique({ where: { id }, select: { likeCount: true } })
    return { liked: false, likeCount: fresh?.likeCount ?? 0 }
  })

  app.put('/api/books/:id/favorite', async (request) => {
    const auth = requireVerified(request)
    await limiter.consume('interact', auth.user.id)
    const book = await findInteractable(auth, (request.params as { id: string }).id)
    try {
      await db.$transaction([
        db.favorite.create({ data: { userId: auth.user.id, bookId: book.id } }),
        db.book.update({ where: { id: book.id }, data: { favoriteCount: { increment: 1 } } }),
      ])
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
    return { favorited: true }
  })

  app.delete('/api/books/:id/favorite', async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    await db.$transaction(async (tx) => {
      const removed = await tx.favorite.deleteMany({ where: { userId: auth.user.id, bookId: id } })
      if (removed.count === 1)
        await tx.book.update({ where: { id }, data: { favoriteCount: { decrement: 1 } } })
    })
    return { favorited: false }
  })

  app.get('/api/me/favorites', async (request) => {
    const auth = requireAuth(request)
    return favoritesOf(auth.user.id, viewerOf(auth))
  })

  // --- Comentários predefinidos --------------------------------------------------------------

  app.get('/api/books/:id/comments', async (request) => {
    const viewer = viewerOf(request.auth)
    const book = await findVisibleBook(db, viewer, (request.params as { id: string }).id, {})
    const comments = await db.comment.findMany({
      where: {
        bookId: book.id,
        // Comentários de quem bloqueou ou foi bloqueado não aparecem
        author: viewer
          ? { AND: [{ status: { in: ['ACTIVE', 'SUSPENDED'] } }, notBlockedWith(viewer.id)] }
          : { status: { in: ['ACTIVE', 'SUSPENDED'] } },
      },
      orderBy: { createdAt: 'asc' },
      take: 2000,
      include: { author: { select: { username: true } } },
    })
    return {
      enabled: book.allowComments,
      items: COMMENT_PRESETS.map((label, presetId) => {
        const own = comments.filter((comment) => comment.presetId === presetId)
        return {
          presetId,
          label,
          count: own.length,
          // Quem marcou (até 20 nomes, para o tooltip)
          users: own.slice(0, 20).map((comment) => comment.author.username),
          mine: own.find((comment) => comment.authorId === viewer?.id)?.id ?? null,
          // O dono do livro pode remover comentários
          ids:
            book.ownerId === viewer?.id
              ? own.map((comment) => ({ id: comment.id, username: comment.author.username }))
              : undefined,
        }
      }),
    }
  })

  app.put('/api/books/:id/comments/:presetId', async (request) => {
    const auth = requireVerified(request)
    await limiter.consume('interact', auth.user.id)
    const params = request.params as { id: string; presetId: string }
    const presetId = presetIdSchema.parse(params.presetId)
    const book = await findInteractable(auth, params.id)
    if (!book.allowComments)
      throw new ApiError('FORBIDDEN', { detail: 'Comments are turned off for this book.' })
    try {
      await db.comment.create({ data: { bookId: book.id, authorId: auth.user.id, presetId } })
      if (book.ownerId !== auth.user.id) {
        await notifyGrouped(deps, book.ownerId, 'BOOK_COMMENTED', book, auth.user.username)
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
    return { presetId, marked: true }
  })

  app.delete('/api/books/:id/comments/:presetId', async (request) => {
    const auth = requireAuth(request)
    const params = request.params as { id: string; presetId: string }
    const presetId = presetIdSchema.parse(params.presetId)
    if (!isUuid(params.id)) throw new ApiError('NOT_FOUND')
    await db.comment.deleteMany({ where: { bookId: params.id, authorId: auth.user.id, presetId } })
    return { presetId, marked: false }
  })

  // O autor do comentário ou o dono do livro
  app.delete('/api/comments/:id', async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    const removed = await db.comment.deleteMany({
      where: { id, OR: [{ authorId: auth.user.id }, { book: { ownerId: auth.user.id } }] },
    })
    if (removed.count === 0) throw new ApiError('NOT_FOUND')
    return { ok: true }
  })

  // --- Amizades ------------------------------------------------------------------------------

  app.get('/api/me/friends', async (request) => {
    const auth = requireAuth(request)
    const rows = await db.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ userAId: auth.user.id }, { userBId: auth.user.id }] },
      include: { userA: USER_CARD, userB: USER_CARD },
      orderBy: { acceptedAt: 'desc' },
    })
    return {
      items: rows.map((row) => {
        const friend = row.userAId === auth.user.id ? row.userB : row.userA
        return { username: friend.username, avatarId: friend.avatarId, since: row.acceptedAt }
      }),
    }
  })

  app.get('/api/me/friend-requests', async (request) => {
    const auth = requireAuth(request)
    const rows = await db.friendship.findMany({
      where: { status: 'PENDING', OR: [{ userAId: auth.user.id }, { userBId: auth.user.id }] },
      include: { userA: USER_CARD, userB: USER_CARD },
      orderBy: { createdAt: 'desc' },
    })
    const card = (row: (typeof rows)[number]) => {
      const other = row.userAId === auth.user.id ? row.userB : row.userA
      return {
        userId: other.id,
        username: other.username,
        avatarId: other.avatarId,
        createdAt: row.createdAt,
      }
    }
    return {
      received: rows.filter((row) => row.requestedBy !== auth.user.id).map(card),
      sent: rows.filter((row) => row.requestedBy === auth.user.id).map(card),
    }
  })

  app.post('/api/friend-requests', async (request, reply) => {
    const auth = requireVerified(request)
    await limiter.consume('friendRequests', auth.user.id)
    const { username } = friendRequestSchema.parse(request.body)
    const target = USERNAME_PATTERN.test(username)
      ? await db.user.findUnique({ where: { usernameLower: username.toLowerCase() } })
      : null
    // Usuário inexistente, inativo ou com bloqueio: a mesma resposta
    if (!target || target.status !== 'ACTIVE' || target.id === auth.user.id) throw new ApiError('NOT_FOUND')
    if (await isBlockedBetween(db, auth.user.id, target.id)) throw new ApiError('NOT_FOUND')

    const key = friendshipKey(auth.user.id, target.id)
    const existing = await db.friendship.findUnique({ where: { userAId_userBId: key } })
    if (existing?.status === 'ACCEPTED')
      throw new ApiError('CONFLICT', { detail: 'You are already friends.' })
    if (existing && existing.requestedBy === auth.user.id) {
      throw new ApiError('CONFLICT', { detail: 'You already sent a request.' })
    }
    // O outro já tinha pedido: aceitar é o que os dois querem
    if (existing) {
      await db.friendship.update({
        where: { userAId_userBId: key },
        data: { status: 'ACCEPTED', acceptedAt: deps.now() },
      })
      await notify(db, target.id, 'FRIEND_ACCEPTED', { username: auth.user.username })
      return reply.code(200).send({ status: 'ACCEPTED' })
    }

    // Quem pode enviar pedido: para 16–17 anos, só amigos de amigos (§7.3)
    const policy = privacyOf(target, isMinor(target.birthDate, deps.now())).friendRequestPolicy
    if (policy !== 'EVERYONE') {
      const mutual =
        policy === 'FRIENDS_OF_FRIENDS' &&
        (await db.user.count({ where: { AND: [friendOf(auth.user.id), friendOf(target.id)] } })) > 0
      if (!mutual) throw new ApiError('FORBIDDEN', { detail: "This user isn't accepting friend requests." })
    }
    const pending = await db.friendship.count({ where: { requestedBy: auth.user.id, status: 'PENDING' } })
    if (pending >= MAX_PENDING_REQUESTS) {
      throw new ApiError('LIMIT_REACHED', { detail: 'You have too many pending friend requests.' })
    }
    await db.friendship.create({ data: { ...key, requestedBy: auth.user.id } })
    await notify(db, target.id, 'FRIEND_REQUEST', { username: auth.user.username })
    return reply.code(201).send({ status: 'PENDING' })
  })

  /** Pedido pendente enviado por `userId` para quem está logado. */
  async function receivedRequest(auth: Auth, userId: unknown) {
    if (!isUuid(userId)) throw new ApiError('NOT_FOUND')
    const key = friendshipKey(auth.user.id, userId)
    const row = await db.friendship.findUnique({ where: { userAId_userBId: key } })
    if (!row || row.status !== 'PENDING' || row.requestedBy !== userId) throw new ApiError('NOT_FOUND')
    return key
  }

  app.post('/api/friend-requests/:userId/accept', async (request) => {
    const auth = requireVerified(request)
    const key = await receivedRequest(auth, (request.params as { userId: string }).userId)
    await db.friendship.update({
      where: { userAId_userBId: key },
      data: { status: 'ACCEPTED', acceptedAt: deps.now() },
    })
    const other = key.userAId === auth.user.id ? key.userBId : key.userAId
    await notify(db, other, 'FRIEND_ACCEPTED', { username: auth.user.username })
    return { status: 'ACCEPTED' }
  })

  app.post('/api/friend-requests/:userId/decline', async (request) => {
    const auth = requireAuth(request)
    const key = await receivedRequest(auth, (request.params as { userId: string }).userId)
    await db.friendship.delete({ where: { userAId_userBId: key } })
    return { ok: true }
  })

  // Desfaz a amizade ou cancela um pedido enviado
  app.delete('/api/friends/:username', async (request) => {
    const auth = requireAuth(request)
    const { username } = request.params as { username: string }
    const other = USERNAME_PATTERN.test(username)
      ? await db.user.findUnique({ where: { usernameLower: username.toLowerCase() }, select: { id: true } })
      : null
    if (!other) throw new ApiError('NOT_FOUND')
    const removed = await db.friendship.deleteMany({ where: friendshipKey(auth.user.id, other.id) })
    if (removed.count === 0) throw new ApiError('NOT_FOUND')
    return { ok: true }
  })

  // --- Bloqueios -----------------------------------------------------------------------------

  app.get('/api/me/blocks', async (request) => {
    const auth = requireAuth(request)
    const rows = await db.block.findMany({
      where: { blockerId: auth.user.id },
      include: { blocked: USER_CARD },
      orderBy: { createdAt: 'desc' },
    })
    return {
      items: rows.map((row) => ({
        username: row.blocked.username,
        avatarId: row.blocked.avatarId,
        since: row.createdAt,
      })),
    }
  })

  app.put('/api/blocks/:username', async (request) => {
    const auth = requireAuth(request)
    const { username } = request.params as { username: string }
    const target = USERNAME_PATTERN.test(username)
      ? await db.user.findUnique({ where: { usernameLower: username.toLowerCase() }, select: { id: true } })
      : null
    if (!target || target.id === auth.user.id) throw new ApiError('NOT_FOUND')
    const me = auth.user.id
    const them = target.id
    // Bloquear desfaz a amizade e os pedidos, e apaga as interações entre os dois (§3.7)
    await db.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId: me, blockedId: them } },
        create: { blockerId: me, blockedId: them },
        update: {},
      })
      await tx.friendship.deleteMany({ where: friendshipKey(me, them) })
      for (const [actor, owner] of [
        [me, them],
        [them, me],
      ] as const) {
        const likes = await tx.like.findMany({
          where: { userId: actor, book: { ownerId: owner } },
          select: { bookId: true },
        })
        const favorites = await tx.favorite.findMany({
          where: { userId: actor, book: { ownerId: owner } },
          select: { bookId: true },
        })
        await tx.like.deleteMany({ where: { userId: actor, book: { ownerId: owner } } })
        await tx.favorite.deleteMany({ where: { userId: actor, book: { ownerId: owner } } })
        await tx.comment.deleteMany({ where: { authorId: actor, book: { ownerId: owner } } })
        await tx.bookCopy.deleteMany({ where: { ownerId: actor, source: { ownerId: owner } } })
        if (likes.length > 0) {
          await tx.book.updateMany({
            where: { id: { in: likes.map((like) => like.bookId) } },
            data: { likeCount: { decrement: 1 } },
          })
        }
        if (favorites.length > 0) {
          await tx.book.updateMany({
            where: { id: { in: favorites.map((favorite) => favorite.bookId) } },
            data: { favoriteCount: { decrement: 1 } },
          })
        }
      }
    })
    return { blocked: true }
  })

  app.delete('/api/blocks/:username', async (request) => {
    const auth = requireAuth(request)
    const { username } = request.params as { username: string }
    const target = USERNAME_PATTERN.test(username)
      ? await db.user.findUnique({ where: { usernameLower: username.toLowerCase() }, select: { id: true } })
      : null
    if (!target) throw new ApiError('NOT_FOUND')
    await db.block.deleteMany({ where: { blockerId: auth.user.id, blockedId: target.id } })
    return { blocked: false }
  })

  // --- Feed e busca --------------------------------------------------------------------------

  app.get('/api/feed', async (request) => {
    const viewer = viewerOf(request.auth)
    const query = feedQuerySchema.parse(request.query)
    const { tab, ...page } = query
    const now = deps.now()
    const publicBooks: Prisma.BookWhereInput = {
      AND: [
        sharedBooksWhere(viewer),
        {
          visibility: 'PUBLIC',
          // Contas com menos de 72 horas ficam fora de "New" e "Trending" (§3.4)
          owner: { createdAt: { lt: new Date(now.getTime() - MODERATION.NEW_ACCOUNT_HOURS * HOUR) } },
        },
      ],
    }

    if (tab === 'friends') {
      const auth = requireAuth(request)
      return paginateBooks(
        db,
        {
          where: { AND: [sharedBooksWhere(viewer), { owner: friendOf(auth.user.id) }] },
          orderBy: [{ publishedAt: 'desc' }],
        },
        page,
        auth.user.id,
      )
    }
    if (tab === 'new') {
      return paginateBooks(
        db,
        { where: publicBooks, orderBy: [{ publishedAt: 'desc' }] },
        page,
        viewer?.id ?? null,
      )
    }

    // Trending: likes dos últimos 7 dias, cada um valendo menos com o tempo (meia-vida de 2 dias)
    const offset = page.cursor === undefined ? 0 : Number(page.cursor)
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new ApiError('VALIDATION_FAILED')
    const since = new Date(now.getTime() - 7 * DAY)
    const scores = await db.$queryRaw<{ id: string; score: number }[]>`
      SELECT l."bookId" AS id,
             SUM(power(0.5, extract(epoch FROM (${now}::timestamp - l."createdAt")) / 172800.0))::float8 AS score
      FROM "Like" l
      WHERE l."createdAt" > ${since}
      GROUP BY l."bookId"
      ORDER BY score DESC
      LIMIT 500`
    const visible = await db.book.findMany({
      where: { AND: [publicBooks, { id: { in: scores.map((row) => row.id) } }] },
      include: { owner: OWNER_SELECT },
    })
    const byId = new Map(visible.map((book) => [book.id, book]))
    const ranked = scores.flatMap((row) => byId.get(row.id) ?? [])
    const items = ranked.slice(offset, offset + page.limit)
    return {
      items: items.map((book) => bookSummary(book, viewer?.id ?? null)),
      nextCursor: ranked.length > offset + page.limit ? String(offset + page.limit) : null,
    }
  })

  app.get('/api/search', async (request) => {
    const viewer = viewerOf(request.auth)
    await limiter.consume('search', viewer?.id ?? request.ip)
    const { q } = searchQuerySchema.parse(request.query)
    const now = deps.now()
    // Só adultos aparecem na busca de usuários (§7.3)
    const adultBefore = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()))
    const [books, users] = await Promise.all([
      db.book.findMany({
        where: {
          AND: [
            sharedBooksWhere(viewer),
            { visibility: 'PUBLIC', title: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: [{ likeCount: 'desc' }, { publishedAt: 'desc' }],
        take: 20,
        include: { owner: OWNER_SELECT },
      }),
      db.user.findMany({
        where: {
          usernameLower: { contains: q.toLowerCase() },
          status: 'ACTIVE',
          searchable: true,
          birthDate: { lte: adultBefore },
          ...(viewer ? { AND: [notBlockedWith(viewer.id)] } : {}),
        },
        orderBy: { usernameLower: 'asc' },
        take: 20,
        select: { username: true, avatarId: true, bio: true },
      }),
    ])
    return {
      books: books.map((book) => bookSummary(book, viewer?.id ?? null)),
      users: users.map((user) => ({ username: user.username, avatarId: user.avatarId, bio: user.bio ?? '' })),
    }
  })

  // --- Notificações --------------------------------------------------------------------------

  app.get('/api/me/notifications', async (request) => {
    const auth = requireAuth(request)
    const [items, unread] = await Promise.all([
      db.notification.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      db.notification.count({ where: { userId: auth.user.id, readAt: null } }),
    ])
    return {
      unread,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        payload: item.payload,
        read: item.readAt !== null,
        createdAt: item.createdAt,
      })),
    }
  })

  app.post('/api/me/notifications/read', async (request) => {
    const auth = requireAuth(request)
    const { ids } = notificationsReadSchema.parse(request.body ?? {})
    await db.notification.updateMany({
      where: { userId: auth.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: deps.now() },
    })
    return { ok: true }
  })
}
