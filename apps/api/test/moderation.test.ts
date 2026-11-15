// Moderação de ponta a ponta: filtro, denúncia → decisão → notificação → recurso (documento 02, §6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DAY, MINUTE } from '../src/context.ts'
import {
  Client,
  PASSWORD,
  signedBook,
  signUp,
  signUpStaff,
  testContext,
  type TestContext,
  type TestUser,
} from './helpers.ts'

let ctx: TestContext
let moderator: TestUser
let admin: TestUser
beforeAll(async () => {
  ctx = await testContext()
  // Termos de teste; os de verdade ficam no banco de produção, fora do repositório
  await ctx.db.filterTerm.createMany({
    data: [
      { term: 'forbiddenword', severity: 'HIGH' },
      { term: 'rudeword', severity: 'MEDIUM' },
    ],
    skipDuplicates: true,
  })
  moderator = await signUpStaff(ctx, 'MODERATOR')
  admin = await signUpStaff(ctx, 'ADMIN')
})
afterAll(() => ctx.close())

/** Conta "confiável" para a ocultação automática: com mais de 7 dias. */
async function trusted() {
  const user = await signUp(ctx)
  await ctx.db.user.update({ where: { id: user.id }, data: { createdAt: new Date(Date.now() - 10 * DAY) } })
  return user
}

const act = (staff: TestUser, body: Record<string, unknown>) =>
  staff.client.post('/api/mod/actions', {
    guideline: '1-sexual-content',
    reason: 'Breaks the rules.',
    ...body,
  })

describe('filtro automático (§6.2)', () => {
  it('termo de alto risco, mesmo disfarçado, deixa o livro em revisão: só o autor o vê', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, {
      visibility: 'PUBLIC',
      pages: ['look: §cf§l o r b 1 d d e n w 0 r d!', 'F0RBIDDENWOOORD'],
    })
    const own = (await author.client.get(`/api/books/${id}`)).json()
    expect(own.reviewState).toBe('PENDING_REVIEW')
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(404)

    const queue = (await moderator.client.get('/api/mod/queue')).json()
    const entry = queue.items.find((item: { targetId: string }) => item.targetId === id)
    expect(entry).toMatchObject({ reasons: ['FILTER'], priority: 2, reviewState: 'PENDING_REVIEW' })

    // Aprovado pelo moderador, o livro aparece
    expect(
      (await act(moderator, { targetType: 'BOOK', targetId: id, type: 'DISMISS', guideline: undefined }))
        .statusCode,
    ).toBe(201)
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
  })

  it('termo de risco médio publica, mas entra na fila; texto limpo passa direto', async () => {
    const author = await signUp(ctx)
    const flagged = await signedBook(author, { visibility: 'PUBLIC', title: 'A rudeword tale' })
    const clean = await signedBook(author, { visibility: 'PUBLIC', pages: ['A classic story about grass.'] })
    expect((await new Client(ctx.app).get(`/api/books/${flagged}`)).statusCode).toBe(200)
    const ids = (await moderator.client.get('/api/mod/queue'))
      .json()
      .items.map((item: { targetId: string }) => item.targetId)
    expect(ids).toContain(flagged)
    expect(ids).not.toContain(clean)
  })

  it('livro privado não passa pelo filtro até ser compartilhado', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PRIVATE', pages: ['forbiddenword'] })
    expect((await author.client.get(`/api/books/${id}`)).json().reviewState).toBe('NONE')
    await author.client.patch(`/api/books/${id}/visibility`, { visibility: 'PUBLIC', acceptGuidelines: true })
    expect((await author.client.get(`/api/books/${id}`)).json().reviewState).toBe('PENDING_REVIEW')
  })

  it('username e bio com termo bloqueado são recusados na hora', async () => {
    const user = await signUp(ctx)
    const bio = await user.client.patch('/api/me/profile', { bio: 'I like f0rbiddenword a lot' })
    expect(bio.statusCode).toBe(422)
    expect(bio.json().detail).toBe("This name isn't allowed.")
    const register = await new Client(ctx.app).post('/api/auth/register', {
      username: 'Forbiddenword_9',
      email: 'someone-new@example.com',
      password: PASSWORD,
      birthDate: '1990-01-01',
      acceptTerms: true,
      turnstileToken: 't',
    })
    expect(register.json().code).toBe('NAME_NOT_ALLOWED')
  })
})

