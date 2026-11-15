// Create Account (documento 03, §4.1) e Welcome, o onboarding de quem entra pelo Google ou Discord.
import {
  ACCOUNT,
  ageOn,
  oauthCompleteSchema,
  parseIsoDate,
  passwordLength,
  registerSchema,
  usernameSchema,
} from '@quillframe/shared'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, errorMessage } from '../../api/client.ts'
import { Screen } from '../../app/Screen.tsx'
import { queryClient, refreshMe } from '../../app/session.ts'
import { en, format } from '../../strings/en.ts'
import { Button } from '../../ui/Button.tsx'
import { Check, Field, Panel, PasswordField, ui } from '../../ui/kit.tsx'
import { Turnstile } from '../../ui/Turnstile.tsx'
import { OAuthButtons } from './LoginScreen.tsx'

// Quem informou menos de 16 não tenta de novo com outra data neste navegador (documento 03, §4.1).
// É só um marcador, não um dado pessoal.
const AGE_GATE_KEY = 'qf.ageGate'

function ageGateClosed(): boolean {
  try {
    return localStorage.getItem(AGE_GATE_KEY) === '1'
  } catch {
    return false
  }
}

function closeAgeGate(): void {
  try {
    localStorage.setItem(AGE_GATE_KEY, '1')
  } catch {
    // Sem armazenamento: o servidor continua recusando
  }
}

function isUnderage(birthDate: string): boolean {
  const date = parseIsoDate(birthDate)
  return date !== null && date.getTime() <= Date.now() && ageOn(date, new Date()) < ACCOUNT.MIN_AGE
}

/** Erros do zod por campo (a primeira mensagem de cada um). */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '')
    errors[field] ??= issue.message
  }
  return errors
}

/** Checagem ao vivo do username: ele é público, então a API responde se está livre. */
function useUsernameCheck(username: string): string | null {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setMessage(null)
    if (username === '') return
    const parsed = usernameSchema.safeParse(username)
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? null)
      return
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ available: boolean; reason?: string }>(
          `/api/auth/username-available?username=${encodeURIComponent(username)}`,
          { silent: true },
        )
        .then((result) => setMessage(result.available ? null : (result.reason ?? en.auth.usernameTaken)))
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [username])
  return message
}

/** Medidor simples, só como guia: quem decide é o servidor (tamanho, vazamentos, palavras do contexto). */
function strength(password: string): { label: string; className: string | undefined } | null {
  const length = passwordLength(password)
  if (length === 0) return null
  if (length < ACCOUNT.PASSWORD_MIN)
    return {
      label: format(en.auth.strengthShort, { missing: ACCOUNT.PASSWORD_MIN - length }),
      className: ui.error,
    }
  const words = password.trim().split(/\s+/).length
  if (length >= 24 || words >= 4) return { label: en.auth.strengthStrong, className: ui.success }
  return { label: en.auth.strengthOk, className: ui.warning }
}

function AgeBlocked() {
  return (
    <Screen title={en.auth.createAccount} back="/">
      <Panel>
        <p className={`${ui.text} ${ui.center}`}>{en.auth.underage}</p>
      </Panel>
    </Screen>
  )
}

