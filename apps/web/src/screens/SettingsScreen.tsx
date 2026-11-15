// Options... (documento 03, §8).
import {
  AVATAR_COUNT,
  BIO_MAX,
  changePasswordSchema,
  emailSchema,
  GUIDELINES,
  type FriendRequestPolicy,
  type GuidelineId,
} from '@quillframe/shared'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { api, ApiError, download, errorMessage } from '../api/client.ts'
import type { Me, ModerationItem, SecurityEvent, SessionItem } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { clearLocalData, queryClient, refreshMe, useConfig, useMe } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast, usePreferences, type GuiScalePreference } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import {
  Avatar,
  ButtonLink,
  Check,
  cx,
  Dialog,
  Field,
  formatDate,
  formatDateTime,
  Panel,
  PasswordField,
  QueryState,
  Select,
  TextArea,
  ui,
} from '../ui/kit.tsx'
import { playClick, playPageTurn } from '../ui/sounds.ts'
import { ShortcutList } from './EditorScreen.tsx'
import { MfaSection } from './MfaSection.tsx'
import { AppealDialog } from './ReportDialog.tsx'

const SECTIONS = [
  'account',
  'security',
  'privacy',
  'video',
  'accessibility',
  'sounds',
  'controls',
  'data',
  'moderation',
] as const
type Section = (typeof SECTIONS)[number]

const fail = (cause: unknown) => toast(errorMessage(cause), 'error')

export default function SettingsScreen() {
  const params = useParams()
  const { data: me } = useMe()
  const section = SECTIONS.find((item) => item === params['*']) ?? null
  if (!me) return null

  if (!section) {
    return (
      <Screen title={en.title.options} back="/">
        {SECTIONS.map((item) => (
          <ButtonLink key={item} wide to={`/settings/${item}`}>
            {en.settings.sections[item]}
          </ButtonLink>
        ))}
      </Screen>
    )
  }
  const content: Record<Section, ReactNode> = {
    account: <AccountSection me={me} />,
    security: <SecuritySection me={me} />,
    privacy: <PrivacySection me={me} />,
    video: <VideoSection />,
    accessibility: <AccessibilitySection />,
    sounds: <SoundSection />,
    controls: (
      <Panel title={en.settings.sections.controls}>
        <ShortcutList />
        <p className={ui.muted}>{en.settings.readerKeys}</p>
      </Panel>
    ),
    data: <DataSection me={me} />,
    moderation: <ModerationHistory />,
  }
  return (
    <Screen title={en.settings.sections[section]} back="/settings" wide>
      {content[section]}
    </Screen>
  )
}

function AccountSection({ me }: { me: Me }) {
  const [bio, setBio] = useState(me.bio)
  const [avatarId, setAvatarId] = useState(me.avatarId)
  const [newEmail, setNewEmail] = useState('')
  const [bioError, setBioError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  const saveProfile = (event: FormEvent) => {
    event.preventDefault()
    setBioError(null)
    api
      .patch('/api/me/profile', { bio, avatarId })
      .then(async () => {
        await refreshMe()
        toast(en.settings.saved)
      })
      .catch((cause: unknown) => setBioError(errorMessage(cause)))
  }

  const changeEmail = (event: FormEvent) => {
    event.preventDefault()
    const parsed = emailSchema.safeParse(newEmail)
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? en.common.error)
      return
    }
    setEmailError(null)
    api
      .post('/api/me/email', { newEmail: parsed.data })
      .then(() => {
        setNewEmail('')
        toast(en.settings.emailChangeSent)
      })
      .catch((cause: unknown) =>
        setEmailError(
          cause instanceof ApiError && cause.fields[0] ? cause.fields[0].message : errorMessage(cause),
        ),
      )
  }

  return (
    <>
      <Panel title={en.settings.profile}>
        <form className={ui.form} onSubmit={saveProfile}>
          <Field label={en.auth.username} value={me.username} readOnly hint={en.settings.usernameFixed} />
          <fieldset className={ui.stack}>
            <legend className={ui.label}>{en.settings.avatar}</legend>
            <div className={cx(ui.row, ui.rowStart)}>
              {Array.from({ length: AVATAR_COUNT }, (_, id) => (
                <button
                  key={id}
                  type="button"
                  className={cx(ui.item, id === avatarId && ui.itemSelected)}
                  style={{ width: 'auto' }}
                  aria-pressed={id === avatarId}
                  aria-label={format(en.settings.avatarNumber, { number: id + 1 })}
                  onClick={() => setAvatarId(id)}
                >
                  <Avatar id={id} />
                </button>
              ))}
            </div>
          </fieldset>
          <TextArea
            label={en.settings.bio}
            value={bio}
            maxLength={BIO_MAX}
            onChange={(event) => setBio(event.target.value)}
            hint={`${bio.length}/${BIO_MAX}`}
            error={bioError ?? undefined}
          />
          <div className={cx(ui.row, ui.rowStart)}>
            <Button type="submit">{en.common.save}</Button>
          </div>
        </form>
      </Panel>
      <Panel title={en.auth.email}>
        <p className={ui.text}>
          {me.email}{' '}
          {me.emailVerified ? (
            <span className={ui.success}>{en.settings.verified}</span>
          ) : (
            <span className={ui.warning}>{en.settings.notVerified}</span>
          )}
        </p>
        <form className={ui.form} onSubmit={changeEmail} noValidate>
          <Field
            label={en.settings.newEmail}
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            error={emailError ?? undefined}
            hint={en.settings.emailChangeHint}
          />
          <div className={cx(ui.row, ui.rowStart)}>
            <Button type="submit" disabled={newEmail === ''}>
              {en.settings.changeEmail}
            </Button>
          </div>
        </form>
      </Panel>
    </>
  )
}