describe('denúncias (§6.3 e §6.4)', () => {
  it('uma por usuário por alvo, e nunca do próprio livro', async () => {
    const author = await signUp(ctx)
    const reporter = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    const body = {
      targetType: 'BOOK',
      targetId: id,
      reason: 'SPAM',
      pageIndex: 0,
      details: 'Looks like an ad.',
    }
    const first = await reporter.client.post('/api/reports', body)
    expect(first.statusCode).toBe(201)
    expect(first.json().message).toBe('Thanks for your report. Our moderators will review it.')
    expect((await reporter.client.post('/api/reports', body)).statusCode).toBe(409)
    expect((await author.client.post('/api/reports', body)).statusCode).toBe(404)
    expect(
      (await reporter.client.post('/api/reports', { ...body, reason: 'IMPERSONATION' })).statusCode,
    ).toBe(400)
    expect((await reporter.client.get('/api/me/reports')).json().items[0]).toMatchObject({
      reason: 'SPAM',
      status: 'OPEN',
    })
  })

  it('denúncias de contas novas entram na fila, mas não ocultam sozinhas', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    for (let index = 0; index < 4; index++) {
      const reporter = await signUp(ctx)
      await reporter.client.post('/api/reports', { targetType: 'BOOK', targetId: id, reason: 'MINOR_SAFETY' })
    }
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
    const entry = (await moderator.client.get('/api/mod/queue')).json().items[0]
    expect(entry).toMatchObject({ priority: 1 })
  })

  it('2 denúncias confiáveis de conteúdo sexual ocultam o livro até a revisão, e o autor é avisado', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC', title: 'Reported' })
    const body = { targetType: 'BOOK', targetId: id, reason: 'SEXUAL_CONTENT' }
    await (await trusted()).client.post('/api/reports', body)
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
    await (await trusted()).client.post('/api/reports', body)
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(404)

    const own = (await author.client.get(`/api/books/${id}`)).json()
    expect(own.reviewState).toBe('HIDDEN')
    expect(own.moderation).toMatchObject({ type: 'HIDE', automated: true })
    expect(own.moderation.reason).toBe('Your book is temporarily hidden while we review a report.')
    expect(ctx.mailer.last(author.email)?.text).toContain('Decision: Automated review')

    // Dismiss: as denúncias são encerradas e o livro volta
    await act(moderator, { targetType: 'BOOK', targetId: id, type: 'DISMISS', guideline: undefined })
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
  })

  it('quem foi denunciado nunca sabe quem denunciou', async () => {
    const author = await signUp(ctx)
    const reporter = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    await reporter.client.post('/api/reports', {
      targetType: 'BOOK',
      targetId: id,
      reason: 'HATE',
      details: 'secret details',
    })
    await act(moderator, { targetType: 'BOOK', targetId: id, type: 'REMOVE' })
    const seen = [
      (await author.client.get('/api/me/notifications')).body,
      (await author.client.get('/api/me/moderation')).body,
      (await author.client.get(`/api/books/${id}`)).body,
      ctx.mailer.last(author.email)?.text ?? '',
    ].join('\n')
    expect(seen).not.toContain(reporter.username)
    expect(seen).not.toContain('secret details')
  })
})

