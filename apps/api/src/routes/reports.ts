// Denúncias, histórico de moderação do usuário, recursos e o canal público do ECA Digital
// (documento 02, §6.3, §6.4, §6.7 e §6.9).
import {
  appealSchema,
  concernSchema,
  MODERATION,
  REPORT_REASONS,
  reportSchema,
  verifyEmailSchema,
} from '@quillframe/shared'
import type { FastifyInstance } from 'fastify'
import { findVisibleBook } from '../authz/books.ts'
import { DAY, type Deps } from '../context.ts'
import { ApiError } from '../http/problem.ts'
import { audit, requireAuth, requireVerified } from '../http/session.ts'
import { hashToken, randomToken } from '../security/tokens.ts'
import { isUniqueViolation } from '../services/accounts.ts'
import { APPEALABLE, applyAction, badFaithCount, isTrustedReporter } from '../services/moderation.ts'
import { viewerOf } from './books.ts'

const CONCERN_TOKEN_MS = DAY

export function registerReportRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps

  const alertAdmins = async (what: string) => {
    if (deps.config.ADMIN_ALERT_EMAIL) {
      await deps.mailer.send(deps.mails.adminAlert(deps.config.ADMIN_ALERT_EMAIL, what))
    }
  }

  app.post('/api/reports', async (request, reply) => {
    const auth = requireVerified(request)
    await deps.limiter.consume('reports', auth.user.id)
    const body = reportSchema.parse(request.body)
    // 10 denúncias descartadas por má-fé em 30 dias tiram o direito de denunciar (§6.8)
    if ((await badFaithCount(deps, auth.user.id)) >= MODERATION.BAD_FAITH_BLOCK) {
      throw new ApiError('FORBIDDEN', { detail: "You can't send reports right now." })
    }

    if (body.targetType === 'BOOK') {
      const book = await findVisibleBook(db, viewerOf(auth), body.targetId, {})
      if (book.status !== 'SIGNED' || book.ownerId === auth.user.id) throw new ApiError('NOT_FOUND')
      if (body.pageIndex !== undefined && body.pageIndex >= book.pageCount)
        throw new ApiError('VALIDATION_FAILED')
    } else {
      const user = await db.user.findUnique({
        where: { id: body.targetId },
        select: { id: true, status: true },
      })
      if (!user || user.id === auth.user.id || user.status === 'PENDING_DELETION')
        throw new ApiError('NOT_FOUND')
    }

    try {
      await db.report.create({
        data: {
          reporterId: auth.user.id,
          targetType: body.targetType,
          targetId: body.targetId,
          reason: body.reason,
          pageIndex: body.pageIndex ?? null,
          details: body.details || null,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('CONFLICT', { detail: 'You already reported this.' })
      throw error
    }
    await audit(deps, request, 'REPORT_CREATED', { targetId: body.targetId, meta: { reason: body.reason } })
    if (body.reason === 'MINOR_SAFETY') await alertAdmins('New child safety report')

    // Ocultação automática até a revisão, só com denúncias de contas confiáveis (§6.4)
    if (body.targetType === 'BOOK') {
      const open = await db.report.findMany({
        where: { targetType: 'BOOK', targetId: body.targetId, status: 'OPEN', reason: body.reason },
        include: { reporter: { select: { id: true, createdAt: true } } },
      })
      let trusted = 0
      for (const report of open) if (await isTrustedReporter(deps, report.reporter)) trusted++
      const book = await db.book.findUnique({ where: { id: body.targetId }, select: { reviewState: true } })
      if (trusted >= REPORT_REASONS[body.reason].autoHideAt && book?.reviewState === 'NONE') {
        // Ação automática: as denúncias continuam abertas, para um moderador decidir
        await applyAction(deps, {
          moderatorId: null,
          targetType: 'BOOK',
          targetId: body.targetId,
          type: 'HIDE',
          reason: 'Your book is temporarily hidden while we review a report.',
          keepReportsOpen: true,
        })
      }
    }
    return reply.code(201).send({ message: 'Thanks for your report. Our moderators will review it.' })
  })

  app.get('/api/me/reports', async (request) => {
    const auth = requireAuth(request)
    const reports = await db.report.findMany({
      where: { reporterId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return {
      items: reports.map((report) => ({
        id: report.id,
        targetType: report.targetType,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        resolvedAt: report.resolvedAt,
      })),
    }
  })

  // Avisos, strikes e decisões sobre mim. Contas suspensas e banidas também acessam, para recorrer.
  app.get('/api/me/moderation', async (request) => {
    const auth = requireAuth(request)
    const now = deps.now()
    const actions = await db.moderationAction.findMany({
      where: { subjectId: auth.user.id, type: { in: [...APPEALABLE] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { strike: true, appeal: true },
    })
    const bookIds = actions.filter((action) => action.targetType === 'BOOK').map((action) => action.targetId)
    const books = await db.book.findMany({
      where: { id: { in: bookIds } },
      select: { id: true, title: true },
    })
    const titles = new Map(books.map((book) => [book.id, book.title]))
    return {
      activeStrikes: actions.filter((action) => action.strike && action.strike.expiresAt > now).length,
      items: actions.map((action) => ({
        id: action.id,
        type: action.type,
        targetType: action.targetType,
        bookId: action.targetType === 'BOOK' ? action.targetId : null,
        title: titles.get(action.targetId) ?? null,
        guideline: action.guideline,
        reason: action.reason,
        automated: action.automated,
        createdAt: action.createdAt,
        strikeExpiresAt: action.strike?.expiresAt ?? null,
        canAppeal:
          !action.appeal && now.getTime() - action.createdAt.getTime() < MODERATION.APPEAL_DAYS * DAY,
        appeal: action.appeal
          ? {
              status: action.appeal.status,
              message: action.appeal.message,
              decisionReason: action.appeal.decisionReason,
              createdAt: action.appeal.createdAt,
              decidedAt: action.appeal.decidedAt,
            }
          : null,
      })),
    }
  })

  app.post('/api/appeals', async (request, reply) => {
    const auth = requireAuth(request)
    await deps.limiter.consume('appeals', auth.user.id)
    const body = appealSchema.parse(request.body)
    const action = await db.moderationAction.findUnique({ where: { id: body.actionId } })
    // Só quem sofreu a decisão recorre, uma vez, em até 30 dias (§6.7)
    if (!action || action.subjectId !== auth.user.id || !APPEALABLE.includes(action.type)) {
      throw new ApiError('NOT_FOUND')
    }
    if (deps.now().getTime() - action.createdAt.getTime() >= MODERATION.APPEAL_DAYS * DAY) {
      throw new ApiError('FORBIDDEN', { detail: 'The time to appeal this decision has passed.' })
    }
    try {
      await db.appeal.create({ data: { userId: auth.user.id, actionId: action.id, message: body.message } })
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ApiError('CONFLICT', { detail: 'You already appealed this decision.' })
      throw error
    }
    await audit(deps, request, 'APPEAL_CREATED', { targetId: action.id })
    return reply.code(201).send({ status: 'OPEN' })
  })

  // --- Canal público (ECA Digital, art. 29): sem conta, mas identificado ----------------------

  app.post('/api/concerns', async (request, reply) => {
    await deps.limiter.consume('concerns', request.ip)
    const body = concernSchema.parse(request.body)
    await deps.turnstile.verify(body.turnstileToken, request.ip)
    const token = randomToken()
    await db.concernNotice.create({
      data: {
        name: body.name,
        email: body.email,
        relation: body.relation,
        contentUrl: body.contentUrl,
        description: body.description,
        tokenHash: hashToken(token),
      },
    })
    // A notificação só entra na fila depois de o e-mail ser confirmado
    await deps.mailer.send(deps.mails.confirmConcern(body.email, token))
    return reply.code(202).send({ message: 'Check your email to confirm your report.' })
  })

  app.post('/api/concerns/confirm', async (request) => {
    await deps.limiter.consume('verifyToken', request.ip)
    const { token } = verifyEmailSchema.parse(request.body)
    const now = deps.now()
    const confirmed = await db.concernNotice.updateMany({
      where: {
        tokenHash: hashToken(token),
        confirmedAt: null,
        createdAt: { gt: new Date(now.getTime() - CONCERN_TOKEN_MS) },
      },
      data: { confirmedAt: now },
    })
    if (confirmed.count !== 1) {
      throw new ApiError('VALIDATION_FAILED', { detail: 'This link is invalid or has expired.' })
    }
    await alertAdmins('New public concern notice (ECA Digital, art. 29)')
    return { confirmed: true }
  })
}
