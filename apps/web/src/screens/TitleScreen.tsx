// Title Screen (documento 03, §2.5): o menu principal, que varia com o login.
import { useState } from 'react'
import { api, errorMessage } from '../api/client.ts'
import type { Me } from '../api/types.ts'
import { Footer, useDocumentTitle, useLogout } from '../app/Screen.tsx'
import { refreshMe, useMe } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { ButtonLink, formatDate, ui } from '../ui/kit.tsx'
import styles from './TitleScreen.module.css'

/** Avisos da conta: nada some nem trava sem explicação. */
function AccountNotice({ me }: { me: Me }) {
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await action()
      await refreshMe()
      toast(done)
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (me.status === 'PENDING_DELETION') {
    return (
      <div className={styles.notice} role="status">
        <p className={ui.text}>{en.title.pendingDeletion}</p>
        <Button disabled={busy} onClick={() => void run(() => api.post('/api/me/restore'), en.title.restored)}>
          {en.title.restore}
        </Button>
      </div>
    )
  }
  if (me.status === 'SUSPENDED' || me.status === 'BANNED') {
    return (
      <div className={styles.notice} role="status">
        <p className={ui.text}>
          {me.status === 'BANNED'
            ? en.title.banned
            : format(en.title.suspended, { date: formatDate(me.suspendedUntil) })}
        </p>
        <ButtonLink to="/settings/moderation">{en.title.seeWhy}</ButtonLink>
      </div>
    )
  }
  if (!me.emailVerified) {
    return (
      <div className={styles.notice} role="status">
        <p className={ui.text}>{en.title.verifyEmail}</p>
        <Button
          disabled={busy}
          onClick={() => void run(() => api.post('/api/auth/resend-verification', { email: me.email }), en.title.emailSent)}
        >
          {en.title.resendEmail}
        </Button>
      </div>
    )
  }
  return null
}

export function TitleScreen() {
  const { data: me, isLoading } = useMe()
  const [splash] = useState(() => en.splash[Math.floor(Math.random() * en.splash.length)])
  const logoutFlow = useLogout()
  useDocumentTitle('')

  return (
    <div className={styles.screen}>
      <main className={styles.center}>
        <div className={styles.logoArea}>
          <h1 className={styles.logo}>QUILLFRAME</h1>
          <p className={styles.splash} aria-hidden="true">
            {splash}
          </p>
        </div>
        {me && <AccountNotice me={me} />}
        {isLoading ? (
          <p className={ui.muted}>{en.common.loading}</p>
        ) : me ? (
          <>
            <ButtonLink wide to="/library">
              {en.title.myBooks}
            </ButtonLink>
            <ButtonLink wide to="/community">
              {en.title.community}
            </ButtonLink>
            <ButtonLink wide to="/friends">
              {en.title.friends}
            </ButtonLink>
            <div className={styles.row}>
              <ButtonLink to="/settings">{en.title.options}</ButtonLink>
              <Button onClick={logoutFlow.start}>{en.nav.logOut}</Button>
            </div>
          </>
        ) : (
          <>
            <ButtonLink wide to="/login">
              {en.auth.signIn}
            </ButtonLink>
            <ButtonLink wide to="/register">
              {en.auth.createAccount}
            </ButtonLink>
            <ButtonLink wide to="/community">
              {en.title.explore}
            </ButtonLink>
          </>
        )}
        {import.meta.env.DEV && (
          <ButtonLink wide to="/viewer">
            {en.title.bookViewer}
          </ButtonLink>
        )}
      </main>
      <div>
        <p className={styles.version}>{en.app.version}</p>
        <Footer />
      </div>
      {logoutFlow.dialog}
    </div>
  )
}
