// Componentes de interface compartilhados pelas telas (documento 03, §1.2).
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link, type LinkProps } from 'react-router'
import { errorMessage } from '../api/client.ts'
import { en } from '../strings/en.ts'
import { useToasts } from '../stores/app.ts'
import { Button } from './Button.tsx'
import { playClick } from './sounds.ts'
import styles from './ui.module.css'

export { styles as ui }

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      {title && <h2 className={styles.panelTitle}>{title}</h2>}
      {children}
    </section>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | undefined
  hint?: string | undefined
  /** Conteúdo ao lado do campo (botão de mostrar/ocultar, contador) */
  after?: ReactNode
}

export function Field({ label, error, hint, after, ...props }: FieldProps) {
  const id = useId()
  const describedBy = [error ? `${id}-error` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ')
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputRow}>
        <input
          id={id}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...props}
        />
        {after}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Campo de senha com mostrar/ocultar; colar e gerenciadores de senha são permitidos (documento 03, §11). */
export function PasswordField(props: Omit<FieldProps, 'type' | 'after'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      after={
        <Button className={styles.small} onClick={() => setVisible((value) => !value)} aria-pressed={visible}>
          {visible ? en.common.hide : en.common.show}
        </Button>
      }
    />
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string | undefined
  hint?: string | undefined
}

export function TextArea({ label, error, hint, ...props }: TextAreaProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className={styles.textarea} aria-invalid={error ? true : undefined} {...props} />
      {hint && <p className={styles.hint}>{hint}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: readonly { value: string; label: string }[]
}

export function Select({ label, options, ...props }: SelectProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select id={id} className={styles.select} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  children: ReactNode
  radio?: boolean
}

export function Check({ children, radio = false, ...props }: CheckProps) {
  return (
    <label className={styles.check}>
      <input type={radio ? 'radio' : 'checkbox'} {...props} />
      <span>{children}</span>
    </label>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === value}
          className={cx(styles.tab, tab.id === value && styles.tabActive)}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}

/** Link com cara de botão. */
export function ButtonLink({ wide, className, ...props }: LinkProps & { wide?: boolean }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        playClick()
        props.onClick?.(event)
      }}
      className={cx('qf-button', wide && 'qf-button-wide', className)}
    />
  )
}

export function LinkButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={cx(styles.linkButton, props.className)} />
}

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button')
    ;(first ?? ref.current)?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
      // O foco fica dentro do diálogo
      if (event.key === 'Tab' && ref.current) {
        const items = [
          ...ref.current.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href]'),
        ].filter((item) => !item.hasAttribute('disabled'))
        const head = items[0]
        const tail = items.at(-1)
        if (!head || !tail) return
        if (event.shiftKey && document.activeElement === head) {
          event.preventDefault()
          tail.focus()
        } else if (!event.shiftKey && document.activeElement === tail) {
          event.preventDefault()
          head.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
    // O diálogo é montado uma vez por abertura
  }, [])

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/** Confirmação simples ("Remove this page?"). */
export function Confirm({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className={cx(styles.text, styles.center)}>{message}</p>
      <div className={styles.row}>
        <Button
          className={danger ? styles.danger : undefined}
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </Button>
        <Button onClick={onClose}>{en.common.cancel}</Button>
      </div>
    </Dialog>
  )
}

export function Toasts() {
  const toasts = useToasts((state) => state.toasts)
  const dismiss = useToasts((state) => state.dismiss)
  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cx(styles.toast, item.kind === 'error' && styles.toastError)}
          onClick={() => dismiss(item.id)}
        >
          {item.message}
        </button>
      ))}
    </div>
  )
}

/** Os estados previstos em toda tela: carregando, erro (com "Retry") e vazio. */
export function QueryState({
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  children,
}: {
  loading: boolean
  error: unknown
  onRetry?: () => void
  empty?: boolean
  emptyText?: string
  children: ReactNode
}) {
  if (loading) return <p className={styles.muted}>{en.common.loading}</p>
  if (error) {
    return (
      <div className={styles.stack}>
        <p className={cx(styles.error, styles.center)} role="alert">
          {errorMessage(error)}
        </p>
        {onRetry && (
          <div className={styles.row}>
            <Button onClick={onRetry}>{en.common.retry}</Button>
          </div>
        )}
      </div>
    )
  }
  if (empty) return <p className={cx(styles.muted, styles.center)}>{emptyText ?? en.common.nothing}</p>
  return <>{children}</>
}

// Avatares pré-definidos: cabeças em pixel art geradas de uma paleta (arte própria, sem upload)
const SKIN = ['#f1c9a5', '#d9a066', '#8d5a3b', '#f7dcc0', '#b97a57', '#5d3a25']
const HAIR = ['#2b1d12', '#7a4a1e', '#d8b24a', '#b8402c', '#3a3f6b', '#e8e8e8']
const FACE = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SSSSSSSS', 'SWESSEWS', 'SSSNNSSS', 'SSMMMMSS', 'SSSSSSSS']

export function Avatar({ id, large = false, name }: { id: number; large?: boolean; name?: string }) {
  const skin = SKIN[id % SKIN.length] ?? '#f1c9a5'
  const hair = HAIR[Math.floor(id / 2) % HAIR.length] ?? '#2b1d12'
  const colors: Record<string, string> = {
    H: hair,
    S: skin,
    W: '#ffffff',
    E: '#2a2a5a',
    N: '#00000033',
    M: '#7a3b2e',
  }
  return (
    <svg
      className={cx(styles.avatar, large && styles.avatarLarge)}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      role="img"
      aria-label={name ? `${name}'s avatar` : 'Avatar'}
    >
      {FACE.flatMap((row, y) =>
        [...row].map((cell, x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colors[cell]} />
        )),
      )}
    </svg>
  )
}

/** Ícone de livro em pixel art (arte própria): encadernado para assinados, com pena para rascunhos. */
export function BookIcon({ signed }: { signed: boolean }) {
  const cover = signed ? '#7a2e2e' : '#8a5a2b'
  return (
    <svg className={styles.bookIcon} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="2" y="2" width="11" height="12" fill={cover} />
      <rect x="2" y="2" width="2" height="12" fill="#00000055" />
      <rect x="5" y="4" width="7" height="8" fill="#efe2bf" />
      <rect x="6" y="6" width="5" height="1" fill="#6b5a3a" />
      <rect x="6" y="8" width="4" height="1" fill="#6b5a3a" />
      {signed ? (
        <rect x="9" y="11" width="2" height="4" fill="#e8c04a" />
      ) : (
        <>
          <rect x="11" y="1" width="2" height="2" fill="#f4f4f4" />
          <rect x="10" y="3" width="2" height="2" fill="#f4f4f4" />
          <rect x="9" y="5" width="2" height="2" fill="#d8d8d8" />
        </>
      )}
    </svg>
  )
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "2 hours ago" */
export function formatRelative(value: string | Date): string {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export { cx }