describe('painel e ações (§6.5 e §6.6)', () => {
  it('moderador sem 2FA não abre o painel', async () => {
    const staff = await signUp(ctx)
    await ctx.db.user.update({ where: { id: staff.id }, data: { role: 'MODERATOR' } })
    const response = await staff.client.get('/api/mod/queue')
    expect(response.statusCode).toBe(403)
    expect(response.json().code).toBe('MFA_SETUP_REQUIRED')
  })

  it('usuário comum não age: 404', async () => {
    const user = await signUp(ctx)
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    expect((await act(user, { targetType: 'BOOK', targetId: id, type: 'REMOVE' })).statusCode).toBe(404)
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
  })

  it('toda ação exige motivo e regra', async () => {
    const author = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    const noRule = await moderator.client.post('/api/mod/actions', {
      targetType: 'BOOK',
      targetId: id,
      type: 'REMOVE',
      reason: 'Bad.',
    })
    expect(noRule.statusCode).toBe(400)
    const noReason = await moderator.client.post('/api/mod/actions', {
      targetType: 'BOOK',
      targetId: id,
      type: 'REMOVE',
      guideline: '6-honesty',
      reason: '',
    })
    expect(noReason.statusCode).toBe(400)
  })

  it('denúncia → decisão → notificação → recurso → reversão', async () => {
    const author = await signUp(ctx)
    const reporter = await signUp(ctx)
    const id = await signedBook(author, { visibility: 'PUBLIC', title: 'Contested' })
    await reporter.client.post('/api/reports', {
      targetType: 'BOOK',
      targetId: id,
      reason: 'COPYRIGHT',
      pageIndex: 0,
    })

    // O moderador vê o detalhe com as denúncias e o histórico do autor
    const detail = (await moderator.client.get(`/api/mod/targets/book/${id}`)).json()
    expect(detail.reports[0]).toMatchObject({ reason: 'COPYRIGHT', reporter: reporter.username })
    expect(detail.subject).toMatchObject({ username: author.username, activeStrikes: 0 })

    const decision = await act(moderator, {
      targetType: 'BOOK',
      targetId: id,
      type: 'STRIKE',
      guideline: '7-creators',
      reason: 'This is not your work.',
    })
    expect(decision.statusCode).toBe(201)
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(404)

    // Quem denunciou recebe o resultado; o autor recebe a decisão com regra, autoria da decisão e recurso
    expect((await reporter.client.get('/api/me/notifications')).json().items[0]).toMatchObject({
      type: 'REPORT_RESOLVED',
      payload: { outcome: 'actioned' },
    })
    const notification = (await author.client.get('/api/me/notifications')).json().items[0]
    expect(notification).toMatchObject({
      type: 'MOD_DECISION',
      payload: { type: 'STRIKE', guideline: '7-creators', automated: false, title: 'Contested' },
    })
    const mail = ctx.mailer.last(author.email)
    expect(mail?.subject).toBe('A moderation decision about your account')
    expect(mail?.text).toContain('Rule: Respect creators')
    expect(mail?.text).toContain('Decision: Reviewed by a moderator')
    expect(mail?.text).toContain('appeal')

    const history = (await author.client.get('/api/me/moderation')).json()
    expect(history.activeStrikes).toBe(1)
    const actionId = history.items[0].id as string
    expect(history.items[0].canAppeal).toBe(true)

    // Recurso: um por decisão, só de quem sofreu a decisão
    expect(
      (await reporter.client.post('/api/appeals', { actionId, message: 'Let me appeal this for them.' }))
        .statusCode,
    ).toBe(404)
    const appeal = await author.client.post('/api/appeals', {
      actionId,
      message: 'I drew every page myself.',
    })
    expect(appeal.statusCode).toBe(201)
    expect(
      (await author.client.post('/api/appeals', { actionId, message: 'I drew every page myself.' }))
        .statusCode,
    ).toBe(409)

    const appeals = (await admin.client.get('/api/mod/appeals')).json().items
    const open = appeals.find((item: { action: { id: string } }) => item.action.id === actionId)
    const decided = await admin.client.post(`/api/mod/appeals/${open.id}/decide`, {
      status: 'REVERSED',
      reason: 'The author proved authorship.',
    })
    expect(decided.statusCode).toBe(200)
    expect(
      (await admin.client.post(`/api/mod/appeals/${open.id}/decide`, { status: 'UPHELD', reason: 'Again.' }))
        .statusCode,
    ).toBe(409)

    // Reversão: o livro volta e o strike sai
    expect((await new Client(ctx.app).get(`/api/books/${id}`)).statusCode).toBe(200)
    const after = (await author.client.get('/api/me/moderation')).json()
    expect(after.activeStrikes).toBe(0)
    expect(after.items[0].appeal.status).toBe('REVERSED')
    expect((await author.client.get('/api/me/notifications')).json().items[0]).toMatchObject({
      type: 'APPEAL_DECIDED',
      payload: { status: 'REVERSED' },
    })
  })

  it('strikes: 2 ativos suspendem por 3 dias; a conta suspensa lê, mas não publica nem interage', async () => {
    const author = await signUp(ctx)
    const first = await signedBook(author, { visibility: 'PUBLIC' })
    const second = await signedBook(author, { visibility: 'PUBLIC' })
    const kept = await signedBook(author, { visibility: 'PRIVATE' })
    await act(moderator, { targetType: 'BOOK', targetId: first, type: 'STRIKE' })
    expect((await author.client.get('/api/me')).json().status).toBe('ACTIVE')
    await act(moderator, { targetType: 'BOOK', targetId: second, type: 'STRIKE' })

    const me = (await author.client.get('/api/me')).json()
    expect(me.status).toBe('SUSPENDED')
    expect(new Date(me.suspendedUntil).getTime() - Date.now()).toBeGreaterThan(2.9 * DAY)
    expect((await author.client.get(`/api/books/${kept}`)).statusCode).toBe(200)
    expect((await author.client.get(`/api/books/${kept}/export`)).statusCode).toBe(200)
    const blocked = await author.client.post('/api/books')
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().code).toBe('ACCOUNT_SUSPENDED')

    // A suspensão acaba sozinha na data marcada; os strikes valem 90 dias
    ctx.clock.advance(3 * DAY + MINUTE)
    await author.client.post('/api/auth/login', { email: author.email, password: PASSWORD })
    expect((await author.client.get('/api/me')).json().status).toBe('ACTIVE')
    ctx.clock.advance(-(3 * DAY + MINUTE))
  })

  it('banir é só para admins e exige step-up; as sessões da pessoa caem', async () => {
    const target = await signUp(ctx)
    const ban = {
      targetType: 'USER',
      targetId: target.id,
      type: 'BAN',
      guideline: '6-honesty',
      reason: 'Spam bot.',
    }
    expect((await moderator.client.post('/api/mod/actions', ban)).statusCode).toBe(404)

    ctx.clock.advance(11 * MINUTE)
    const stale = await admin.client.post('/api/mod/actions', ban)
    ctx.clock.advance(-11 * MINUTE)
    expect(stale.json().code).toBe('REAUTH_REQUIRED')

    expect((await admin.client.post('/api/mod/actions', ban)).statusCode).toBe(201)
    expect((await target.client.get('/api/me')).statusCode).toBe(401)
    expect((await new Client(ctx.app).get(`/api/users/${target.username}`)).statusCode).toBe(404)
    // A auditoria registra a ação
    const logs = await ctx.db.auditLog.findMany({ where: { event: 'MOD_ACTION', targetId: target.id } })
    expect(logs).toHaveLength(1)
  })

  it('moderador não age sobre a equipe nem sobre si mesmo', async () => {
    const warn = { type: 'WARN', guideline: '3-respect', reason: 'Be nice.' }
    expect((await act(moderator, { ...warn, targetType: 'USER', targetId: admin.id })).statusCode).toBe(404)
    expect((await act(moderator, { ...warn, targetType: 'USER', targetId: moderator.id })).statusCode).toBe(
      403,
    )
  })

  it('denúncias de má-fé: 10 descartadas em 30 dias tiram o direito de denunciar', async () => {
    const reporter = await signUp(ctx)
    const author = await signUp(ctx)
    for (let index = 0; index < 10; index++) {
      const id = await signedBook(author, { visibility: 'PUBLIC' })
      await ctx.db.report.create({
        data: { reporterId: reporter.id, targetType: 'BOOK', targetId: id, reason: 'OTHER' },
      })
      await act(moderator, {
        targetType: 'BOOK',
        targetId: id,
        type: 'DISMISS',
        guideline: undefined,
        badFaith: true,
      })
    }
    const notifications = (await reporter.client.get('/api/me/notifications')).json().items
    expect(notifications.some((item: { type: string }) => item.type === 'REPORT_ABUSE_WARNING')).toBe(true)
    const id = await signedBook(author, { visibility: 'PUBLIC' })
    const response = await reporter.client.post('/api/reports', {
      targetType: 'BOOK',
      targetId: id,
      reason: 'OTHER',
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('canal público (§6.9) e administração', () => {
  it('a notificação só entra na fila depois de o e-mail ser confirmado', async () => {
    const visitor = new Client(ctx.app)
    const email = 'guardian@example.org'
    const sent = await visitor.post('/api/concerns', {
      name: 'Maria Silva',
      email,
      relation: 'guardian',
      contentUrl: 'https://quillframe.example/book/123',
      description: 'This book exposes my child. Please review it.',
      turnstileToken: 't',
    })
    expect(sent.statusCode).toBe(202)
    const before = (await moderator.client.get('/api/mod/concerns')).json().items
    expect(before.some((item: { email: string }) => item.email === email)).toBe(false)

    const token = ctx.mailer.lastToken(email)
    expect((await visitor.post('/api/concerns/confirm', { token })).statusCode).toBe(200)
    expect((await visitor.post('/api/concerns/confirm', { token })).statusCode).toBe(400)
    const after = (await moderator.client.get('/api/mod/concerns')).json().items
    const concern = after.find((item: { email: string }) => item.email === email)
    expect(concern).toMatchObject({ name: 'Maria Silva', status: 'OPEN' })
    expect(
      (await moderator.client.post(`/api/mod/concerns/${concern.id}/resolve`, { status: 'ACTIONED' }))
        .statusCode,
    ).toBe(200)
  })

  it('mudar o papel é só para admins, com step-up, e encerra as sessões da pessoa', async () => {
    const user = await signUp(ctx)
    expect(
      (await moderator.client.patch(`/api/admin/users/${user.id}/role`, { role: 'MODERATOR' })).statusCode,
    ).toBe(404)
    expect(
      (await admin.client.patch(`/api/admin/users/${user.id}/role`, { role: 'MODERATOR' })).statusCode,
    ).toBe(200)
    expect((await user.client.get('/api/me')).statusCode).toBe(401)
    expect((await admin.client.patch(`/api/admin/users/${admin.id}/role`, { role: 'USER' })).statusCode).toBe(
      403,
    )

    const audit = (await admin.client.get('/api/admin/audit?event=ROLE_CHANGED')).json()
    expect(audit.items[0]).toMatchObject({ event: 'ROLE_CHANGED', actor: admin.username, targetId: user.id })
    expect((await moderator.client.get('/api/admin/audit')).statusCode).toBe(404)
  })

  it('admins editam os termos do filtro', async () => {
    const saved = await admin.client.put('/api/admin/filter-terms', {
      term: 'B4d Phr4se',
      severity: 'MEDIUM',
    })
    expect(saved.json()).toEqual({ term: 'bad phrase', severity: 'MEDIUM' })
    const terms = (await admin.client.get('/api/admin/filter-terms')).json().items
    expect(terms.map((item: { term: string }) => item.term)).toContain('bad phrase')
    expect((await admin.client.delete('/api/admin/filter-terms', { term: 'bad phrase' })).statusCode).toBe(
      200,
    )
  })
})
