// Two-Factor Authentication (documento 03, §8). O QR code é gerado no navegador a partir da URI
// otpauth://: o segredo nunca vai para um serviço externo. Segredo e códigos aparecem uma única vez.
import { totpCodeSchema } from '@quillframe/shared'
import qrcode from 'qrcode-generator'
import { useMemo, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client.ts'
import type { Me } from '../api/types.ts'
import { refreshMe } from '../app/session.ts'
import { en } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Check, cx, Dialog, Field, Panel, ui } from '../ui/kit.tsx'

function QrCode({ value }: { value: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const size = qr.getModuleCount()
    return {
      size,
      dark: Array.from({ length: size * size }, (_, i) => qr.isDark(Math.floor(i / size), i % size)),
    }
  }, [value])
  const quiet = 4
  const total = cells.size + quiet * 2
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width="200"
      height="200"
      shapeRendering="crispEdges"
      role="img"
      aria-label={en.mfa.qrLabel}
    >
      <rect width={total} height={total} fill="#fff" />
      {cells.dark.map((dark, index) =>
        dark ? (
          <rect
            key={index}
            x={(index % cells.size) + quiet}
            y={Math.floor(index / cells.size) + quiet}
            width="1"
            height="1"
            fill="#000"
          />
        ) : null,
      )}
    </svg>
  )
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const text = codes.join('\n')
  const downloadCodes = () => {
    const url = URL.createObjectURL(
      new Blob([`quillframe recovery codes\n\n${text}\n`], { type: 'text/plain' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'quillframe-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    // Não fecha com Esc nem clicando fora: os códigos só aparecem esta vez
    <Dialog title={en.mfa.recoveryTitle} onClose={() => undefined}>
      <p className={ui.text}>{en.mfa.recoveryIntro}</p>
      <pre className={cx(ui.pre, ui.readable)}>{text}</pre>
      <div className={ui.row}>
        <Button onClick={downloadCodes}>{en.mfa.download}</Button>
        <Button
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast(en.mfa.copied),
              () => toast(en.editor.clipboardBlocked, 'error'),
            )
          }
        >
          {en.mfa.copy}
        </Button>
      </div>
      <Check checked={saved} onChange={(event) => setSaved(event.target.checked)}>
        {en.mfa.savedCodes}
      </Check>
      <div className={ui.row}>
        <Button disabled={!saved} onClick={onDone}>
          {en.common.done}
        </Button>
      </div>
    </Dialog>
  )
}

export function MfaSection({ me }: { me: Me }) {
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [busy, setBusy] = useState(false)

  const start = () =>
    api
      .post<{ uri: string; secret: string }>('/api/me/mfa/totp/setup')
      .then((result) => {
        setSetup(result)
        setCode('')
        setError(null)
      })
      .catch((cause: unknown) => toast(errorMessage(cause), 'error'))

  const submit = async (event: FormEvent, action: 'enable' | 'disable') => {
    event.preventDefault()
    const parsed = totpCodeSchema.safeParse(code)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? en.common.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (action === 'enable') {
        const result = await api.post<{ recoveryCodes: string[] }>('/api/me/mfa/totp/enable', {
          code: parsed.data,
        })
        setSetup(null)
        setCodes(result.recoveryCodes)
      } else {
        await api.delete('/api/me/mfa/totp', { code: parsed.data })
        setDisabling(false)
        toast(en.mfa.turnedOff)
      }
      setCode('')
      await refreshMe()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const regenerate = () =>
    api
      .post<{ recoveryCodes: string[] }>('/api/me/mfa/recovery-codes')
      .then((result) => setCodes(result.recoveryCodes))
      .catch((cause: unknown) => toast(errorMessage(cause), 'error'))

  const codeField = (
    <Field
      label={en.auth.mfaPrompt}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={code}
      onChange={(event) => setCode(event.target.value)}
      error={error ?? undefined}
      autoFocus
    />
  )

  return (
    <Panel title={en.mfa.title}>
      <p className={ui.text}>
        {me.mfaEnabled ? <span className={ui.success}>{en.mfa.on}</span> : en.mfa.off}
      </p>
      {me.role !== 'USER' && !me.mfaEnabled && <p className={ui.warning}>{en.mfa.staffRequired}</p>}
      <div className={cx(ui.row, ui.rowStart)}>
        {me.mfaEnabled ? (
          <>
            <Button onClick={() => void regenerate()}>{en.mfa.newCodes}</Button>
            <Button
              className={ui.danger}
              onClick={() => {
                setCode('')
                setError(null)
                setDisabling(true)
              }}
            >
              {en.mfa.turnOff}
            </Button>
          </>
        ) : (
          <Button onClick={() => void start()}>{en.mfa.turnOn}</Button>
        )}
      </div>

      {setup && (
        <Dialog title={en.mfa.setupTitle} onClose={() => setSetup(null)}>
          <form className={ui.form} onSubmit={(event) => void submit(event, 'enable')} noValidate>
            <p className={ui.text}>{en.mfa.scan}</p>
            <div className={ui.row}>
              <QrCode value={setup.uri} />
            </div>
            <p className={ui.muted}>{en.mfa.manual}</p>
            <pre className={cx(ui.pre, ui.readable)}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</pre>
            {codeField}
            <div className={ui.row}>
              <Button type="submit" disabled={busy || code === ''}>
                {en.mfa.turnOn}
              </Button>
              <Button onClick={() => setSetup(null)}>{en.common.cancel}</Button>
            </div>
          </form>
        </Dialog>
      )}
      {disabling && (
        <Dialog title={en.mfa.turnOff} onClose={() => setDisabling(false)}>
          <form className={ui.form} onSubmit={(event) => void submit(event, 'disable')} noValidate>
            <p className={ui.text}>{en.mfa.turnOffIntro}</p>
            {codeField}
            <div className={ui.row}>
              <Button type="submit" className={ui.danger} disabled={busy || code === ''}>
                {en.mfa.turnOff}
              </Button>
              <Button onClick={() => setDisabling(false)}>{en.common.cancel}</Button>
            </div>
          </form>
        </Dialog>
      )}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
    </Panel>
  )
}
