// Denunciar um livro ou um usuário, e recorrer de uma decisão (documento 03, §10.1 e §10.3).
import {
  appealSchema,
  MODERATION,
  REPORT_REASON_KEYS,
  REPORT_REASONS,
  reportSchema,
  type ReportReason,
} from '@quillframe/shared'
import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client.ts'
import { queryClient } from '../app/session.ts'
import { en } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Check, Dialog, Field, TextArea, ui } from '../ui/kit.tsx'

export function ReportDialog({
  targetType,
  targetId,
  pageIndex,
  pageCount,
  onClose,
}: {
  targetType: 'BOOK' | 'USER'
  targetId: string
  /** Página aberta no leitor, já preenchida */
  pageIndex?: number
  pageCount?: number
  onClose: () => void
}) {
  const reasons = REPORT_REASON_KEYS.filter((key) =>
    (REPORT_REASONS[key].targets as readonly string[]).includes(targetType),
  )
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [page, setPage] = useState(pageIndex === undefined ? '' : String(pageIndex + 1))
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const pageNumber = Number(page)
    const parsed = reportSchema.safeParse({
      targetType,
      targetId,
      reason,
      ...(targetType === 'BOOK' && page !== '' && Number.isInteger(pageNumber)
        ? { pageIndex: pageNumber - 1 }
        : {}),
      ...(details.trim() ? { details } : {}),
    })
    if (!parsed.success) {
      setError(reason ? (parsed.error.issues[0]?.message ?? en.common.error) : en.report.chooseReason)
      return
    }
    setBusy(true)
    try {
      await api.post('/api/reports', parsed.data)
      toast(en.report.thanks)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title={targetType === 'BOOK' ? en.report.bookTitle : en.report.userTitle} onClose={onClose}>
      <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className={ui.stack}>
          <legend className={ui.label}>{en.report.why}</legend>
          {reasons.map((key) => (
            <Check key={key} radio name="reason" checked={reason === key} onChange={() => setReason(key)}>
              {REPORT_REASONS[key].label}
            </Check>
          ))}
        </fieldset>
        {targetType === 'BOOK' && (
          <Field
            label={en.report.page}
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount}
            value={page}
            onChange={(event) => setPage(event.target.value)}
          />
        )}
        <TextArea
          label={en.report.details}
          value={details}
          maxLength={MODERATION.DETAILS_MAX}
          onChange={(event) => setDetails(event.target.value)}
          hint={en.report.confidential}
        />
        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}
        <div className={ui.row}>
          <Button type="submit" disabled={busy}>
            {en.report.send}
          </Button>
          <Button onClick={onClose}>{en.common.cancel}</Button>
        </div>
      </form>
    </Dialog>
  )
}

export function AppealDialog({ actionId, onClose }: { actionId: string; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = appealSchema.safeParse({ actionId, message })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? en.common.error)
      return
    }
    setBusy(true)
    try {
      await api.post('/api/appeals', parsed.data)
      await queryClient.invalidateQueries({ queryKey: ['moderation'] })
      await queryClient.invalidateQueries({ queryKey: ['book'] })
      toast(en.appeal.sent)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title={en.appeal.title} onClose={onClose}>
      <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
        <TextArea
          label={en.appeal.message}
          value={message}
          maxLength={MODERATION.REASON_MAX}
          onChange={(event) => setMessage(event.target.value)}
          error={error ?? undefined}
          hint={en.appeal.hint}
          required
        />
        <div className={ui.row}>
          <Button type="submit" disabled={busy || message.trim() === ''}>
            {en.appeal.send}
          </Button>
          <Button onClick={onClose}>{en.common.cancel}</Button>
        </div>
      </form>
    </Dialog>
  )
}