function ChangePassword({ me }: { me: Me }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next })
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])),
      )
      return
    }
    setErrors({})
    api
      .post('/api/me/password', parsed.data)
      .then(() => {
        setCurrent('')
        setNext('')
        toast(en.settings.passwordChanged)
      })
      .catch((cause: unknown) => {
        const code = cause instanceof ApiError ? cause.code : ''
        setErrors(
          code === 'INVALID_CREDENTIALS'
            ? { currentPassword: errorMessage(cause) }
            : { newPassword: errorMessage(cause) },
        )
      })
  }

  if (!me.hasPassword) {
    return (
      <Panel title={en.settings.changePassword}>
        <p className={ui.text}>{en.settings.noPassword}</p>
      </Panel>
    )
  }
  return (
    <Panel title={en.settings.changePassword}>
      <form className={ui.form} onSubmit={submit} noValidate>
        <PasswordField
          label={en.settings.currentPassword}
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={errors['currentPassword']}
        />
        <PasswordField
          label={en.auth.newPassword}
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={errors['newPassword']}
          hint={en.auth.passwordHint}
        />
        <div className={cx(ui.row, ui.rowStart)}>
          <Button type="submit" disabled={current === '' || next === ''}>
            {en.settings.changePassword}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function Sessions() {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ items: SessionItem[] }>('/api/me/sessions'),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] })
  return (
    <Panel title={en.settings.sessions}>
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        <ul className={ui.list}>
          {query.data?.items.map((session) => (
            <li key={session.id} className={ui.item}>
              <div className={ui.itemBody}>
                <p className={ui.itemTitle}>
                  {session.device}{' '}
                  {session.current && <span className={ui.success}>{en.settings.thisDevice}</span>}
                </p>
                <p className={ui.itemMeta}>
                  {session.ip ?? ''} ·{' '}
                  {format(en.settings.lastSeen, { when: formatDateTime(session.lastSeenAt) })}
                </p>
              </div>
              <Button
                className={ui.small}
                onClick={() =>
                  void api
                    .delete(`/api/me/sessions/${session.id}`)
                    .then(async () => {
                      if (session.current) {
                        await clearLocalData()
                        void navigate('/')
                      } else await refresh()
                    })
                    .catch(fail)
                }
              >
                {en.settings.signOut}
              </Button>
            </li>
          ))}
        </ul>
        <div className={cx(ui.row, ui.rowStart)}>
          <Button
            disabled={(query.data?.items.length ?? 0) < 2}
            onClick={() =>
              void api
                .delete<{ revoked: number }>('/api/me/sessions')
                .then(async (result) => {
                  await refresh()
                  toast(format(en.settings.signedOutEverywhere, { count: result.revoked }))
                })
                .catch(fail)
            }
          >
            {en.settings.signOutEverywhere}
          </Button>
        </div>
      </QueryState>
    </Panel>
  )
}

