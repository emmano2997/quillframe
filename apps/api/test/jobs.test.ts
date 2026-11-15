// Jobs agendados (documento 02, §8.4) e retenção (§7.5 e §7.6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DAY } from '../src/context.ts'
import { cleanup, comingOfAge, expireStrikes, purgeAccounts, retention } from '../src/jobs/jobs.ts'
import { Client, PASSWORD, signedBook, signUp, testContext, type TestContext } from './helpers.ts'

let ctx: TestContext
beforeAll(async () => {
  ctx = await testContext()
})
afterAll(() => ctx.close())

describe('cleanup', () => {
  it('apaga sessões expiradas e tokens usados, e mantém os válidos', async () => {
    const user = await signUp(ctx)
    const other = await signUp(ctx)
    await ctx.db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - DAY) },
    })
    await cleanup(ctx.db, new Date())
    expect(await ctx.db.session.count({ where: { userId: user.id } })).toBe(0)
    expect(await ctx.db.session.count({ where: { userId: other.id } })).toBe(1)
    // O token de verificação já foi usado no cadastro
    expect(await ctx.db.emailToken.count({ where: { userId: user.id } })).toBe(0)
  })

  it('apaga de vez os livros excluídos há mais de 30 dias, inclusive os assinados', async () => {
    const user = await signUp(ctx)
    const id = await signedBook(user, { visibility: 'PUBLIC' })
    await user.client.delete(`/api/books/${id}`)
    expect((await user.client.get(`/api/books/${id}`)).statusCode).toBe(404)
    await cleanup(ctx.db, new Date())
    expect(await ctx.db.book.count({ where: { id } })).toBe(1)
    await cleanup(ctx.db, new Date(Date.now() + 31 * DAY))
    expect(await ctx.db.book.count({ where: { id } })).toBe(0)
    expect(await ctx.db.page.count({ where: { bookId: id } })).toBe(0)
  })
})

describe('purge-accounts', () => {
  it('depois de 30 dias apaga a conta e tudo dela, e reserva o username por 90 dias', async () => {
    const user = await signUp(ctx)
    const reader = await signUp(ctx)
    const id = await signedBook(user, { visibility: 'PUBLIC' })
    await reader.client.put(`/api/books/${id}/like`)
    await user.client.delete('/api/me', { username: user.username })

    await purgeAccounts(ctx.db, new Date(Date.now() + 29 * DAY))
    expect(await ctx.db.user.count({ where: { id: user.id } })).toBe(1)

    const result = await purgeAccounts(ctx.db, new Date(Date.now() + 31 * DAY))
    expect(result.accounts).toBeGreaterThanOrEqual(1)
    expect(await ctx.db.user.count({ where: { id: user.id } })).toBe(0)
    expect(await ctx.db.book.count({ where: { id } })).toBe(0)
    expect(await ctx.db.like.count({ where: { bookId: id } })).toBe(0)

    // Ninguém pode se cadastrar com o mesmo username enquanto ele estiver reservado
    const response = await new Client(ctx.app).post('/api/auth/register', {
      username: user.username,
      email: 'impostor@example.com',
      password: PASSWORD,
      birthDate: '1990-01-01',
      acceptTerms: true,
      turnstileToken: 't',
    })
    expect(response.json().fields).toEqual([{ field: 'username', message: 'This username is taken.' }])
    // O e-mail fica livre de novo
    expect(await ctx.db.user.count({ where: { email: user.email } })).toBe(0)
  })
})

describe('strikes, retention e coming-of-age', () => {
  it('expira strikes com mais de 90 dias', async () => {
    const user = await signUp(ctx)
    const action = await ctx.db.moderationAction.create({
      data: { targetType: 'USER', targetId: user.id, subjectId: user.id, type: 'STRIKE', reason: 'test' },
    })
    await ctx.db.strike.create({
      data: { userId: user.id, actionId: action.id, expiresAt: new Date(Date.now() + 90 * DAY) },
    })
    await expireStrikes(ctx.db, new Date(Date.now() + 89 * DAY))
    expect(await ctx.db.strike.count({ where: { userId: user.id } })).toBe(1)
    await expireStrikes(ctx.db, new Date(Date.now() + 91 * DAY))
    expect(await ctx.db.strike.count({ where: { userId: user.id } })).toBe(0)
  })

  it('apaga a auditoria com mais de 6 meses', async () => {
    const user = await signUp(ctx)
    expect(await ctx.db.auditLog.count({ where: { actorId: user.id } })).toBeGreaterThan(0)
    await retention(ctx.db, new Date(Date.now() + 100 * DAY))
    expect(await ctx.db.auditLog.count({ where: { actorId: user.id } })).toBeGreaterThan(0)
    await retention(ctx.db, new Date(Date.now() + 190 * DAY))
    expect(await ctx.db.auditLog.count({ where: { actorId: user.id } })).toBe(0)
  })

  it('avisa quem fez 18 anos, uma vez só', async () => {
    const today = new Date()
    const birthDate = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()))
    const user = await signUp(ctx)
    await ctx.db.user.update({ where: { id: user.id }, data: { birthDate } })
    await comingOfAge(ctx.db, today)
    await comingOfAge(ctx.db, today)
    expect(await ctx.db.notification.count({ where: { userId: user.id, type: 'PROTECTIONS_LIFTED' } })).toBe(
      1,
    )
    expect((await user.client.get('/api/me')).json().minor).toBe(false)
  })
})
