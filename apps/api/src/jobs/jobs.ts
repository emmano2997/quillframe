// Jobs agendados (documento 02, §8.4). Rodam como scripts ligados direto no banco, pelo GitHub
// Actions: não há endpoint exposto, e funcionam mesmo com o servidor hibernando.
import { DAY, type Db } from '../context.ts'

export const RETENTION = {
  /** Carência da exclusão de conta e de livro (§7.5) */
  DELETION_DAYS: 30,
  /** Username reservado depois da exclusão, para ninguém se passar pela pessoa */
  USERNAME_RESERVED_DAYS: 90,
  /** AuditLog e IPs (Marco Civil, art. 15) */
  AUDIT_DAYS: 183,
  /** Denúncias resolvidas (histórico de reincidência) */
  REPORT_DAYS: 365,
  /** Notificações lidas */
  NOTIFICATION_DAYS: 90,
} as const

/** Sessões expiradas, tokens usados ou vencidos, logins pendentes e livros excluídos há mais de 30 dias. */
export async function cleanup(db: Db, now: Date) {
  const deletedBefore = new Date(now.getTime() - RETENTION.DELETION_DAYS * DAY)
  const [sessions, tokens, pendingLogins, pendingOAuth, concerns, books, notifications] =
    await db.$transaction([
      db.session.deleteMany({
        where: { OR: [{ expiresAt: { lte: now } }, { idleExpiresAt: { lte: now } }] },
      }),
      db.emailToken.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }] } }),
      db.pendingLogin.deleteMany({ where: { expiresAt: { lte: now } } }),
      db.pendingOAuth.deleteMany({ where: { expiresAt: { lte: now } } }),
      // Notificações do canal público que nunca foram confirmadas por e-mail
      db.concernNotice.deleteMany({
        where: { confirmedAt: null, createdAt: { lte: new Date(now.getTime() - 7 * DAY) } },
      }),
      db.book.deleteMany({ where: { deletedAt: { lte: deletedBefore } } }),
      db.notification.deleteMany({
        where: { readAt: { lte: new Date(now.getTime() - RETENTION.NOTIFICATION_DAYS * DAY) } },
      }),
    ])
  return {
    sessions: sessions.count,
    tokens: tokens.count,
    pendingLogins: pendingLogins.count + pendingOAuth.count,
    concerns: concerns.count,
    books: books.count,
    notifications: notifications.count,
  }
}

/** Exclui de vez as contas com mais de 30 dias em PENDING_DELETION. O username fica reservado por 90 dias. */
export async function purgeAccounts(db: Db, now: Date) {
  const users = await db.user.findMany({
    where: {
      status: 'PENDING_DELETION',
      deletionRequestedAt: { lte: new Date(now.getTime() - RETENTION.DELETION_DAYS * DAY) },
    },
    select: { id: true, usernameLower: true },
  })
  const until = new Date(now.getTime() + RETENTION.USERNAME_RESERVED_DAYS * DAY)
  for (const user of users) {
    await db.$transaction([
      db.reservedUsername.upsert({
        where: { usernameLower: user.usernameLower },
        create: { usernameLower: user.usernameLower, until },
        update: { until },
      }),
      // Denúncias sobre a conta e sobre os livros dela deixam de ter alvo
      db.report.deleteMany({ where: { targetType: 'USER', targetId: user.id } }),
      // Livros, páginas, likes, favoritos, comentários, amizades, sessões e tokens saem em cascata
      db.user.delete({ where: { id: user.id } }),
    ])
  }
  return { accounts: users.length }
}

/** Strikes valem 90 dias; depois disso saem (a decisão continua no histórico de moderação). */
export async function expireStrikes(db: Db, now: Date) {
  const strikes = await db.strike.deleteMany({ where: { expiresAt: { lte: now } } })
  return { strikes: strikes.count }
}

/** Apaga o que passou do prazo de guarda (§7.6). */
export async function retention(db: Db, now: Date) {
  const [audit, reports, usernames] = await db.$transaction([
    db.auditLog.deleteMany({
      where: { createdAt: { lte: new Date(now.getTime() - RETENTION.AUDIT_DAYS * DAY) } },
    }),
    db.report.deleteMany({
      where: {
        status: { not: 'OPEN' },
        resolvedAt: { lte: new Date(now.getTime() - RETENTION.REPORT_DAYS * DAY) },
      },
    }),
    db.reservedUsername.deleteMany({ where: { until: { lte: now } } }),
  ])
  return { auditLogs: audit.count, reports: reports.count, usernames: usernames.count }
}

/**
 * Quem fez 18 anos hoje é avisado de que as proteções de 16–17 anos saíram (§7.3). As proteções são
 * calculadas pela idade a cada requisição, então não há nada para "desligar" no banco.
 */
export async function comingOfAge(db: Db, now: Date) {
  const birthday = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()))
  const users = await db.user.findMany({
    where: { birthDate: birthday, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    select: { id: true },
  })
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let notified = 0
  for (const user of users) {
    // O job pode rodar mais de uma vez no mesmo dia
    const already = await db.notification.count({
      where: { userId: user.id, type: 'PROTECTIONS_LIFTED', createdAt: { gte: start } },
    })
    if (already > 0) continue
    await db.notification.create({ data: { userId: user.id, type: 'PROTECTIONS_LIFTED', payload: {} } })
    notified++
  }
  return { notified }
}

export const JOBS = {
  cleanup,
  'purge-accounts': purgeAccounts,
  strikes: expireStrikes,
  retention,
  'coming-of-age': comingOfAge,
} as const

export type JobName = keyof typeof JOBS