const OAUTH_NOTICE: Record<string, string> = {
  linked: en.settings.oauthLinked,
  in_use: en.settings.oauthInUse,
  failed: en.auth.oauthFailed,
  unverified: en.auth.oauthUnverified,
}

function ConnectedAccounts() {
  const [params] = useSearchParams()
  const { data: config } = useConfig()
  const query = useQuery({
    queryKey: ['oauth'],
    queryFn: () =>
      api.get<{
        items: {
          provider: 'google' | 'discord'
          configured: boolean
          linked: boolean
          linkedAt: string | null
        }[]
      }>('/api/me/oauth'),
  })
  const notice = OAUTH_NOTICE[params.get('oauth') ?? '']
  const names = { google: 'Google', discord: 'Discord' }
  if (!config?.oauth.google && !config?.oauth.discord && !query.data?.items.some((item) => item.linked))
    return null

  // O vínculo exige confirmação recente: confirma antes de sair para o provedor
  const link = (provider: string) =>
    api
      .post('/api/auth/reauth/check')
      .then(() => window.location.assign(`/api/auth/oauth/${provider}/start?link=1`))
      .catch(fail)

  return (
    <Panel title={en.settings.connected}>
      {notice && <p className={ui.warning}>{notice}</p>}
      <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
        <ul className={ui.list}>
          {query.data?.items
            .filter((item) => item.configured || item.linked)
            .map((item) => (
              <li key={item.provider} className={ui.item}>
                <div className={ui.itemBody}>
                  <p className={ui.itemTitle}>{names[item.provider]}</p>
                  <p className={ui.itemMeta}>
                    {item.linked
                      ? format(en.settings.linkedOn, { date: formatDate(item.linkedAt) })
                      : en.settings.notLinked}
                  </p>
                </div>
                {item.linked ? (
                  <Button
                    className={ui.small}
                    onClick={() =>
                      void api
                        .delete(`/api/me/oauth/${item.provider}`)
                        .then(() => queryClient.invalidateQueries({ queryKey: ['oauth'] }))
                        .catch(fail)
                    }
                  >
                    {en.settings.unlink}
                  </Button>
                ) : (
                  <Button className={ui.small} onClick={() => void link(item.provider)}>
                    {en.settings.link}
                  </Button>
                )}
              </li>
            ))}
        </ul>
      </QueryState>
    </Panel>
  )
}

