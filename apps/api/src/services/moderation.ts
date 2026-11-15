// Ações de moderação, strikes e recursos (documento 02, §6.5–6.8). Tudo passa por applyAction, para
// que a decisão manual, a ocultação automática e a reversão de um recurso sigam as mesmas regras.
import {
  GUIDELINES,
  MODERATION,
  type GuidelineId,
  type ModActionType,
  type ReportTarget,
} from '@quillframe/shared'
import { DAY, type Deps, type Tx } from '../context.ts'
import type { ModerationAction } from '../generated/prisma/client.ts'
import { ApiError } from '../http/problem.ts'
import { notify } from './books.ts'

export interface ActionInput {
  /** null = ação automática (ECA Digital, art. 30: o usuário é avisado disso) */
  moderatorId: string | null
  targetType: ReportTarget
  targetId: string
  type: ModActionType
  guideline?: GuidelineId | undefined
  reason: string
  days?: number | undefined
  badFaith?: boolean | undefined
  /** Ocultação automática: as denúncias ficam abertas até um moderador decidir */
  keepReportsOpen?: boolean | undefined
}

const BOOK_ONLY: readonly ModActionType[] = ['HIDE', 'RESTORE', 'REMOVE']
/** Decisões das quais o usuário é avisado por e-mail e pode recorrer. */
export const APPEALABLE: readonly ModActionType[] = ['HIDE', 'REMOVE', 'WARN', 'STRIKE', 'SUSPEND', 'BAN']

/** Strikes ativos → consequência (§6.6). */
async function escalate(
  deps: Deps,
  tx: Tx,
  userId: string,
): Promise<'SUSPENDED_3' | 'SUSPENDED_30' | 'BANNED' | null> {
  const now = deps.now()
  const active = await tx.strike.count({ where: { userId, expiresAt: { gt: now } } })
  if (active >= 4) {
    await tx.user.update({ where: { id: userId }, data: { status: 'BANNED', suspendedUntil: null } })
    await tx.session.deleteMany({ where: { userId } })
    return 'BANNED'
  }
  if (active >= 2) {
    const days = active === 2 ? 3 : 30
    await tx.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', suspendedUntil: new Date(now.getTime() + days * DAY) },
    })
    return active === 2 ? 'SUSPENDED_3' : 'SUSPENDED_30'
  }
  return null
}

