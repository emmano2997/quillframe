// "Confirm it's you": aparece quando a API responde REAUTH_REQUIRED; depois de confirmar, o cliente
// HTTP repete a ação (documento 03, §4.3).
import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client.ts'
import { en } from '../strings/en.ts'
import { useReauth } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog, Field, LinkButton, PasswordField, ui } from '../ui/kit.tsx'
import { useMe } from './session.ts'

export function ReauthDialog() {
  const pending = useReauth((state) => state.resolve)
  if (!pending) return null
  return <ReauthForm />
}

function ReauthForm() {
  const finish = useReauth((state) => state.finish)
  const { data: me } = useMe()
  // Conta só com Google/Discord não tem senha: confirma pelo código 2FA
  const canUsePassword = me?.hasPassword !== false
  const [mode, setMode] = useState<'password' | 'code'>(canUsePassword ? 'password' : 'code')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/reauth', mode === 'password' ? { password: value } : { code: value }, { silent: true })
      finish(true)
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title={en.reauth.title} onClose={() => finish(false)}>
      <form className={ui.form} onSubmit={(event) => void submit(event)}>
        <p className={ui.text}>{mode === 'password' ? en.reauth.password : en.reauth.code}</p>
        {mode === 'password' ? (
          <PasswordField
            label={en.auth.password}
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={error ?? undefined}
            required
          />
        ) : (
          <Field
            label={en.auth.mfaCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={error ?? undefined}
            required
          />
        )}
        {me?.mfaEnabled && canUsePassword && (
          <LinkButton
            onClick={() => {
              setMode(mode === 'password' ? 'code' : 'password')
              setValue('')
              setError(null)
            }}
          >
            {mode === 'password' ? en.reauth.useCode : en.reauth.usePassword}
          </LinkButton>
        )}
        <div className={ui.row}>
          <Button type="submit" disabled={busy || value === ''}>
            {en.common.continue}
          </Button>
          <Button onClick={() => finish(false)}>{en.common.cancel}</Button>
        </div>
      </form>
    </Dialog>
  )
}