function SecurityActivity() {
  const query = useQuery({
    queryKey: ['security-events'],
    queryFn: () => api.get<{ items: SecurityEvent[] }>('/api/me/security-events'),
  })
  return (
    <Panel title={en.settings.activity}>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={query.data?.items.length === 0}
      >
        <ul className={ui.list}>
          {query.data?.items.map((event) => (
            <li key={event.id} className={ui.item}>
              <div className={ui.itemBody}>
                <p className={ui.itemTitle}>
                  {en.settings.events[event.event as keyof typeof en.settings.events] ?? event.event}
                </p>
                <p className={ui.itemMeta}>
                  {formatDateTime(event.createdAt)} · {event.device}
                  {event.ip ? ` · ${event.ip}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </Panel>
  )
}

function SecuritySection({ me }: { me: Me }) {
  return (
    <>
      <ChangePassword me={me} />
      <MfaSection me={me} />
      <Sessions />
      <ConnectedAccounts />
      <SecurityActivity />
    </>
  )
}

const POLICIES: { value: FriendRequestPolicy; label: string }[] = [
  { value: 'EVERYONE', label: en.settings.policyEveryone },
  { value: 'FRIENDS_OF_FRIENDS', label: en.settings.policyFriendsOfFriends },
  { value: 'NOBODY', label: en.settings.policyNobody },
]

function PrivacySection({ me }: { me: Me }) {
  const { privacy } = me
  const save = (changes: Partial<Me['privacy']>) =>
    api.patch('/api/me/privacy', changes).then(refreshMe).catch(fail)
  return (
    <Panel title={en.settings.sections.privacy}>
      {/* 16–17 anos: proteções ligadas e travadas, com explicação (documento 02, §7.3) */}
      {privacy.locked && <p className={ui.warning}>{en.settings.privacyLocked}</p>}
      <Select
        label={en.settings.whoCanRequest}
        value={privacy.friendRequestPolicy}
        disabled={privacy.locked}
        options={POLICIES}
        onChange={(event) => void save({ friendRequestPolicy: event.target.value as FriendRequestPolicy })}
      />
      <Check
        checked={privacy.showFavorites}
        disabled={privacy.locked}
        onChange={(event) => void save({ showFavorites: event.target.checked })}
      >
        {en.settings.showFavorites}
      </Check>
      <Check
        checked={privacy.searchable}
        disabled={privacy.locked}
        onChange={(event) => void save({ searchable: event.target.checked })}
      >
        {en.settings.searchable}
      </Check>
    </Panel>
  )
}

function VideoSection() {
  const guiScale = usePreferences((state) => state.guiScale)
  const set = usePreferences((state) => state.set)
  const options: GuiScalePreference[] = ['auto', 1, 2, 3, 4]
  return (
    <Panel title={en.settings.sections.video}>
      <Button
        wide
        onClick={() => set({ guiScale: options[(options.indexOf(guiScale) + 1) % options.length] ?? 'auto' })}
      >
        {format(en.settings.guiScale, { scale: guiScale === 'auto' ? en.settings.auto : guiScale })}
      </Button>
    </Panel>
  )
}

/** Botão de ciclo no estilo das opções do jogo ("Sounds: ON"). */
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <Button wide aria-pressed={value} onClick={() => onChange(!value)}>
      {label}: {value ? en.settings.on : en.settings.off}
    </Button>
  )
}

function AccessibilitySection() {
  const prefs = usePreferences()
  return (
    <Panel title={en.settings.sections.accessibility}>
      <Toggle
        label={en.settings.readableFont}
        value={prefs.readableFont}
        onChange={(readableFont) => prefs.set({ readableFont })}
      />
      <Toggle
        label={en.settings.reduceMotion}
        value={prefs.reduceMotion}
        onChange={(reduceMotion) => prefs.set({ reduceMotion })}
      />
      <Toggle
        label={en.settings.pageTurnAnimation}
        value={prefs.pageTurnAnimation}
        onChange={(pageTurnAnimation) => prefs.set({ pageTurnAnimation })}
      />
      <p className={ui.muted}>{en.settings.readableFontHint}</p>
    </Panel>
  )
}

function SoundSection() {
  const prefs = usePreferences()
  return (
    <Panel title={en.settings.sections.sounds}>
      <label className={ui.field}>
        <span className={ui.label}>{format(en.settings.masterVolume, { volume: prefs.masterVolume })}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={prefs.masterVolume}
          onChange={(event) => prefs.set({ masterVolume: Number(event.target.value) })}
          onPointerUp={() => playClick()}
        />
      </label>
      <Toggle
        label={en.settings.interfaceSounds}
        value={prefs.interfaceSounds}
        onChange={(interfaceSounds) => prefs.set({ interfaceSounds })}
      />
      <Toggle
        label={en.settings.bookSounds}
        value={prefs.bookSounds}
        onChange={(bookSounds) => {
          prefs.set({ bookSounds })
          if (bookSounds) playPageTurn()
        }}
      />
    </Panel>
  )
}

function DataSection({ me }: { me: Me }) {
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  const remove = (event: FormEvent) => {
    event.preventDefault()
    api
      .delete('/api/me', { username })
      .then(async () => {
        await clearLocalData()
        toast(en.settings.deletionScheduled)
        void navigate('/')
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.fields[0] ? cause.fields[0].message : errorMessage(cause),
        ),
      )
  }

  return (
    <>
      <Panel title={en.settings.exportData}>
        <p className={ui.text}>{en.settings.exportHint}</p>
        <div className={cx(ui.row, ui.rowStart)}>
          <Button onClick={() => void download('/api/me/export', 'quillframe-data.zip').catch(fail)}>
            {en.settings.exportData}
          </Button>
        </div>
      </Panel>
      <Panel title={en.settings.deleteAccount}>
        <p className={ui.text}>{en.settings.deleteHint}</p>
        <div className={cx(ui.row, ui.rowStart)}>
          <Button className={ui.danger} onClick={() => setDeleting(true)}>
            {en.settings.deleteAccount}
          </Button>
        </div>
      </Panel>
      {deleting && (
        <Dialog title={en.settings.deleteAccount} onClose={() => setDeleting(false)}>
          <form className={ui.form} onSubmit={remove}>
            <p className={ui.text}>{en.settings.deleteHint}</p>
            <Field
              label={format(en.settings.typeUsername, { username: me.username })}
              value={username}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
              error={error ?? undefined}
            />
            <div className={ui.row}>
              <Button type="submit" className={ui.danger} disabled={username !== me.username}>
                {en.settings.deleteAccount}
              </Button>
              <Button onClick={() => setDeleting(false)}>{en.common.cancel}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

/** Avisos, strikes (com a data em que expiram), recursos e as minhas denúncias. */
function ModerationHistory() {
  const [appealing, setAppealing] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['moderation', 'mine'],
    queryFn: () => api.get<{ activeStrikes: number; items: ModerationItem[] }>('/api/me/moderation'),
  })
  const reports = useQuery({
    queryKey: ['moderation', 'reports'],
    queryFn: () =>
      api.get<{
        items: { id: string; targetType: string; reason: string; status: string; createdAt: string }[]
      }>('/api/me/reports'),
  })
  return (
    <>
      <Panel title={en.settings.sections.moderation}>
        <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
          <p className={ui.text}>
            {format(en.moderation.activeStrikes, { count: query.data?.activeStrikes ?? 0 })}
          </p>
          {query.data?.items.length === 0 && <p className={ui.muted}>{en.moderation.cleanHistory}</p>}
          <ul className={ui.list}>
            {query.data?.items.map((item) => (
              <li key={item.id} className={ui.item}>
                <div className={ui.itemBody}>
                  <p className={ui.text}>
                    {en.moderation.actions[item.type as keyof typeof en.moderation.actions] ?? item.type}
                    {item.title ? ` · ${item.title}` : ''} · {formatDate(item.createdAt)}
                  </p>
                  {item.guideline && (
                    <p className={ui.itemMeta}>
                      {format(en.moderation.rule, {
                        rule: GUIDELINES[item.guideline as GuidelineId] ?? item.guideline,
                      })}
                    </p>
                  )}
                  <p className={ui.itemMeta}>{format(en.moderation.reason, { reason: item.reason })}</p>
                  <p className={ui.itemMeta}>
                    {item.automated ? en.moderation.automated : en.moderation.byModerator}
                    {item.strikeExpiresAt
                      ? ` · ${format(en.moderation.strikeExpires, { date: formatDate(item.strikeExpiresAt) })}`
                      : ''}
                  </p>
                  {item.appeal && (
                    <p className={ui.itemMeta}>
                      {en.appeal.status[item.appeal.status]}
                      {item.appeal.decisionReason ? ` — ${item.appeal.decisionReason}` : ''}
                    </p>
                  )}
                </div>
                {item.canAppeal && (
                  <Button className={ui.small} onClick={() => setAppealing(item.id)}>
                    {en.appeal.button}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      </Panel>
      <Panel title={en.moderation.myReports}>
        <QueryState
          loading={reports.isLoading}
          error={reports.error}
          onRetry={() => void reports.refetch()}
          empty={reports.data?.items.length === 0}
          emptyText={en.moderation.noReports}
        >
          <ul className={ui.list}>
            {reports.data?.items.map((report) => (
              <li key={report.id} className={ui.item}>
                <div className={ui.itemBody}>
                  <p className={ui.text}>
                    {en.report.reasons[report.reason as keyof typeof en.report.reasons] ?? report.reason} ·{' '}
                    {en.moderation.reportStatus[report.status as keyof typeof en.moderation.reportStatus] ??
                      report.status}
                  </p>
                  <p className={ui.itemMeta}>{formatDate(report.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </QueryState>
      </Panel>
      {appealing && <AppealDialog actionId={appealing} onClose={() => setAppealing(null)} />}
    </>
  )
}