export async function applyAction(deps: Deps, input: ActionInput): Promise<ModerationAction> {
  const { db } = deps
  const now = deps.now()
  const book =
    input.targetType === 'BOOK'
      ? await db.book.findFirst({ where: { id: input.targetId, deletedAt: null, status: 'SIGNED' } })
      : null
  const subjectId = input.targetType === 'BOOK' ? book?.ownerId : input.targetId
  const subject = subjectId ? await db.user.findUnique({ where: { id: subjectId } }) : null
  if (!subject || (input.targetType === 'BOOK' && !book)) throw new ApiError('NOT_FOUND')
  if (input.targetType === 'USER' && BOOK_ONLY.includes(input.type)) {
    throw new ApiError('VALIDATION_FAILED', { detail: "This action doesn't apply to a user." })
  }
  if (input.moderatorId !== null) {
    if (subject.id === input.moderatorId)
      throw new ApiError('FORBIDDEN', { detail: "You can't moderate yourself." })
    const moderator = await db.user.findUniqueOrThrow({ where: { id: input.moderatorId } })
    // Só admins agem sobre a equipe, e só admins banem (§5.9)
    if (subject.role !== 'USER' && moderator.role !== 'ADMIN') throw new ApiError('NOT_FOUND')
    if ((input.type === 'BAN' || input.type === 'UNBAN') && moderator.role !== 'ADMIN')
      throw new ApiError('NOT_FOUND')
  }

  const result = await db.$transaction(async (tx) => {
    const action = await tx.moderationAction.create({
      data: {
        moderatorId: input.moderatorId,
        targetType: input.targetType,
        targetId: input.targetId,
        subjectId: subject.id,
        type: input.type,
        guideline: input.guideline ?? null,
        reason: input.reason,
        automated: input.moderatorId === null,
      },
    })

    let escalation: Awaited<ReturnType<typeof escalate>> = null
    const setReview = (reviewState: 'NONE' | 'HIDDEN' | 'REMOVED') =>
      book
        ? tx.book.update({
            where: { id: book.id },
            data: { reviewState, ...(reviewState === 'NONE' ? { filterFlag: null } : {}) },
          })
        : null

    switch (input.type) {
      case 'DISMISS':
      case 'RESTORE':
        await setReview('NONE')
        break
      case 'HIDE':
        await setReview('HIDDEN')
        break
      case 'REMOVE':
        await setReview('REMOVED')
        break
      case 'STRIKE':
        await setReview('REMOVED')
        await tx.strike.create({
          data: {
            userId: subject.id,
            actionId: action.id,
            expiresAt: new Date(now.getTime() + MODERATION.STRIKE_DAYS * DAY),
          },
        })
        escalation = await escalate(deps, tx, subject.id)
        break
      case 'SUSPEND':
        await tx.user.update({
          where: { id: subject.id },
          data: { status: 'SUSPENDED', suspendedUntil: new Date(now.getTime() + (input.days ?? 1) * DAY) },
        })
        break
      case 'BAN':
        await tx.user.update({ where: { id: subject.id }, data: { status: 'BANNED', suspendedUntil: null } })
        await tx.session.deleteMany({ where: { userId: subject.id } })
        break
      case 'UNBAN':
        await tx.user.update({ where: { id: subject.id }, data: { status: 'ACTIVE', suspendedUntil: null } })
        break
      case 'WARN':
        break
    }

    // As denúncias abertas do alvo são resolvidas pela decisão, e quem denunciou fica sabendo
    const dismissed = input.type === 'DISMISS'
    const open = await tx.report.findMany({
      where: { targetType: input.targetType, targetId: input.targetId, status: 'OPEN' },
      select: { id: true, reporterId: true },
    })
    if (open.length > 0 && !input.keepReportsOpen && input.type !== 'RESTORE' && input.type !== 'UNBAN') {
      await tx.report.updateMany({
        where: { id: { in: open.map((report) => report.id) } },
        data: {
          status: dismissed ? 'DISMISSED' : 'ACTIONED',
          badFaith: dismissed && input.badFaith === true,
          actionId: action.id,
          resolvedAt: now,
        },
      })
      await tx.notification.createMany({
        data: open.map((report) => ({
          userId: report.reporterId,
          type: 'REPORT_RESOLVED',
          payload: { outcome: dismissed ? 'dismissed' : 'actioned', targetType: input.targetType },
        })),
      })
    }

    if (!dismissed) {
      await notify(tx, subject.id, 'MOD_DECISION', {
        actionId: action.id,
        type: input.type,
        guideline: input.guideline ?? null,
        reason: input.reason,
        automated: action.automated,
        targetType: input.targetType,
        bookId: book?.id ?? null,
        title: book?.title ?? null,
        escalation,
      })
    }
    await tx.auditLog.create({
      data: {
        event: 'MOD_ACTION',
        actorId: input.moderatorId,
        targetId: input.targetId,
        meta: { type: input.type, targetType: input.targetType, actionId: action.id, escalation },
      },
    })
    return {
      action,
      reporters: dismissed && input.badFaith ? open.map((report) => report.reporterId) : [],
      escalation,
    }
  })

  // E-mail com o que foi afetado, a regra, se foi automático e como recorrer (§6.7)
  if (APPEALABLE.includes(input.type)) {
    const what = book ? `Your book "${book.title}"` : 'Your account'
    const outcome: Record<string, string> = {
      HIDE: 'was hidden while we review it',
      REMOVE: 'was removed',
      WARN: 'received a warning',
      STRIKE: book ? 'was removed and your account received a strike' : 'received a strike',
      SUSPEND: `was suspended for ${input.days ?? 1} day(s)`,
      BAN: 'was permanently banned',
    }
    await deps.mailer.send(
      deps.mails.moderation(subject.email, [
        `${what} ${outcome[input.type] ?? 'was reviewed'}.`,
        ...(input.type === 'SUSPEND' && book ? ['Your account is suspended for now.'] : []),
        '',
        `Rule: ${input.guideline ? GUIDELINES[input.guideline] : 'Community Guidelines'}`,
        `Reason: ${input.reason}`,
        `Decision: ${result.action.automated ? 'Automated review' : 'Reviewed by a moderator'}`,
        ...(result.escalation === 'BANNED'
          ? ['', 'Because of your active strikes, your account was permanently banned.']
          : result.escalation
            ? [
                '',
                `Because of your active strikes, your account is suspended for ${result.escalation === 'SUSPENDED_3' ? 3 : 30} days.`,
              ]
            : []),
      ]),
    )
  }

  // Abuso de denúncias (§6.8): 5 descartadas por má-fé em 30 dias geram um aviso
  for (const reporterId of new Set(result.reporters)) {
    const count = await badFaithCount(deps, reporterId)
    if (count === MODERATION.BAD_FAITH_WARNING) {
      await notify(db, reporterId, 'REPORT_ABUSE_WARNING', { count })
    }
  }
  return result.action
}

