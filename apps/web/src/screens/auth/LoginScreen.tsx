// Sign In (documento 03, §4.2): e-mail e senha, Google, Discord e, se a conta tiver, o código 2FA.
import { loginSchema, safeReturnTo } from '@quillframe/shared'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, errorMessage } from '../../api/client.ts'
import { Screen } from '../../app/Screen.tsx'
import { queryClient, refreshMe, useConfig, useMe } from '../../app/session.ts'
import { en } from '../../strings/en.ts'
import { Button } from '../../ui/Button.tsx'
import { Field, LinkButton, Panel, PasswordField, ui } from '../../ui/kit.tsx'
import { Turnstile } from '../../ui/Turnstile.tsx'

const OAUTH_MESSAGES: Record<string, string> = {
  failed: en.auth.oauthFailed,
  unverified: en.auth.oauthUnverified,
  email_exists: en.auth.oauthEmailExists,
}

export function OAuthButtons() {
  const { data: config } = useConfig()
  if (!config?.oauth.google && !config?.oauth.discord) return null
  return (
    <div className={ui.stack}>
      {/* Links comuns: o fluxo OAuth é uma navegação de página inteira até o provedor */}
      {config.oauth.google && (
        <a className="qf-button qf-button-wide" href="/api/auth/oauth/google/start">
          {en.auth.continueGoogle}
        </a>
      )}
      {config.oauth.discord && (
        <a className="qf-button qf-button-wide" href="/api/auth/oauth/discord/start">
          {en.auth.continueDiscord}
        </a>
      )}
    </div>
  )
}

export function LoginScreen() {
  const { data: me, isLoading } = useMe()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const returnTo = safeReturnTo(params.get('returnTo'))
  const [step, setStep] = useState<'password' | 'mfa'>(params.get('mfa') === '1' ? 'mfa' : 'password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [needsCaptcha, setNeedsCaptcha] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(OAUTH_MESSAGES[params.get('oauth') ?? ''] ?? null)
  const [busy, setBusy] = useState(false)

  if (!isLoading && me) return <Navigate to={returnTo} replace />

  const done = async () => {
    queryClient.clear()
    await refreshMe()
    void navigate(returnTo, { replace: true })
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = loginSchema.safeParse({ email, password, ...(captcha ? { turnstileToken: captcha } : {}) })
    if (!parsed.success) {
      setError(en.auth.invalidCredentials)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', parsed.data, { silent: true })
      await done()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'MFA_REQUIRED') {
        setStep('mfa')
        setPassword('')
      } else if (cause instanceof ApiError && cause.code === 'CAPTCHA_REQUIRED') {
        setNeedsCaptcha(true)
        setError(en.auth.captchaNeeded)
      } else {
        setError(errorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login/mfa', useRecovery ? { recoveryCode: code } : { code }, { silent: true })
      await done()
    } catch (cause) {
      // Login pendente vencido ou tentativas esgotadas: volta para a senha
      if (cause instanceof ApiError && cause.code === 'UNAUTHENTICATED') {
        setStep('password')
        setCode('')
      }
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={en.auth.signIn} back="/">
      <Panel>
        {step === 'password' ? (
          <form className={ui.form} onSubmit={(event) => void submitPassword(event)} noValidate>
            <Field
              label={en.auth.email}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <PasswordField
              label={en.auth.password}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {needsCaptcha && <Turnstile onToken={setCaptcha} />}
            {error && (
              <p className={ui.error} role="alert">
                {error}
              </p>
            )}
            <div className={ui.row}>
              <Button type="submit" wide disabled={busy || email === '' || password === ''}>
                {en.auth.signIn}
              </Button>
            </div>
            <p className={`${ui.text} ${ui.center}`}>
              <Link to="/forgot-password">{en.auth.forgot}</Link>
            </p>
          </form>
        ) : (
          <form className={ui.form} onSubmit={(event) => void submitCode(event)} noValidate>
            <Field
              label={useRecovery ? en.auth.recoveryCode : en.auth.mfaPrompt}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoFocus
              required
            />
            {error && (
              <p className={ui.error} role="alert">
                {error}
              </p>
            )}
            <div className={ui.row}>
              <Button type="submit" wide disabled={busy || code === ''}>
                {en.auth.signIn}
              </Button>
            </div>
            <LinkButton
              onClick={() => {
                setUseRecovery((value) => !value)
                setCode('')
                setError(null)
              }}
            >
              {useRecovery ? en.auth.useAuthenticator : en.auth.useRecovery}
            </LinkButton>
          </form>
        )}
      </Panel>
      {step === 'password' && (
        <>
          <OAuthButtons />
          <p className={ui.text}>
            <Link to="/register">{en.auth.createAccount}</Link>
          </p>
        </>
      )}
    </Screen>
  )
}