export function RegisterScreen() {
  const [blocked, setBlocked] = useState(ageGateClosed)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [terms, setTerms] = useState(false)
  const [guidelines, setGuidelines] = useState(false)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const usernameIssue = useUsernameCheck(username)
  const meter = strength(password)

  if (blocked) return <AgeBlocked />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    if (isUnderage(birthDate)) {
      closeAgeGate()
      setBlocked(true)
      return
    }
    const parsed = registerSchema().safeParse({
      username,
      email,
      password,
      birthDate,
      acceptTerms: terms && guidelines,
      turnstileToken: captcha ?? '',
    })
    if (!parsed.success) {
      const found = fieldErrors(parsed.error.issues)
      setErrors(found)
      if (found['turnstileToken']) setFormError(en.auth.captchaNeeded)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await api.post('/api/auth/register', parsed.data, { silent: true })
      setSent(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.length > 0) {
        setErrors(Object.fromEntries(cause.fields.map((issue) => [issue.field, issue.message])))
      } else if (cause instanceof ApiError && ['BREACHED_PASSWORD', 'WEAK_PASSWORD'].includes(cause.code)) {
        setErrors({ password: cause.detail })
      } else if (cause instanceof ApiError && cause.code === 'NAME_NOT_ALLOWED') {
        setErrors({ username: cause.detail })
      } else {
        setFormError(errorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Screen title={en.auth.createAccount} back="/">
        <Panel>
          {/* A mesma resposta, exista ou não uma conta com o e-mail */}
          <p className={`${ui.text} ${ui.center}`} role="status">
            {en.auth.checkEmail}
          </p>
        </Panel>
      </Screen>
    )
  }

  return (
    <Screen title={en.auth.createAccount} back="/">
      <Panel>
        <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
          <Field
            label={en.auth.username}
            autoComplete="username"
            maxLength={ACCOUNT.USERNAME_MAX}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={errors['username'] ?? usernameIssue ?? undefined}
            hint={en.auth.usernameHint}
            required
          />
          <Field
            label={en.auth.email}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={errors['email']}
            required
          />
          <PasswordField
            label={en.auth.password}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors['password']}
            hint={en.auth.passwordHint}
            required
          />
          {meter && (
            <p className={meter.className} aria-live="polite">
              {meter.label}
            </p>
          )}
          <Field
            label={en.auth.birthDate}
            type="date"
            autoComplete="bday"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            error={errors['birthDate']}
            required
          />
          <Check checked={terms} onChange={(event) => setTerms(event.target.checked)}>
            {en.auth.agreeTermsStart} <Link to="/terms">{en.nav.terms}</Link> {en.auth.agreeTermsAnd}{' '}
            <Link to="/privacy">{en.nav.privacy}</Link>
          </Check>
          <Check checked={guidelines} onChange={(event) => setGuidelines(event.target.checked)}>
            {en.auth.agreeGuidelinesStart} <Link to="/guidelines">{en.nav.guidelines}</Link>
          </Check>
          {errors['acceptTerms'] && (
            <p className={ui.error} role="alert">
              {en.auth.mustAgree}
            </p>
          )}
          <Turnstile onToken={setCaptcha} />
          {formError && (
            <p className={ui.error} role="alert">
              {formError}
            </p>
          )}
          <div className={ui.row}>
            <Button type="submit" wide disabled={busy}>
              {en.auth.createAccount}
            </Button>
          </div>
        </form>
      </Panel>
      <OAuthButtons />
      <p className={ui.text}>
        <Link to="/login">{en.auth.haveAccount}</Link>
      </p>
    </Screen>
  )
}

/** Quem entra pela primeira vez pelo Google ou Discord: só depois disto a conta existe. */
export function WelcomeScreen() {
  const navigate = useNavigate()
  const [blocked, setBlocked] = useState(ageGateClosed)
  const [username, setUsername] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [terms, setTerms] = useState(false)
  const [guidelines, setGuidelines] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const usernameIssue = useUsernameCheck(username)

  if (blocked) return <AgeBlocked />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    if (isUnderage(birthDate)) {
      closeAgeGate()
      setBlocked(true)
      return
    }
    const parsed = oauthCompleteSchema().safeParse({ username, birthDate, acceptTerms: terms && guidelines })
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues))
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await api.post('/api/auth/oauth/complete', parsed.data, { silent: true })
      queryClient.clear()
      await refreshMe()
      void navigate('/', { replace: true })
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.length > 0) {
        setErrors(Object.fromEntries(cause.fields.map((issue) => [issue.field, issue.message])))
      } else if (cause instanceof ApiError && cause.code === 'NAME_NOT_ALLOWED') {
        setErrors({ username: cause.detail })
      } else {
        setFormError(errorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={en.auth.welcome} back="/">
      <Panel>
        <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
          <p className={ui.text}>{en.auth.welcomeIntro}</p>
          <Field
            label={en.auth.username}
            autoComplete="username"
            maxLength={ACCOUNT.USERNAME_MAX}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={errors['username'] ?? usernameIssue ?? undefined}
            hint={en.auth.usernameHint}
            required
          />
          <Field
            label={en.auth.birthDate}
            type="date"
            autoComplete="bday"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            error={errors['birthDate']}
            required
          />
          <Check checked={terms} onChange={(event) => setTerms(event.target.checked)}>
            {en.auth.agreeTermsStart} <Link to="/terms">{en.nav.terms}</Link> {en.auth.agreeTermsAnd}{' '}
            <Link to="/privacy">{en.nav.privacy}</Link>
          </Check>
          <Check checked={guidelines} onChange={(event) => setGuidelines(event.target.checked)}>
            {en.auth.agreeGuidelinesStart} <Link to="/guidelines">{en.nav.guidelines}</Link>
          </Check>
          {errors['acceptTerms'] && (
            <p className={ui.error} role="alert">
              {en.auth.mustAgree}
            </p>
          )}
          {formError && (
            <p className={ui.error} role="alert">
              {formError}
            </p>
          )}
          <div className={ui.row}>
            <Button type="submit" wide disabled={busy}>
              {en.common.continue}
            </Button>
          </div>
        </form>
      </Panel>
    </Screen>
  )
}
