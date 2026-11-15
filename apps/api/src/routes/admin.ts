// Administração: auditoria, papéis e termos do filtro (documento 02, §5.9 e §6.2).
import { filterTermSchema, normalizeTerm, roleSchema } from '@quillframe/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isUuid } from '../authz/books.ts'
import type { Deps } from '../context.ts'
import { ApiError } from '../http/problem.ts'
import { audit, requireReauth, requireStaff, revokeSessions } from '../http/session.ts'

const auditQuerySchema = z
  .object({
    event: z.string().max(40).optional(),
    cursor: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict()

const userQuerySchema = z.object({ q: z.string().trim().min(2).max(64) }).strict()

export function registerAdminRoutes(app: FastifyInstance, deps: Deps): void {
  const { db } = deps

  app.get('/api/admin/audit', async (request) => {
    requireStaff(request, 'ADMIN')
    const query = auditQuerySchema.parse(request.query)
    const rows = await db.auditLog.findMany({
      where: {
        ...(query.event ? { event: query.event } : {}),
        ...(query.cursor ? { id: { lt: BigInt(query.cursor) } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    })
    const items = rows.slice(0, query.limit)
    const actors = await db.user.findMany({
      where: { id: { in: items.flatMap((row) => (row.actorId ? [row.actorId] : [])) } },
      select: { id: true, username: true },
    })
    const names = new Map(actors.map((user) => [user.id, user.username]))
    return {
      items: items.map((row) => ({
        id: String(row.id),
        event: row.event,
        actor: row.actorId ? (names.get(row.actorId) ?? null) : null,
        targetId: row.targetId,
        ip: row.ip,
        meta: row.meta,
        createdAt: row.createdAt,
      })),
      nextCursor: rows.length > query.limit ? String(items.at(-1)?.id ?? '') : null,
    }
  })

  app.get('/api/admin/users', async (request) => {
    requireStaff(request, 'ADMIN')
    const { q } = userQuerySchema.parse(request.query)
    const users = await db.user.findMany({
      where: { usernameLower: { contains: q.toLowerCase() } },
      orderBy: { usernameLower: 'asc' },
      take: 20,
      select: { id: true, username: true, role: true, status: true, createdAt: true },
    })
    return { items: users }
  })

  // Mudança de papel: exige step-up, encerra as sessões da pessoa e vai para a auditoria (§5.9)
  app.patch('/api/admin/users/:id/role', async (request) => {
    const auth = requireStaff(request, 'ADMIN')
    requireReauth(deps, request)
    const { id } = request.params as { id: string }
    const { role } = roleSchema.parse(request.body)
    if (!isUuid(id)) throw new ApiError('NOT_FOUND')
    if (id === auth.user.id) throw new ApiError('FORBIDDEN', { detail: "You can't change your own role." })
    const user = await db.user.findUnique({ where: { id } })
    if (!user) throw new ApiError('NOT_FOUND')
    await db.user.update({ where: { id }, data: { role } })
    await revokeSessions(deps, id)
    await audit(deps, request, 'ROLE_CHANGED', { targetId: id, meta: { from: user.role, to: role } })
    if (role === 'ADMIN' && deps.config.ADMIN_ALERT_EMAIL) {
      await deps.mailer.send(
        deps.mails.adminAlert(deps.config.ADMIN_ALERT_EMAIL, `New admin: ${user.username}`),
      )
    }
    return { id, role }
  })

  // Os termos do filtro ficam no banco, fora do repositório, para ninguém "estudar" o filtro
  app.get('/api/admin/filter-terms', async (request) => {
    requireStaff(request, 'ADMIN')
    const terms = await db.filterTerm.findMany({ orderBy: [{ severity: 'asc' }, { term: 'asc' }] })
    return { items: terms.map(({ term, severity }) => ({ term, severity })) }
  })

  app.put('/api/admin/filter-terms', async (request) => {
    requireStaff(request, 'ADMIN')
    const body = filterTermSchema.parse(request.body)
    const term = normalizeTerm(body.term)
    if (term.length < 2) throw new ApiError('VALIDATION_FAILED')
    await db.filterTerm.upsert({
      where: { term },
      create: { term, severity: body.severity },
      update: { severity: body.severity },
    })
    await audit(deps, request, 'FILTER_TERM_SAVED', { meta: { severity: body.severity } })
    return { term, severity: body.severity }
  })

  app.delete('/api/admin/filter-terms', async (request) => {
    requireStaff(request, 'ADMIN')
    const { term } = z
      .object({ term: z.string().min(1).max(64) })
      .strict()
      .parse(request.body)
    await db.filterTerm.deleteMany({ where: { term } })
    await audit(deps, request, 'FILTER_TERM_REMOVED')
    return { ok: true }
  })
}
