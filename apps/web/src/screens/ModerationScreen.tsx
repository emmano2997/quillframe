// Painel de moderação (documento 03, §10.5). Só abre para a equipe com 2FA ativo; a proteção de
// verdade é o servidor, que responde 404 para quem não é da equipe.
import {
  appealDecisionSchema,
  CONCERN_RELATIONS,
  GUIDELINE_IDS,
  GUIDELINES,
  modActionSchema,
  type ConcernRelation,
  type GuidelineId,
  type ModActionType,
} from '@quillframe/shared'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { api, ApiError, errorMessage } from '../api/client.ts'
import type { AppealItem, ConcernItem, QueueEntry, Role, TargetDetail } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { queryClient, useMe } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import {
  ButtonLink,
  Check,
  cx,
  Field,
  formatDate,
  formatDateTime,
  formatRelative,
  Panel,
  QueryState,
  Select,
  Tabs,
  TextArea,
  ui,
} from '../ui/kit.tsx'

type Tab = 'queue' | 'appeals' | 'concerns' | 'audit' | 'users' | 'filter'
const fail = (cause: unknown) => toast(errorMessage(cause), 'error')
const reasonLabel = (reason: string) => en.report.reasons[reason as keyof typeof en.report.reasons] ?? reason
const actionLabel = (type: string) =>
  en.moderation.actions[type as keyof typeof en.moderation.actions] ?? type

export default function ModerationScreen() {
  const { data: me } = useMe()
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  if (!me || me.role === 'USER') return <Navigate to="/" replace />
  if (!me.mfaEnabled) {
    return (
      <Screen title={en.nav.moderation} back="/">
        <Panel>
          <p className={cx(ui.text, ui.center)}>{en.mfa.staffRequired}</p>
          <div className={ui.row}>
            <ButtonLink to="/settings/security">{en.mfa.title}</ButtonLink>
          </div>
        </Panel>
      </Screen>
    )
  }

  const [kind, id] = (params['*'] ?? '').split('/')
  if ((kind === 'book' || kind === 'user') && id) return <TargetScreen type={kind} id={id} role={me.role} />

  const tabs: { id: Tab; label: string }[] = [
    { id: 'queue', label: en.mod.queue },
    { id: 'appeals', label: en.mod.appeals },
    { id: 'concerns', label: en.mod.concerns },
    ...(me.role === 'ADMIN'
      ? [
          { id: 'audit' as const, label: en.mod.audit },
          { id: 'users' as const, label: en.mod.users },
          { id: 'filter' as const, label: en.mod.filter },
        ]
      : []),
  ]
  const tab = tabs.find((item) => item.id === search.get('tab'))?.id ?? 'queue'
  return (
    <Screen title={en.nav.moderation} back="/" wide>
      <Tabs
        label={en.nav.moderation}
        tabs={tabs}
        value={tab}
        onChange={(next) => setSearch({ tab: next }, { replace: true })}
      />
      {tab === 'queue' && <Queue />}
      {tab === 'appeals' && <Appeals />}
      {tab === 'concerns' && <Concerns />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'users' && <Users />}
      {tab === 'filter' && <FilterTerms />}
    </Screen>
  )
}

