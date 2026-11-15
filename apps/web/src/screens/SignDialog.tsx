// Assinar (documento 03, §5.12): título, visibilidade e, ao compartilhar, o aceite das diretrizes.
import { LIMITS, signBookSchema, type Visibility } from '@quillframe/shared'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, errorMessage } from '../api/client.ts'
import type { BookSummary } from '../api/types.ts'
import { queryClient, refreshMe, useMe } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Check, Dialog, Field, ui } from '../ui/kit.tsx'

export const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'PRIVATE', label: en.sign.keepPrivate },
  { value: 'FRIENDS', label: en.sign.shareFriends },
  { value: 'PUBLIC', label: en.sign.publish },
]

/** Aviso de e-mail não verificado, com "Resend email". */
export function VerifyEmailNotice() {
  const { data: me } = useMe()
  const [sent, setSent] = useState(false)
  if (!me || me.emailVerified) return null
  return (
    <div className={ui.stack}>
      <p className={ui.warning}>{en.sign.verifyFirst}</p>
      <div className={ui.row}>
        <Button
          disabled={sent}
          onClick={() =>
            void api
              .post('/api/auth/resend-verification', { email: me.email })
              .then(() => {
                setSent(true)
                toast(en.title.emailSent)
              })
              .catch((cause: unknown) => toast(errorMessage(cause), 'error'))
          }
        >
          {en.title.resendEmail}
        </Button>
        <Button onClick={() => void refreshMe()}>{en.sign.iVerified}</Button>
      </div>
    </div>
  )
}

export function SignDialog({
  bookId,
  author,
  initialTitle,
  pageCount,
  onClose,
}: {
  bookId: string
  author: string
  initialTitle: string
  pageCount: number
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const [title, setTitle] = useState(initialTitle)
  // "Keep private" vem marcado por padrão
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE')
  const [guidelines, setGuidelines] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shared = visibility !== 'PRIVATE'
  const blocked = shared && me?.emailVerified === false

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = signBookSchema.safeParse({ title, visibility, ...(shared ? { acceptGuidelines: guidelines } : {}) })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? en.common.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const book = await api.post<BookSummary>(`/api/books/${bookId}/sign`, parsed.data)
      await queryClient.invalidateQueries({ queryKey: ['library'] })
      queryClient.removeQueries({ queryKey: ['book', bookId] })
      // Se o filtro segurou o livro, o autor fica sabendo na hora
      toast(book.reviewState === 'PENDING_REVIEW' ? en.reader.underReview : en.sign.signed)
      void navigate(`/book/${bookId}`, { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError && cause.fields[0] ? cause.fields[0].message : errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog title={en.sign.title} onClose={onClose}>
      <form className={ui.form} onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={en.sign.bookTitle}
          value={title}
          maxLength={LIMITS.titleChars}
          onChange={(event) => setTitle(event.target.value)}
          after={
            <span className={ui.muted}>
              {title.length}/{LIMITS.titleChars}
            </span>
          }
          hint={title.length > LIMITS.gameTitleChars ? en.sign.longTitle : undefined}
          required
        />
        <p className={`${ui.muted} ${ui.center}`}>{format(en.reader.byAuthor, { author })}</p>
        <p className={ui.warning}>{en.sign.note}</p>
        {pageCount > LIMITS.gamePages && <p className={ui.warning}>{en.editor.over100Pages}</p>}
        <fieldset className={ui.stack}>
          <legend className="sr-only">{en.sign.visibility}</legend>
          {VISIBILITY_OPTIONS.map((option) => (
            <Check
              key={option.value}
              radio
              name="visibility"
              checked={visibility === option.value}
              onChange={() => setVisibility(option.value)}
            >
              {option.label}
            </Check>
          ))}
        </fieldset>
        {shared && !blocked && (
          <Check checked={guidelines} onChange={(event) => setGuidelines(event.target.checked)}>
            {en.sign.followsGuidelines}{' '}
            <Link to="/guidelines" target="_blank">
              {en.nav.guidelines}
            </Link>
          </Check>
        )}
        {blocked && <VerifyEmailNotice />}
        {error && (
          <p className={ui.error} role="alert">
            {error}
          </p>
        )}
        <div className={ui.row}>
          <Button type="submit" disabled={busy || blocked || title.trim() === '' || (shared && !guidelines)}>
            {en.sign.signAndClose}
          </Button>
          <Button onClick={onClose}>{en.common.cancel}</Button>
        </div>
      </form>
    </Dialog>
  )
}
