// Moldura de todas as telas fora da Title Screen (documento 03, §3): barra com "Back", o nome da
// tela, o sino e o menu do avatar; `Esc` volta, como no jogo.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import type { NotificationItem } from '../api/types.ts'
import { hasPendingChanges } from '../book/offline.ts'
import { en } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Avatar, ButtonLink, Confirm, cx, ui } from '../ui/kit.tsx'
import { logout, useMe } from './session.ts'

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · quillframe` : 'quillframe'
    return () => {
      document.title = 'quillframe'
    }
  }, [title])
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Consulta a cada 60 s e pausa quando a aba não está visível (documento 03, §7.4). */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: NotificationItem[] }>('/api/me/notifications'),
    enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}

export function useLogout() {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const run = async () => {
    await logout()
    void navigate('/')
  }
  const start = async () => {
    if (await hasPendingChanges()) setConfirming(true)
    else await run()
  }
  const dialog = confirming ? (
    <Confirm
      title={en.nav.logOut}
      message={en.nav.unsavedLogout}
      confirmLabel={en.nav.logOut}
      danger
      onConfirm={() => void run()}
      onClose={() => setConfirming(false)}
    />
  ) : null
  return { start: () => void start(), dialog }
}

function UserMenu() {
  const { data: me } = useMe()
  const notifications = useNotifications(Boolean(me))
  const [open, setOpen] = useState(false)
  const logoutFlow = useLogout()
  if (!me) {
    return (
      <div className={ui.topActions}>
        <ButtonLink to="/login" className={ui.small}>
          {en.nav.signIn}
        </ButtonLink>
      </div>
    )
  }
  const unread = notifications.data?.unread ?? 0
  return (
    <div className={ui.topActions}>
      <ButtonLink
        to="/notifications"
        className={ui.small}
        aria-label={unread > 0 ? `${en.nav.notifications} (${unread})` : en.nav.notifications}
      >
        {unread > 0 ? `🔔 ${unread}` : '🔔'}
      </ButtonLink>
      <div className={ui.menu}>
        <Button
          className={ui.small}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          {me.username}
        </Button>
        {open && (
          <ul className={ui.menuList} role="menu" onClick={() => setOpen(false)}>
            <li role="none">
              <ButtonLink role="menuitem" to={`/u/${me.username}`} wide>
                {en.nav.profile}
              </ButtonLink>
            </li>
            <li role="none">
              <ButtonLink role="menuitem" to="/settings" wide>
                {en.nav.options}
              </ButtonLink>
            </li>
            {me.role !== 'USER' && (
              <li role="none">
                <ButtonLink role="menuitem" to="/mod" wide>
                  {en.nav.moderation}
                </ButtonLink>
              </li>
            )}
            <li role="none">
              <Button role="menuitem" wide onClick={logoutFlow.start}>
                {en.nav.logOut}
              </Button>
            </li>
          </ul>
        )}
      </div>
      {logoutFlow.dialog}
    </div>
  )
}

export function Footer() {
  return (
    <footer className={ui.footer}>
      <p className={ui.text}>{en.app.disclaimer}</p>
      <p className={ui.text}>
        <Link to="/guidelines">{en.nav.guidelines}</Link> · <Link to="/terms">{en.nav.terms}</Link> ·{' '}
        <Link to="/privacy">{en.nav.privacy}</Link> · <Link to="/report-concern">{en.nav.reportConcern}</Link>
      </p>
    </footer>
  )
}

interface ScreenProps {
  title: string
  children: ReactNode
  /** Para onde "Back" e `Esc` levam; por padrão, a tela anterior */
  back?: string
  wide?: boolean
  /** Telas que tratam o `Esc` por conta própria (editor) */
  noEscape?: boolean
  actions?: ReactNode
}

export function Screen({ title, children, back, wide = false, noEscape = false, actions }: ScreenProps) {
  const navigate = useNavigate()
  const online = useOnline()
  useDocumentTitle(title)

  const goBack = () => {
    if (back) void navigate(back)
    else if (window.history.length > 1) void navigate(-1)
    else void navigate('/')
  }

  useEffect(() => {
    if (noEscape) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      // Num campo de texto, Esc só tira o foco
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        target.blur()
        return
      }
      goBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [back, noEscape])

  return (
    <div className={ui.screen}>
      <header>
        <a className={ui.skip} href="#content">
          {en.nav.skip}
        </a>
        {!online && (
          <p className={ui.offline} role="status">
            {en.common.offline}
          </p>
        )}
        <div className={ui.topBar}>
          <Button className={ui.small} onClick={goBack}>
            {en.common.back}
          </Button>
          <h1 className={ui.topTitle}>{title}</h1>
          {actions}
          <UserMenu />
        </div>
      </header>
      <main id="content" className={cx(ui.main, wide && ui.mainWide)}>
        {children}
      </main>
      <Footer />
    </div>
  )
}

export function sessionExpired(): void {
  toast(en.auth.sessionExpired, 'error')
}

export function UserLink({ username, avatarId }: { username: string; avatarId?: number }) {
  return (
    <Link to={`/u/${username}`} className={ui.link}>
      {avatarId !== undefined && <Avatar id={avatarId} name={username} />} {username}
    </Link>
  )
}