function Queue() {
  const [filter, setFilter] = useState('all')
  const query = useQuery({
    queryKey: ['mod', 'queue'],
    queryFn: () => api.get<{ items: QueueEntry[] }>('/api/mod/queue'),
  })
  const items = (query.data?.items ?? []).filter(
    (item) => filter === 'all' || String(item.priority) === filter,
  )
  return (
    <>
      <Select
        label={en.mod.priorityFilter}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        options={[
          { value: 'all', label: en.mod.allPriorities },
          ...[1, 2, 3, 4].map((priority) => ({
            value: String(priority),
            label: format(en.mod.priority, { priority }),
          })),
        ]}
      />
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={items.length === 0}
        emptyText={en.mod.emptyQueue}
      >
        <ul className={ui.list}>
          {items.map((item) => (
            <li key={`${item.targetType}:${item.targetId}`}>
              <Link className={ui.item} to={`/mod/${item.targetType.toLowerCase()}/${item.targetId}`}>
                <div className={ui.itemBody}>
                  <p className={ui.itemTitle}>
                    {format(en.mod.priority, { priority: item.priority })} ·{' '}
                    {item.label || en.editor.untitled}
                    {item.owner ? ` — ${item.owner}` : ''}
                  </p>
                  <p className={ui.itemMeta}>
                    {item.reasons.map(reasonLabel).join(', ')} ·{' '}
                    {format(en.mod.reportCount, { count: item.reportCount })} ·{' '}
                    {format(en.mod.waiting, { when: formatRelative(item.oldest) })}
                  </p>
                </div>
                <span
                  className={cx(
                    ui.badge,
                    item.reviewState !== 'NONE' && item.reviewState !== 'ACTIVE' && ui.badgeAlert,
                  )}
                >
                  {item.targetType === 'BOOK' ? en.mod.book : en.mod.user} · {item.reviewState}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </QueryState>
    </>
  )
}

const BOOK_ACTIONS: ModActionType[] = ['DISMISS', 'HIDE', 'RESTORE', 'REMOVE', 'WARN', 'STRIKE', 'SUSPEND']
const USER_ACTIONS: ModActionType[] = ['DISMISS', 'WARN', 'STRIKE', 'SUSPEND']

function TargetScreen({ type, id, role }: { type: 'book' | 'user'; id: string; role: Role }) {
  const key = ['mod', 'target', type, id]
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<TargetDetail>(`/api/mod/targets/${type}/${id}`),
  })
  const [action, setAction] = useState<ModActionType>('DISMISS')
  const [guideline, setGuideline] = useState<GuidelineId | ''>('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('3')
  const [badFaith, setBadFaith] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const detail = query.data
  const actions = [
    ...(type === 'book' ? BOOK_ACTIONS : USER_ACTIONS),
    ...(role === 'ADMIN' ? (['BAN', 'UNBAN'] as const) : []),
  ]

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = modActionSchema.safeParse({
      targetType: type.toUpperCase(),
      targetId: id,
      type: action,
      reason,
      ...(guideline ? { guideline } : {}),
      ...(action === 'SUSPEND' ? { days: Number(days) } : {}),
      ...(action === 'DISMISS' && badFaith ? { badFaith: true } : {}),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? en.common.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/mod/actions', parsed.data)
      await queryClient.invalidateQueries({ queryKey: ['mod'] })
      setReason('')
      toast(en.mod.actionDone)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={detail?.label || en.nav.moderation} back="/mod" wide>
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        {detail && (
          <>
            <Panel title={type === 'book' ? en.mod.book : en.mod.user}>
              <p className={ui.text}>
                {detail.label || en.editor.untitled} · {detail.reviewState}
              </p>
              <div className={cx(ui.row, ui.rowStart)}>
                {type === 'book' ? (
                  // O livro abre no leitor, na página denunciada
                  <ButtonLink to={`/book/${id}`} target="_blank">
                    {en.mod.openBook}
                  </ButtonLink>
                ) : (
                  <ButtonLink to={`/u/${detail.subject.username}`} target="_blank">
                    {en.mod.openProfile}
                  </ButtonLink>
                )}
              </div>
            </Panel>

            <Panel title={en.mod.author}>
              <p className={ui.text}>
                <Link to={`/u/${detail.subject.username}`}>{detail.subject.username}</Link> ·{' '}
                {detail.subject.role} · {detail.subject.status}
                {detail.subject.suspendedUntil ? ` (${formatDate(detail.subject.suspendedUntil)})` : ''}
              </p>
              <p className={ui.muted}>
                {format(en.profile.memberSince, { date: formatDate(detail.subject.memberSince) })} ·{' '}
                {format(en.moderation.activeStrikes, { count: detail.subject.activeStrikes })}
              </p>
              {detail.history.length > 0 && (
                <ul className={ui.list}>
                  {detail.history.map((item) => (
                    <li key={item.id} className={ui.item}>
                      <div className={ui.itemBody}>
                        <p className={ui.text}>
                          {actionLabel(item.type)} · {formatDate(item.createdAt)} ·{' '}
                          {item.automated ? en.moderation.automated : en.moderation.byModerator}
                        </p>
                        <p className={ui.itemMeta}>{item.reason}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={format(en.mod.reports, { count: detail.reports.length })}>
              {detail.reports.length === 0 ? (
                <p className={ui.muted}>{en.mod.filterOnly}</p>
              ) : (
                <ul className={ui.list}>
                  {detail.reports.map((report) => (
                    <li key={report.id} className={ui.item}>
                      <div className={ui.itemBody}>
                        <p className={ui.text}>
                          {reasonLabel(report.reason)}
                          {report.pageIndex !== null
                            ? ` · ${format(en.mod.page, { page: report.pageIndex + 1 })}`
                            : ''}{' '}
                          · {report.status}
                        </p>
                        {/* Os detalhes são texto do usuário: aparecem como texto, nunca como HTML */}
                        {report.details && <p className={ui.text}>{report.details}</p>}
                        <p className={ui.itemMeta}>
                          {report.reporter} · {formatDateTime(report.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={en.mod.decide}>
              <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
                <Select
                  label={en.mod.action}
                  value={action}
                  onChange={(event) => setAction(event.target.value as ModActionType)}
                  options={actions.map((item) => ({ value: item, label: actionLabel(item) }))}
                />
                <p className={ui.muted}>{en.mod.actionHelp[action]}</p>
                {!['DISMISS', 'RESTORE', 'UNBAN'].includes(action) && (
                  <Select
                    label={en.mod.guideline}
                    value={guideline}
                    onChange={(event) => setGuideline(event.target.value as GuidelineId | '')}
                    options={[
                      { value: '', label: en.mod.chooseGuideline },
                      ...GUIDELINE_IDS.map((item) => ({ value: item, label: GUIDELINES[item] })),
                    ]}
                  />
                )}
                {action === 'SUSPEND' && (
                  <Field
                    label={en.mod.days}
                    type="number"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(event) => setDays(event.target.value)}
                  />
                )}
                {action === 'DISMISS' && (
                  <Check checked={badFaith} onChange={(event) => setBadFaith(event.target.checked)}>
                    {en.mod.badFaith}
                  </Check>
                )}
                <TextArea
                  label={en.mod.reason}
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                  hint={en.mod.reasonHint}
                  error={error ?? undefined}
                />
                <div className={cx(ui.row, ui.rowStart)}>
                  <Button
                    type="submit"
                    disabled={busy}
                    className={
                      ['REMOVE', 'STRIKE', 'SUSPEND', 'BAN'].includes(action) ? ui.danger : undefined
                    }
                  >
                    {actionLabel(action)}
                  </Button>
                </div>
              </form>
            </Panel>
          </>
        )}
      </QueryState>
    </Screen>
  )
}

function Appeals() {
  const query = useQuery({
    queryKey: ['mod', 'appeals'],
    queryFn: () => api.get<{ items: AppealItem[] }>('/api/mod/appeals'),
  })
  const [reasons, setReasons] = useState<Record<string, string>>({})

  const decide = (appeal: AppealItem, status: 'UPHELD' | 'REVERSED') => {
    const parsed = appealDecisionSchema.safeParse({ status, reason: reasons[appeal.id] ?? '' })
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? en.common.error, 'error')
      return
    }
    void api
      .post(`/api/mod/appeals/${appeal.id}/decide`, parsed.data)
      .then(() => queryClient.invalidateQueries({ queryKey: ['mod'] }))
      .catch(fail)
  }

  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={query.data?.items.length === 0}
      emptyText={en.mod.noAppeals}
    >
      {query.data?.items.map((appeal) => (
        <Panel key={appeal.id} title={`${appeal.username} · ${en.appeal.status[appeal.status]}`}>
          <p className={ui.muted}>
            {actionLabel(appeal.action.type)} · {formatDate(appeal.action.createdAt)} ·{' '}
            {appeal.action.automated ? en.moderation.automated : en.moderation.byModerator}
            {appeal.action.guideline
              ? ` · ${GUIDELINES[appeal.action.guideline as GuidelineId] ?? appeal.action.guideline}`
              : ''}
          </p>
          <p className={ui.muted}>{format(en.moderation.reason, { reason: appeal.action.reason })}</p>
          <p className={ui.text}>{appeal.message}</p>
          <div className={cx(ui.row, ui.rowStart)}>
            <ButtonLink to={`/mod/${appeal.action.targetType.toLowerCase()}/${appeal.action.targetId}`}>
              {en.mod.openTarget}
            </ButtonLink>
          </div>
          {appeal.status === 'OPEN' ? (
            <>
              {appeal.action.decidedByMe && <p className={ui.warning}>{en.mod.ownDecision}</p>}
              <TextArea
                label={en.mod.reason}
                value={reasons[appeal.id] ?? ''}
                maxLength={1000}
                onChange={(event) => setReasons({ ...reasons, [appeal.id]: event.target.value })}
              />
              <div className={cx(ui.row, ui.rowStart)}>
                <Button onClick={() => decide(appeal, 'UPHELD')}>{en.mod.uphold}</Button>
                <Button onClick={() => decide(appeal, 'REVERSED')}>{en.mod.reverse}</Button>
              </div>
            </>
          ) : (
            appeal.decisionReason && <p className={ui.muted}>{appeal.decisionReason}</p>
          )}
        </Panel>
      ))}
    </QueryState>
  )
}

function Concerns() {
  const query = useQuery({
    queryKey: ['mod', 'concerns'],
    queryFn: () => api.get<{ items: ConcernItem[] }>('/api/mod/concerns'),
  })
  const resolve = (id: string, status: 'ACTIONED' | 'DISMISSED') =>
    api
      .post(`/api/mod/concerns/${id}/resolve`, { status })
      .then(() => queryClient.invalidateQueries({ queryKey: ['mod', 'concerns'] }))
      .catch(fail)
  return (
    <QueryState
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={query.data?.items.length === 0}
      emptyText={en.mod.noConcerns}
    >
      {query.data?.items.map((concern) => (
        <Panel
          key={concern.id}
          title={`${concern.name} · ${CONCERN_RELATIONS[concern.relation as ConcernRelation] ?? concern.relation}`}
        >
          <p className={ui.muted}>
            {concern.email} · {formatDateTime(concern.confirmedAt)} ·{' '}
            {en.moderation.reportStatus[concern.status]}
          </p>
          {/* O link informado é mostrado como texto: nenhuma URL de usuário vira href */}
          <p className={ui.text}>{concern.contentUrl}</p>
          <p className={ui.text}>{concern.description}</p>
          {concern.status === 'OPEN' && (
            <div className={cx(ui.row, ui.rowStart)}>
              <Button onClick={() => void resolve(concern.id, 'ACTIONED')}>{en.mod.markActioned}</Button>
              <Button onClick={() => void resolve(concern.id, 'DISMISSED')}>{en.mod.markDismissed}</Button>
            </div>
          )}
        </Panel>
      ))}
    </QueryState>
  )
}

interface AuditRow {
  id: string
  event: string
  actor: string | null
  targetId: string | null
  ip: string | null
  meta: unknown
  createdAt: string
}

function AuditLog() {
  const [event, setEvent] = useState('')
  const query = useQuery({
    queryKey: ['mod', 'audit', event],
    queryFn: () =>
      api.get<{ items: AuditRow[] }>(`/api/admin/audit${event ? `?event=${encodeURIComponent(event)}` : ''}`),
  })
  return (
    <>
      <Field
        label={en.mod.auditEvent}
        value={event}
        onChange={(e) => setEvent(e.target.value.toUpperCase().trim())}
        placeholder="LOGIN_FAILED"
      />
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={query.data?.items.length === 0}
      >
        <ul className={ui.list}>
          {query.data?.items.map((row) => (
            <li key={row.id} className={ui.item}>
              <div className={ui.itemBody}>
                <p className={ui.text}>
                  {row.event} · {row.actor ?? '—'}
                </p>
                <p className={ui.itemMeta}>
                  {formatDateTime(row.createdAt)}
                  {row.ip ? ` · ${row.ip}` : ''}
                  {row.meta ? ` · ${JSON.stringify(row.meta)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </>
  )
}

function Users() {
  const [q, setQ] = useState('')
  const term = q.trim()
  const query = useQuery({
    queryKey: ['mod', 'users', term],
    enabled: term.length >= 2,
    queryFn: () =>
      api.get<{ items: { id: string; username: string; role: Role; status: string }[] }>(
        `/api/admin/users?q=${encodeURIComponent(term)}`,
      ),
  })
  const setRole = (id: string, role: Role) =>
    api
      .patch(`/api/admin/users/${id}/role`, { role })
      .then(() => queryClient.invalidateQueries({ queryKey: ['mod', 'users'] }))
      .then(() => toast(en.mod.roleChanged))
      .catch(fail)
  return (
    <>
      <Field label={en.mod.findUser} value={q} onChange={(event) => setQ(event.target.value)} />
      {term.length >= 2 && (
        <QueryState
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={query.data?.items.length === 0}
        >
          <ul className={ui.list}>
            {query.data?.items.map((user) => (
              <li key={user.id} className={ui.item}>
                <div className={ui.itemBody}>
                  <p className={ui.itemTitle}>
                    <Link to={`/mod/user/${user.id}`}>{user.username}</Link>
                  </p>
                  <p className={ui.itemMeta}>{user.status}</p>
                </div>
                <Select
                  label={en.mod.role}
                  value={user.role}
                  onChange={(event) => void setRole(user.id, event.target.value as Role)}
                  options={(['USER', 'MODERATOR', 'ADMIN'] as const).map((role) => ({
                    value: role,
                    label: role,
                  }))}
                />
              </li>
            ))}
          </ul>
        </QueryState>
      )}
    </>
  )
}

function FilterTerms() {
  const query = useQuery({
    queryKey: ['mod', 'filter'],
    queryFn: () =>
      api.get<{ items: { term: string; severity: 'HIGH' | 'MEDIUM' }[] }>('/api/admin/filter-terms'),
  })
  const [term, setTerm] = useState('')
  const [severity, setSeverity] = useState<'HIGH' | 'MEDIUM'>('MEDIUM')
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mod', 'filter'] })
  const add = (event: FormEvent) => {
    event.preventDefault()
    void api
      .put('/api/admin/filter-terms', { term, severity })
      .then(() => {
        setTerm('')
        return refresh()
      })
      .catch((cause: unknown) =>
        toast(cause instanceof ApiError ? cause.detail : errorMessage(cause), 'error'),
      )
  }
  return (
    <>
      <Panel title={en.mod.filter}>
        <p className={ui.muted}>{en.mod.filterHint}</p>
        <form className={ui.form} onSubmit={add}>
          <Field
            label={en.mod.term}
            value={term}
            maxLength={64}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Select
            label={en.mod.severity}
            value={severity}
            onChange={(event) => setSeverity(event.target.value as 'HIGH' | 'MEDIUM')}
            options={[
              { value: 'MEDIUM', label: en.mod.severityMedium },
              { value: 'HIGH', label: en.mod.severityHigh },
            ]}
          />
          <div className={cx(ui.row, ui.rowStart)}>
            <Button type="submit" disabled={term.trim().length < 2}>
              {en.mod.addTerm}
            </Button>
          </div>
        </form>
      </Panel>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={query.data?.items.length === 0}
      >
        <ul className={ui.list}>
          {query.data?.items.map((item) => (
            <li key={item.term} className={ui.item}>
              <div className={ui.itemBody}>
                <p className={ui.itemTitle}>{item.term}</p>
                <p className={ui.itemMeta}>
                  {item.severity === 'HIGH' ? en.mod.severityHigh : en.mod.severityMedium}
                </p>
              </div>
              <Button
                className={ui.small}
                onClick={() =>
                  void api.delete('/api/admin/filter-terms', { term: item.term }).then(refresh).catch(fail)
                }
              >
                {en.library.remove}
              </Button>
            </li>
          ))}
        </ul>
      </QueryState>
    </>
  )
}
