// Rede social: amizades, bloqueios, likes, favoritos, comentários, feed, busca e notificações
// (documento 02, §3.7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DAY } from '../src/context.ts'
import { befriend, Client, signedBook, signUp, testContext, uniqueName, type TestContext } from './helpers.ts'

let ctx: TestContext
beforeAll(async () => {
  ctx = await testContext()
})
afterAll(() => ctx.close())

/** Conta com mais de 72 horas (as novas ficam fora de "New" e "Trending"). */
async function seasoned(options: Parameters<typeof signUp>[1] = {}) {
  const user = await signUp(ctx, options)
  await ctx.db.user.update({ where: { id: user.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } })
  return user
}

describe('amizades', () => {
  it('pedido → aceite, com notificações dos dois lados', async () => {
    const a = await signUp(ctx)
    const b = await signUp(ctx)
    expect((await a.client.post('/api/friend-requests', { username: b.username })).statusCode).toBe(201)
    expect((await a.client.post('/api/friend-requests', { username: b.username })).statusCode).toBe(409)
    expect((await a.client.get(`/api/users/${b.username}`)).json().relation).toBe('request_sent')
    expect((await b.client.get(`/api/users/${a.username}`)).json().relation).toBe('request_received')

    const requests = (await b.client.get('/api/me/friend-requests')).json()
    expect(requests.received.map((item: { username: string }) => item.username)).toEqual([a.username])
    expect((await b.client.get('/api/me/notifications')).json().items[0]).toMatchObject({
      type: 'FRIEND_REQUEST',
      read: false,
    })

    expect((await b.client.post(`/api/friend-requests/${a.id}/accept`)).statusCode).toBe(200)
    expect((await a.client.get('/api/me/friends')).json().items[0].username).toBe(b.username)
    expect((await a.client.get('/api/me/notifications')).json().items[0].type).toBe('FRIEND_ACCEPTED')

    expect((await a.client.delete(`/api/friends/${b.username}`)).statusCode).toBe(200)
    expect((await b.client.get('/api/me/friends')).json().items).toEqual([])
  })

  it('só quem recebeu o pedido pode aceitar', async () => {
    const a = await signUp(ctx)
    const b = await signUp(ctx)
    await a.client.post('/api/friend-requests', { username: b.username })
    expect((await a.client.post(`/api/friend-requests/${b.id}/accept`)).statusCode).toBe(404)
  })

  it('sem e-mail verificado não envia pedidos', async () => {
    const a = await signUp(ctx, { verify: false })
    const b = await signUp(ctx)
    const response = await a.client.post('/api/friend-requests', { username: b.username })
    expect(response.json().code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('16 e 17 anos só recebem pedidos de amigos de amigos', async () => {
    const year = new Date().getUTCFullYear() - 17
    const teen = await signUp(ctx, { birthDate: `${year}-01-01` })
    const stranger = await signUp(ctx)
    const mutual = await signUp(ctx)
    expect((await stranger.client.post('/api/friend-requests', { username: teen.username })).statusCode).toBe(
      403,
    )
    // O adolescente pode pedir; depois disso, um amigo desse amigo consegue enviar
    await befriend(teen, mutual)
    await befriend(stranger, mutual)
    expect((await stranger.client.post('/api/friend-requests', { username: teen.username })).statusCode).toBe(
      201,
    )
  })
})

describe('bloqueios', () => {
  it('bloquear desfaz a amizade, esconde o conteúdo dos dois lados e impede interações', async () => {
    const a = await signUp(ctx)
    const b = await signUp(ctx)
    await befriend(a, b)
    const bookOfA = await signedBook(a, { visibility: 'PUBLIC' })
    const bookOfB = await signedBook(b, { visibility: 'FRIENDS' })
    await b.client.put(`/api/books/${bookOfA}/like`)
    await b.client.put(`/api/books/${bookOfA}/comments/2`)
    expect((await a.client.get(`/api/books/${bookOfA}`)).json().likeCount).toBe(1)

    expect((await a.client.put(`/api/blocks/${b.username}`)).json()).toEqual({ blocked: true })
    expect((await a.client.get('/api/me/friends')).json().items).toEqual([])
    expect((await a.client.get('/api/me/blocks')).json().items[0].username).toBe(b.username)

    // Nenhum dos dois vê o outro: livros, perfil, comentários
    expect((await b.client.get(`/api/books/${bookOfA}`)).statusCode).toBe(404)
    expect((await a.client.get(`/api/books/${bookOfB}`)).statusCode).toBe(404)
    expect((await b.client.get(`/api/users/${a.username}`)).statusCode).toBe(404)
    expect((await a.client.get(`/api/users/${b.username}`)).statusCode).toBe(404)

    // As interações antigas somem, e as novas não passam
    expect((await a.client.get(`/api/books/${bookOfA}`)).json().likeCount).toBe(0)
    expect((await a.client.get(`/api/books/${bookOfA}/comments`)).json().items[2].count).toBe(0)
    expect((await b.client.put(`/api/books/${bookOfA}/like`)).statusCode).toBe(404)
    expect((await b.client.post(`/api/books/${bookOfA}/copy`)).statusCode).toBe(404)
    expect((await b.client.post('/api/friend-requests', { username: a.username })).statusCode).toBe(404)
    expect(
      (await b.client.post('/api/reports', { targetType: 'BOOK', targetId: bookOfA, reason: 'SPAM' }))
        .statusCode,
    ).toBe(404)

    await a.client.delete(`/api/blocks/${b.username}`)
    expect((await b.client.get(`/api/books/${bookOfA}`)).statusCode).toBe(200)
  })
})

describe('likes, favoritos e comentários', () => {
  it('são idempotentes e mantêm os contadores', async () => {
    const author = await signUp(ctx)
    const reader = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC', title: 'Counted' })

    expect((await reader.client.put(`/api/books/${id}/like`)).json()).toEqual({ liked: true, likeCount: 1 })
    expect((await reader.client.put(`/api/books/${id}/like`)).json()).toEqual({ liked: true, likeCount: 1 })
    await reader.client.put(`/api/books/${id}/favorite`)
    await reader.client.put(`/api/books/${id}/favorite`)
    const book = (await reader.client.get(`/api/books/${id}`)).json()
    expect(book).toMatchObject({ likeCount: 1, favoriteCount: 1, viewer: { liked: true, favorited: true } })
    expect((await reader.client.get('/api/me/favorites')).json().items[0].id).toBe(id)

    expect((await reader.client.delete(`/api/books/${id}/like`)).json()).toEqual({
      liked: false,
      likeCount: 0,
    })
    expect((await reader.client.delete(`/api/books/${id}/like`)).json()).toEqual({
      liked: false,
      likeCount: 0,
    })
    await reader.client.delete(`/api/books/${id}/favorite`)
    expect((await reader.client.get(`/api/books/${id}`)).json().favoriteCount).toBe(0)
  })

  it('likes são agrupados numa notificação só', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC', title: 'Popular' })
    for (let reader = 0; reader < 3; reader++) await (await signUp(ctx)).client.put(`/api/books/${id}/like`)
    const liked = (await author.client.get('/api/me/notifications')).json()
    const likes = liked.items.filter((item: { type: string }) => item.type === 'BOOK_LIKED')
    expect(likes).toHaveLength(1)
    expect(likes[0].payload).toMatchObject({ count: 3, title: 'Popular' })
    expect(liked.unread).toBe(1)

    await author.client.post('/api/me/notifications/read')
    expect((await author.client.get('/api/me/notifications')).json().unread).toBe(0)
  })

  it('comentários são só os predefinidos, um de cada por usuário', async () => {
    const author = await signUp(ctx)
    const reader = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    expect((await reader.client.put(`/api/books/${id}/comments/0`)).statusCode).toBe(200)
    expect((await reader.client.put(`/api/books/${id}/comments/0`)).statusCode).toBe(200)
    expect((await reader.client.put(`/api/books/${id}/comments/99`)).statusCode).toBe(400)
    // Não existe campo de texto livre
    expect((await reader.client.put(`/api/books/${id}/comments/1`, { text: 'free text' })).statusCode).toBe(
      200,
    )

    const comments = (await new Client(ctx.app).get(`/api/books/${id}/comments`)).json()
    expect(comments.items[0]).toMatchObject({ label: 'Amazing!', count: 1, users: [reader.username] })
    expect(comments.items).toHaveLength(12)

    // O dono remove um comentário do próprio livro e pode desligá-los
    const mine = (await author.client.get(`/api/books/${id}/comments`)).json().items[0].ids[0].id
    expect((await author.client.delete(`/api/comments/${mine}`)).statusCode).toBe(200)
    await author.client.patch(`/api/books/${id}`, { allowComments: false })
    expect((await reader.client.put(`/api/books/${id}/comments/3`)).statusCode).toBe(403)
  })

  it('visitante lê livros públicos, mas não interage', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    const visitor = new Client(ctx.app)
    expect((await visitor.get(`/api/books/${id}`)).statusCode).toBe(200)
    expect((await visitor.put(`/api/books/${id}/like`)).statusCode).toBe(401)
  })
})

describe('feed e busca', () => {
  it('"New" lista livros públicos, sem contas com menos de 72 horas', async () => {
    const old = await seasoned()
    const fresh = await signUp(ctx)
    const fromOld = await signedBook(old, { visibility: 'PUBLIC' })
    const fromFresh = await signedBook(fresh, { visibility: 'PUBLIC' })
    const privateBook = await signedBook(old, { visibility: 'PRIVATE' })

    const feed = (await new Client(ctx.app).get('/api/feed?tab=new&limit=50')).json()
    const ids = feed.items.map((book: { id: string }) => book.id)
    expect(ids).toContain(fromOld)
    expect(ids).not.toContain(fromFresh)
    expect(ids).not.toContain(privateBook)
    // O livro da conta nova continua acessível pelo link e pelo perfil
    expect((await new Client(ctx.app).get(`/api/books/${fromFresh}`)).statusCode).toBe(200)
  })

  it('pagina por cursor', async () => {
    const author = await seasoned()
    for (let index = 0; index < 3; index++) await signedBook(author, { visibility: 'PUBLIC' })
    const first = (await author.client.get(`/api/users/${author.username}/books?limit=2`)).json()
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    const second = (
      await author.client.get(`/api/users/${author.username}/books?limit=2&cursor=${first.nextCursor}`)
    ).json()
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect((await author.client.get('/api/feed?limit=500')).statusCode).toBe(400)
  })

  it('"Trending" ordena pelos likes recentes e "Friends" exige login', async () => {
    const author = await seasoned()
    const quiet = await signedBook(author, { visibility: 'PUBLIC' })
    const loud = await signedBook(author, { visibility: 'PUBLIC' })
    for (let reader = 0; reader < 2; reader++) await (await signUp(ctx)).client.put(`/api/books/${loud}/like`)
    await (await signUp(ctx)).client.put(`/api/books/${quiet}/like`)

    const trending = (await new Client(ctx.app).get('/api/feed?tab=trending&limit=50')).json()
    const ids = trending.items.map((book: { id: string }) => book.id)
    expect(ids.indexOf(loud)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(loud)).toBeLessThan(ids.indexOf(quiet))

    expect((await new Client(ctx.app).get('/api/feed?tab=friends')).statusCode).toBe(401)
    const friend = await signUp(ctx)
    await befriend(friend, author)
    const friendsOnly = await signedBook(author, { visibility: 'FRIENDS' })
    const friendsFeed = (await friend.client.get('/api/feed?tab=friends&limit=50')).json()
    expect(friendsFeed.items.map((book: { id: string }) => book.id)).toContain(friendsOnly)
  })

  it('busca títulos e usernames; adolescentes e quem desligou a busca não aparecem', async () => {
    const tag = uniqueName('zq')
    const adult = await signUp(ctx, { username: `${tag.slice(0, 10)}_a` })
    const hidden = await signUp(ctx, { username: `${tag.slice(0, 10)}_h` })
    const year = new Date().getUTCFullYear() - 17
    const teen = await signUp(ctx, { username: `${tag.slice(0, 10)}_t`, birthDate: `${year}-01-01` })
    await hidden.client.patch('/api/me/privacy', { searchable: false })
    const id = await signedBook(adult, { visibility: 'PUBLIC', title: `The ${tag} Chronicles` })
    await signedBook(adult, { visibility: 'PRIVATE', title: `Secret ${tag}` })

    const results = (await new Client(ctx.app).get(`/api/search?q=${tag.slice(0, 10).toUpperCase()}`)).json()
    expect(results.books.map((book: { id: string }) => book.id)).toEqual([id])
    expect(results.users.map((user: { username: string }) => user.username)).toEqual([adult.username])
    expect(teen.username).not.toBe(adult.username)

    expect((await new Client(ctx.app).get('/api/search?q=a')).statusCode).toBe(400)
    // Tentativa de injeção vira só um texto de busca
    const injection = await new Client(ctx.app).get(`/api/search?q=${encodeURIComponent("' OR 1=1 --")}`)
    expect(injection.statusCode).toBe(200)
    expect(injection.json().books).toEqual([])
  })

  it('favoritos do perfil são privados por padrão', async () => {
    const user = await signUp(ctx)
    const other = await signUp(ctx)
    expect((await other.client.get(`/api/users/${user.username}/favorites`)).statusCode).toBe(404)
    await user.client.patch('/api/me/privacy', { showFavorites: true })
    expect((await other.client.get(`/api/users/${user.username}/favorites`)).statusCode).toBe(200)
  })
})
