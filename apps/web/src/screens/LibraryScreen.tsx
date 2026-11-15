// My Books (documento 03, §2.5): Drafts, Signed, Copies e Favorites, como a tela de escolher mundo.
import { parseStendhal } from '@quillframe/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, download, errorMessage } from '../api/client.ts'
import type { BookSummary, CopyItem, Paged } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { queryClient } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Confirm, cx, QueryState, Tabs, ui } from '../ui/kit.tsx'
import { BookRow } from './BookList.tsx'

type Tab = 'drafts' | 'signed' | 'copies' | 'favorites'
const TABS: { id: Tab; label: string }[] = [
  { id: 'drafts', label: en.library.drafts },
  { id: 'signed', label: en.library.signed },
  { id: 'copies', label: en.library.copies },
  { id: 'favorites', label: en.library.favorites },
]
const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const GENERATION = [en.reader.original, en.reader.copyOfOriginal, en.reader.copyOfCopy]

interface Row {
  key: string
  book: BookSummary | null
  copyId?: string
  generation?: number
}

export default function LibraryScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((item) => item.id === params.get('tab'))?.id ?? 'drafts') as Tab
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const books = useInfiniteQuery({
    queryKey: ['library', tab],
    enabled: tab === 'drafts' || tab === 'signed',
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paged<BookSummary>>(
        `/api/me/books?status=${tab === 'drafts' ? 'draft' : 'signed'}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const copies = useQuery({
    queryKey: ['library', 'copies'],
    enabled: tab === 'copies',
    queryFn: () => api.get<{ items: CopyItem[] }>('/api/me/copies'),
  })
  const favorites = useQuery({
    queryKey: ['library', 'favorites'],
    enabled: tab === 'favorites',
    queryFn: () => api.get<{ items: BookSummary[] }>('/api/me/favorites'),
  })

  const active = tab === 'copies' ? copies : tab === 'favorites' ? favorites : books
  const rows: Row[] =
    tab === 'copies'
      ? (copies.data?.items ?? []).map((copy) => ({
          key: copy.id,
          book: copy.book,
          copyId: copy.id,
          generation: copy.generation,
        }))
      : tab === 'favorites'
        ? (favorites.data?.items ?? []).map((book) => ({ key: book.id, book }))
        : (books.data?.pages.flatMap((page) => page.items) ?? []).map((book) => ({ key: book.id, book }))
  const current = rows.find((row) => row.key === selected) ?? null
  const own = tab === 'drafts' || tab === 'signed'

  const open = (row: Row | null = current) => {
    if (!row?.book) return
    void navigate(row.book.status === 'DRAFT' ? `/editor/${row.book.id}` : `/book/${row.book.id}`)
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const book = await api.post<BookSummary>('/api/books')
      await queryClient.invalidateQueries({ queryKey: ['library'] })
      void navigate(`/editor/${book.id}`)
    })

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      toast(en.editor.importTooLarge, 'error')
      return
    }
    const content = await file.text()
    // O navegador confere o formato antes de enviar; o servidor confere de novo
    try {
      parseStendhal(content)
    } catch (cause) {
      toast(
        format(en.editor.importError, { message: cause instanceof Error ? cause.message : String(cause) }),
        'error',
      )
      return
    }
    await run(async () => {
      const book = await api.post<BookSummary>('/api/books/import', { content })
      await queryClient.invalidateQueries({ queryKey: ['library'] })
      toast(format(en.library.imported, { pages: book.pageCount }))
      void navigate(`/editor/${book.id}`)
    })
  }

  const remove = () =>
    run(async () => {
      if (!current) return
      if (tab === 'copies') await api.delete(`/api/me/copies/${current.copyId}`)
      else if (tab === 'favorites') await api.delete(`/api/books/${current.key}/favorite`)
      else await api.delete(`/api/books/${current.key}`)
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    })

  const empty = {
    drafts: en.library.emptyDrafts,
    signed: en.library.emptySigned,
    copies: en.library.emptyCopies,
    favorites: en.library.emptyFavorites,
  }[tab]

  return (
    <Screen title={en.title.myBooks} back="/" wide>
      <Tabs
        label={en.title.myBooks}
        tabs={TABS}
        value={tab}
        onChange={(next) => {
          setSelected(null)
          setParams({ tab: next }, { replace: true })
        }}
      />
      <QueryState
        loading={active.isLoading}
        error={active.error}
        onRetry={() => void active.refetch()}
        empty={rows.length === 0}
        emptyText={empty}
      >
        <ul className={ui.list}>
          {rows.map((row) =>
            row.book ? (
              <BookRow
                key={row.key}
                book={row.book}
                own={own}
                selected={row.key === selected}
                onSelect={() => setSelected(row.key)}
                onOpen={() => open(row)}
                extra={
                  row.generation ? <span className={ui.badge}>{GENERATION[row.generation]}</span> : undefined
                }
              />
            ) : (
              // O original saiu do ar: a cópia mostra que não está mais disponível
              <li key={row.key}>
                <button
                  type="button"
                  className={cx(ui.item, row.key === selected && ui.itemSelected)}
                  onClick={() => setSelected(row.key)}
                >
                  <span className={ui.muted}>{en.reader.unavailable}</span>
                </button>
              </li>
            ),
          )}
        </ul>
        {books.hasNextPage && own && (
          <Button onClick={() => void books.fetchNextPage()} disabled={books.isFetchingNextPage}>
            {en.common.loadMore}
          </Button>
        )}
      </QueryState>

      <div className={ui.row}>
        <Button disabled={!current?.book} onClick={() => open()}>
          {en.library.open}
        </Button>
        <Button disabled={busy} onClick={() => void create()}>
          {en.library.create}
        </Button>
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>
          {en.editor.import}
        </Button>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          aria-label={en.editor.importTitle}
          accept=".stendhal,.txt"
          tabIndex={-1}
          onChange={(event) => void onFile(event)}
        />
      </div>
      <div className={ui.row}>
        <Button
          disabled={!current?.book || !own || busy}
          onClick={() => void run(() => download(`/api/books/${current?.key}/export`, 'book.stendhal'))}
        >
          {en.editor.export}
        </Button>
        <Button disabled={!current || busy} onClick={() => setConfirmDelete(true)}>
          {own ? en.library.delete : en.library.remove}
        </Button>
      </div>

      {confirmDelete && current && (
        <Confirm
          title={own ? en.library.delete : en.library.remove}
          message={
            own
              ? format(en.library.deleteConfirm, { title: current.book?.title || en.editor.untitled })
              : en.library.removeConfirm
          }
          confirmLabel={own ? en.library.delete : en.library.remove}
          danger
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Screen>
  )
}
