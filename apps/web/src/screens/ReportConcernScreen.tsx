// Report a Concern (documento 03, §10.2): o canal público do ECA Digital, acessível sem conta.
// Não é anônimo: a lei exige identificar quem notifica, e o e-mail é confirmado antes da análise.
import { CONCERN_RELATIONS, concernSchema, type ConcernRelation } from '@quillframe/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage } from '../api/client.ts'
import { Screen } from '../app/Screen.tsx'
import { en } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import { ButtonLink, Field, Panel, Select, TextArea, ui } from '../ui/kit.tsx'
import { Turnstile } from '../ui/Turnstile.tsx'
import { useFragmentToken } from './auth/EmailLinkScreens.tsx'

export default function ReportConcernScreen() {
  const token = useFragmentToken()
  return token ? <ConfirmConcern token={token} /> : <ConcernForm />
}

function ConfirmConcern({ token }: { token: string }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [message, setMessage] = useState('')
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    api
      .post('/api/concerns/confirm', { token }, { silent: true })
      .then(() => setState('done'))
      .catch((cause: unknown) => {
        setMessage(errorMessage(cause))
        setState('failed')
      })
  }, [token])
  return (
    <Screen title={en.concern.title} back="/">
      <Panel>
        <p className={`${state === 'failed' ? ui.error : ui.text} ${ui.center}`} role="status">
          {state === 'working' ? en.common.loading : state === 'done' ? en.concern.confirmed : message}
        </p>
        <div className={ui.row}>
          <ButtonLink to="/">{en.common.backToTitle}</ButtonLink>
        </div>
      </Panel>
    </Screen>
  )
}

function ConcernForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [relation, setRelation] = useState<ConcernRelation>('guardian')
  const [contentUrl, setContentUrl] = useState('')
  const [description, setDescription] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const parsed = concernSchema.safeParse({
      name,
      email,
      relation,
      contentUrl,
      description,
      turnstileToken: captcha ?? '',
    })
    if (!parsed.success) {
      const found: Record<string, string> = {}
      for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message
      setErrors(found)
      if (found['turnstileToken']) setFormError(en.auth.captchaNeeded)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await api.post('/api/concerns', parsed.data, { silent: true })
      setSent(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields.length > 0) {
        setErrors(Object.fromEntries(cause.fields.map((issue) => [issue.field, issue.message])))
      } else {
        setFormError(errorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Screen title={en.concern.title} back="/">
        <Panel>
          <p className={`${ui.text} ${ui.center}`} role="status">
            {en.concern.sent}
          </p>
        </Panel>
      </Screen>
    )
  }

  return (
    <Screen title={en.concern.title} back="/">
      <Panel>
        <p className={ui.text}>{en.concern.intro}</p>
        <p className={ui.warning}>{en.concern.notAnonymous}</p>
        <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
          <Field
            label={en.concern.name}
            autoComplete="name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            error={errors['name']}
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
          <Select
            label={en.concern.relation}
            value={relation}
            onChange={(event) => setRelation(event.target.value as ConcernRelation)}
            options={Object.entries(CONCERN_RELATIONS).map(([value, label]) => ({ value, label }))}
          />
          <Field
            label={en.concern.link}
            value={contentUrl}
            maxLength={300}
            onChange={(event) => setContentUrl(event.target.value)}
            error={errors['contentUrl']}
            required
          />
          <TextArea
            label={en.concern.what}
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            error={errors['description']}
            required
          />
          <Turnstile onToken={setCaptcha} />
          {formError && (
            <p className={ui.error} role="alert">
              {formError}
            </p>
          )}
          <div className={ui.row}>
            <Button type="submit" wide disabled={busy}>
              {en.concern.send}
            </Button>
          </div>
        </form>
      </Panel>
      <Panel>
        <p className={ui.text}>{en.concern.help}</p>
      </Panel>
    </Screen>
  )
}
