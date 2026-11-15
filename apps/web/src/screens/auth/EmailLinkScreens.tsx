// Telas dos links de e-mail (documento 03, §4.3). O token chega no fragmento (#token=...): a página
// lê, apaga da barra de endereço e envia por POST. Assim ele não vai para logs nem para o Referer.
import { emailSchema, passwordSchema } from '@quillframe/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, ApiError, errorMessage } from '../../api/client.ts'
import { Screen } from '../../app/Screen.tsx'
import { refreshMe } from '../../app/session.ts'
import { en } from '../../strings/en.ts'
import { Button } from '../../ui/Button.tsx'
import { ButtonLink, Field, Panel, PasswordField, ui } from '../../ui/kit.tsx'
import { Turnstile } from '../../ui/Turnstile.tsx'

/** Lê o token do fragmento uma única vez e o tira da barra de endereço. */
export function useFragmentToken(): string | null {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token')
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
  })
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
  }, [])
  return token
}

export function VerifyEmailScreen() {
  const token = useFragmentToken()
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed')
  const [message, setMessage] = useState<string>(en.auth.linkInvalid)
  const sent = useRef(false)

  useEffect(() => {
    // O token vale uma vez: o efeito não pode enviá-lo duas vezes (StrictMode)
    if (!token || sent.current) return
    sent.current = true
    api
      .post('/api/auth/verify-email', { token }, { silent: true })
      .then(async () => {
        await refreshMe()
        setState('done')
      })
      .catch((cause: unknown) => {
        setMessage(errorMessage(cause))
        setState('failed')
      })
  }, [token])

  return (
    <Screen title={en.auth.verifyEmail} back="/">
      <Panel>
        <p className={`${state === 'failed' ? ui.error : ui.text} ${ui.center}`} role="status">
          {state === 'working' ? en.common.loading : state === 'done' ? en.auth.emailVerified : message}
        </p>
        <div className={ui.row}>
          <ButtonLink to="/">{en.common.backToTitle}</ButtonLink>
        </div>
      </Panel>
    </Screen>
  )
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/forgot-password', { email: parsed.data, turnstileToken: captcha ?? '' }, { silent: true })
      setSent(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'CAPTCHA_REQUIRED' ? en.auth.captchaNeeded : errorMessage(cause),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={en.auth.forgotTitle} back="/login">
      <Panel>
        {sent ? (
          // A resposta é sempre a mesma, exista ou não uma conta
          <p className={`${ui.text} ${ui.center}`} role="status">
            {en.auth.linkSent}
          </p>
        ) : (
          <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
            <p className={ui.text}>{en.auth.forgotIntro}</p>
            <Field
              label={en.auth.email}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={error ?? undefined}
              required
            />
            <Turnstile onToken={setCaptcha} />
            <div className={ui.row}>
              <Button type="submit" wide disabled={busy || email === ''}>
                {en.auth.sendLink}
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </Screen>
  )
}

export function ResetPasswordScreen() {
  const token = useFragmentToken()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = passwordSchema.safeParse(password)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/reset-password', { token, newPassword: password }, { silent: true })
      setDone(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={en.auth.resetTitle} back="/login">
      <Panel>
        {!token ? (
          <>
            <p className={`${ui.error} ${ui.center}`}>{en.auth.linkInvalid}</p>
            <p className={`${ui.text} ${ui.center}`}>
              <Link to="/forgot-password">{en.auth.requestNewLink}</Link>
            </p>
          </>
        ) : done ? (
          <>
            <p className={`${ui.text} ${ui.center}`} role="status">
              {en.auth.passwordReset}
            </p>
            <div className={ui.row}>
              <ButtonLink to="/login">{en.auth.signIn}</ButtonLink>
            </div>
          </>
        ) : (
          <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
            <PasswordField
              label={en.auth.newPassword}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={error ?? undefined}
              hint={en.auth.passwordHint}
              required
            />
            <div className={ui.row}>
              <Button type="submit" wide disabled={busy || password === ''}>
                {en.auth.changePassword}
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </Screen>
  )
}