/** Denúncias do usuário descartadas por má-fé nos últimos 30 dias. */
export function badFaithCount(deps: Deps, reporterId: string): Promise<number> {
  return deps.db.report.count({
    where: { reporterId, badFaith: true, resolvedAt: { gt: new Date(deps.now().getTime() - 30 * DAY) } },
  })
}

/**
 * Conta "confiável" para a ocultação automática (§6.4): com 7 dias ou mais e sem histórico ruim de
 * denúncias. O e-mail verificado já é exigido para denunciar.
 */
export async function isTrustedReporter(
  deps: Deps,
  reporter: { id: string; createdAt: Date },
): Promise<boolean> {
  const now = deps.now()
  if (now.getTime() - reporter.createdAt.getTime() < MODERATION.TRUSTED_ACCOUNT_DAYS * DAY) return false
  const [actioned, dismissed, badFaith] = await Promise.all([
    deps.db.report.count({ where: { reporterId: reporter.id, status: 'ACTIONED' } }),
    deps.db.report.count({ where: { reporterId: reporter.id, status: 'DISMISSED' } }),
    badFaithCount(deps, reporter.id),
  ])
  if (badFaith >= 3) return false
  // Confiabilidade baixa: pelo menos 5 denúncias resolvidas e menos de um quarto aceitas
  const resolved = actioned + dismissed
  return resolved < 5 || actioned / resolved >= 0.25
}

/** Desfaz uma decisão depois de um recurso aceito (§6.7): restaura o livro e retira o strike. */
export async function reverseAction(deps: Deps, tx: Tx, action: ModerationAction): Promise<void> {
  const now = deps.now()
  if (action.targetType === 'BOOK' && ['HIDE', 'REMOVE', 'STRIKE'].includes(action.type)) {
    await tx.book.updateMany({
      where: { id: action.targetId },
      data: { reviewState: 'NONE', filterFlag: null },
    })
  }
  if (action.type === 'STRIKE') await tx.strike.deleteMany({ where: { actionId: action.id } })
  if (['STRIKE', 'SUSPEND', 'BAN'].includes(action.type)) {
    // Sem esta decisão, a conta volta ao que os strikes que sobraram determinam
    const active = await tx.strike.count({ where: { userId: action.subjectId, expiresAt: { gt: now } } })
    if (active < 2) {
      await tx.user.updateMany({
        where: { id: action.subjectId, status: { in: ['SUSPENDED', 'BANNED'] } },
        data: { status: 'ACTIVE', suspendedUntil: null },
      })
    }
  }
}
