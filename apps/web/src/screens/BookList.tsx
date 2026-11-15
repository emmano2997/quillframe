// Lista de livros no estilo da lista de mundos e servidores do jogo (documento 03, §2.5 e §7.3).
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { BookSummary } from '../api/types.ts'
import { en, format } from '../strings/en.ts'
import { BookIcon, cx, formatDate, formatRelative, ui } from '../ui/kit.tsx'

const VISIBILITY_LABEL = { PRIVATE: en.book.private, FRIENDS: en.book.friends, PUBLIC: en.book.public } as const

export function bookBadge(book: BookSummary): { label: string; alert: boolean } {
  if (book.reviewState === 'PENDING_REVIEW') return { label: en.book.underReview, alert: true }
  if (book.reviewState === 'HIDDEN') return { label: en.book.hidden, alert: true }
  if (book.reviewState === 'REMOVED') return { label: en.book.removed, alert: true }
  if (book.status === 'DRAFT') return { label: en.book.draft, alert: false }
  return { label: VISIBILITY_LABEL[book.visibility], alert: false }
}

export function bookMeta(book: BookSummary, own: boolean): string {
  const pages = format(book.pageCount === 1 ? en.book.onePage : en.book.pages, { count: book.pageCount })
  const parts =
    book.status === 'DRAFT'
      ? [format(en.book.edited, { when: formatRelative(book.updatedAt) }), pages]
      : [
          own ? format(en.book.signedOn, { date: formatDate(book.signedAt) }) : format(en.reader.byAuthor, { author: book.author.username }),
          pages,
        ]
  if (book.likeCount > 0) parts.push(format(book.likeCount === 1 ? en.book.oneLike : en.book.likes, { count: book.likeCount }))
  return parts.join(' · ')
}

interface BookRowProps {
  book: BookSummary
  own?: boolean
  selected?: boolean
  /** Com `onSelect` a linha é um botão (My Books); sem ele, um link para o livro */
  onSelect?: () => void
  onOpen?: () => void
  extra?: ReactNode
}

export function BookRow({ book, own = false, selected = false, onSelect, onOpen, extra }: BookRowProps) {
  const badge = bookBadge(book)
  const body = (
    <>
      <BookIcon signed={book.status === 'SIGNED'} />
      <div className={ui.itemBody}>
        <p className={ui.itemTitle}>{book.title || en.editor.untitled}</p>
        <p className={ui.itemMeta}>{bookMeta(book, own)}</p>
      </div>
      {extra}
      {own && <span className={cx(ui.badge, badge.alert && ui.badgeAlert)}>{badge.label}</span>}
    </>
  )
  // O tooltip do livro: título, autor e páginas, como o dos itens do jogo
  const tooltip = `${book.title || en.editor.untitled}\n${format(en.reader.byAuthor, { author: book.author.username })}`
  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          className={cx(ui.item, selected && ui.itemSelected)}
          aria-pressed={selected}
          title={tooltip}
          onClick={onSelect}
          onDoubleClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <Link className={ui.item} to={book.status === 'DRAFT' ? `/editor/${book.id}` : `/book/${book.id}`} title={tooltip}>
          {body}
        </Link>
      )}
    </li>
  )
}

export function BookList({ books, own = false }: { books: BookSummary[]; own?: boolean }) {
  return (
    <ul className={ui.list}>
      {books.map((book) => (
        <BookRow key={book.id} book={book} own={own} />
      ))}
    </ul>
  )
}
