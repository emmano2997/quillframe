// Painel de moderação (documento 02, §6.5). Para quem não é da equipe, estas rotas respondem 404.
import {
  appealDecisionSchema,
  modActionSchema,
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
} from '@quillframe/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isUuid } from '../authz/books.ts'
import type { Deps } from '../context.ts'
import { ApiError } from '../http/problem.ts'
import { audit, requireReauth, requireStaff } from '../http/session.ts'
import { notify } from '../services/books.ts'
import { applyAction, reverseAction } from '../services/moderation.ts'

const FILTER_PRIORITY = { HIGH: 2, MEDIUM: 4 } as const

const concernResolveSchema = z.object({ status: z.enum(['ACTIONED', 'DISMISSED']) }).strict()

interface QueueEntry {
  targetType: ReportTarget
  targetId: string
  priority: number
  reasons: string[]
  reportCount: number
  oldest: Date
  label: string
  owner: string | null
  reviewState: string | null
}

export function registerModerationRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps

  /** Título e dono (ou username) de cada alvo, para a fila. */
  async function describeTargets(keys: { targetType: ReportTarget; targetId: string }[]) {
    const bookIds = keys.filter((key) => key.targetType === 'BOOK').map((key) => key.targetId)
    const userIds = keys.filter((key) => key.targetType === 'USER').map((key) => key.targetId)
    const [books, users] = await Promise.all([
      db.book.findMany({
        where: { id: { in: bookIds } },
        select: { id: true, title: true, reviewState: true, owner: { select: { username: true } } },
      }),
      db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, status: true },
      }),
    ])
    const map = new Map<string, { label: string; owner: string | null; reviewState: string | null }>()
    for (const book of books) {
      map.set(book.id, { label: book.title, owner: book.owner.username, reviewState: book.reviewState })
    }
    for (const user of users)
      map.set(user.id, { label: user.username, owner: null, reviewState: user.status })
    return map
  }

  // Fila por prioridade e idade, agrupando as denúncias do mesmo alvo
  app.get('/api/mod/queue', async (request) => {
    requireStaff(request, 'MODERATOR')
    const [reports, flagged] = await Promise.all([
      db.report.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 2000 }),
      db.book.findMany({
        where: { deletedAt: null, status: 'SIGNED', filterFlag: { not: null } },
        select: { id: true, filterFlag: true, publishedAt: true, signedAt: true },
        take: 500,
      }),
    ])
    const groups = new Map<string, Omit<QueueEntry, 'label' | 'owner' | 'reviewState'>>()
    for (const report of reports) {
      const key = `${report.targetType}:${report.targetId}`
      const priority = REPORT_REASONS[report.reason as ReportReason].priority
      const group = groups.get(key)
      if (group) {
        group.priority = Math.min(group.priority, priority)
        group.reportCount++
        if (!group.reasons.includes(report.reason)) group.reasons.push(report.reason)
      } else {
        groups.set(key, {
          targetType: report.targetType,
          targetId: report.targetId,
          priority,
          reasons: [report.reason],
          reportCount: 1,
          oldest: report.createdAt,
        })
      }
    }
    // Livros que o filtro automático acusou também esperam conferência (§6.2)
    for (const book of flagged) {
      const key = `BOOK:${book.id}`
      const priority = FILTER_PRIORITY[book.filterFlag ?? 'MEDIUM']
      const group = groups.get(key)
      if (group) {
        group.priority = Math.min(group.priority, priority)
        group.reasons.push('FILTER')
      } else {
        groups.set(key, {
          targetType: 'BOOK',
          targetId: book.id,
          priority,
          reasons: ['FILTER'],
          reportCount: 0,
          oldest: book.publishedAt ?? book.signedAt ?? deps.now(),
        })
      }
    }
    const entries = [...groups.values()]
    const info = await describeTargets(entries)
    const items: QueueEntry[] = entries
      .flatMap((entry) => {
        const target = info.get(entry.targetId)
        return target ? [{ ...entry, ...target }] : []
      })
      .sort((a, b) => a.priority - b.priority || a.oldest.getTime() - b.oldest.getTime())
    return { items }
  })

  /** Detalhe de um alvo: as denúncias com os detalhes e o histórico do autor. */
  async function targetDetail(targetType: ReportTarget, targetId: string) {
    const [reports, info] = await Promise.all([
      db.report.findMany({
        where: { targetType, targetId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { reporter: { select: { username: true } } },
      }),
      describeTargets([{ targetType, targetId }]),
    ])
    const target = info.get(targetId)
    if (!target) throw new ApiError('NOT_FOUND')
    const subject =
      targetType === 'BOOK'
        ? await db.user.findFirst({ where: { books: { some: { id: targetId } } } })
        : await db.user.findUnique({ where: { id: targetId } })
    if (!subject) throw new ApiError('NOT_FOUND')
    const [history, activeStrikes] = await Promise.all([
      db.moderationAction.findMany({
        where: { subjectId: subject.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.strike.count({ where: { userId: subject.id, expiresAt: { gt: deps.now() } } }),
    ])
    return {
      targetType,
      targetId,
      ...target,
      subject: {
        id: subject.id,
        username: subject.username,
        status: subject.status,
        role: subject.role,
        suspendedUntil: subject.suspendedUntil,
        memberSince: subject.createdAt,
        activeStrikes,
      },
      reports: reports.map((report) => ({
        id: report.id,
        reason: report.reason,
        pageIndex: report.pageIndex,
        details: report.details,
        status: report.status,
        reporter: report.reporter.username,
        createdAt: report.createdAt,
      })),
      history: history.map((action) => ({
        id: action.id,
        type: action.type,
        targetType: action.targetType,
        guideline: action.guideline,
        reason: action.reason,
        automated: action.automated,
        createdAt: action.createdAt,
      })),
    }
  }

  app.get('/api/mod/reports/:id', async (request) => {
    requireStaff(request, 'MODERATOR')
    const { id } = request.params as { id: string }
    const report = isUuid(id) ? await db.report.findUnique({ where: { id } }) : null
    if (!report) throw new ApiError('NOT_FOUND')
    return targetDetail(report.targetType, report.targetId)
  })

  app.get('/api/mod/targets/:type/:id', async (request) => {
    requireStaff(request, 'MODERATOR')
    const { type, id } = request.params as { type: string; id: string }
    const targetType = type.toUpperCase()
    if ((targetType !== 'BOOK' && targetType !== 'USER') || !isUuid(id)) throw new ApiError('NOT_FOUND')
    return targetDetail(targetType, id)
  })

  app.post('/api/mod/actions', async (request, reply) => {
    const auth = requireStaff(request, 'MODERATOR')
    const body = modActionSchema.parse(request.body)
    // Banir é só para admins e exige step-up (§6.5)
    if (body.type === 'BAN' || body.type === 'UNBAN') {
      requireStaff(request, 'ADMIN')
      requireReauth(deps, request)
    }
    const action = await applyAction(deps, {
      moderatorId: auth.user.id,
      targetType: body.targetType,
      targetId: body.targetId,
      type: body.type,
      guideline: body.guideline,
      reason: body.reason,
      days: body.days,
      badFaith: body.badFaith,
    })
    return reply.code(201).send({ id: action.id, type: action.type })
  })

  app.get('/api/mod/appeals', async (request) => {
    requireStaff(request, 'MODERATOR')
    const appeals = await db.appeal.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: { user: { select: { username: true } }, action: true },
    })
    return {
      items: appeals.map((appeal) => ({
        id: appeal.id,
        status: appeal.status,
        message: appeal.message,
        username: appeal.user.username,
        createdAt: appeal.createdAt,
        decidedAt: appeal.decidedAt,
        decisionReason: appeal.decisionReason,
        action: {
          id: appeal.action.id,
          type: appeal.action.type,
          targetType: appeal.action.targetType,
          targetId: appeal.action.targetId,
          guideline: appeal.action.guideline,
          reason: appeal.action.reason,
          automated: appeal.action.automated,
          createdAt: appeal.action.createdAt,
          // De preferência, outro moderador revisa (§6.7)
          decidedByMe: appeal.action.moderatorId === request.auth?.user.id,
        },
      })),
    }
  })

  app.post('/api/mod/appeals/:id/decide', async (request) => {
    const auth = requireStaff(request, 'MODERATOR')
    const { id } = request.params as { id: string }
    const body = appealDecisionSchema.parse(request.body)
    const appeal = isUuid(id)
      ? await db.appeal.findUnique({ where: { id }, include: { action: true } })
      : null
    if (!appeal) throw new ApiError('NOT_FOUND')
    if (appeal.status !== 'OPEN')
      throw new ApiError('CONFLICT', { detail: 'This appeal was already decided.' })
    // Reverter um banimento também é só para admins
    if (appeal.action.type === 'BAN' && body.status === 'REVERSED') requireStaff(request, 'ADMIN')

    await db.$transaction(async (tx) => {
      const claimed = await tx.appeal.updateMany({
        where: { id: appeal.id, status: 'OPEN' },
        data: {
          status: body.status,
          reviewerId: auth.user.id,
          decisionReason: body.reason,
          decidedAt: deps.now(),
        },
      })
      if (claimed.count !== 1) throw new ApiError('CONFLICT', { detail: 'This appeal was already decided.' })
      if (body.status === 'REVERSED') await reverseAction(deps, tx, appeal.action)
      await notify(tx, appeal.userId, 'APPEAL_DECIDED', {
        actionId: appeal.actionId,
        status: body.status,
        reason: body.reason,
      })
    })
    await audit(deps, request, 'APPEAL_DECIDED', { targetId: appeal.id, meta: { status: body.status } })
    return { status: body.status }
  })

  // Notificações do canal público, já confirmadas por e-mail: prioridade máxima (§6.9)
  app.get('/api/mod/concerns', async (request) => {
    requireStaff(request, 'MODERATOR')
    const concerns = await db.concernNotice.findMany({
      where: { confirmedAt: { not: null } },
      orderBy: [{ status: 'asc' }, { confirmedAt: 'asc' }],
      take: 200,
    })
    return {
      items: concerns.map((concern) => ({
        id: concern.id,
        name: concern.name,
        email: concern.email,
        relation: concern.relation,
        contentUrl: concern.contentUrl,
        description: concern.description,
        status: concern.status,
        confirmedAt: concern.confirmedAt,
      })),
    }
  })

  app.post('/api/mod/concerns/:id/resolve', async (request) => {
    requireStaff(request, 'MODERATOR')
    const { id } = request.params as { id: string }
    const body = concernResolveSchema.parse(request.body)
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    const updated = await db.concernNotice.updateMany({
      where: { id, confirmedAt: { not: null } },
      data: { status: body.status },
    })
    if (updated.count !== 1) throw new ApiError('NOT_FOUND')
    await audit(deps, request, 'CONCERN_RESOLVED', { targetId: id, meta: { status: body.status } })
    return { status: body.status }
  })
}
