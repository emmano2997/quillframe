// Written Book: o leitor (documento 03, §6), com o modo Play que vira as páginas em animação.
import {
  BOOK,
  GUIDELINES,
  layoutPage,
  LIMITS,
  stripFormatting,
  type GuidelineId,
  type Visibility,
} from '@quillframe/shared'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, ApiError, download, errorMessage } from '../api/client.ts'
import type { BookDetail, CommentPreset } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { queryClient, useMe } from '../app/session.ts'
import { selectionRects } from '../book/editorOps.ts'
import { INTERNAL_SCALE, type GlyphSource } from '../book/glyphs.ts'
import { PageCanvas, PageText, useBookGlyphs } from '../book/PageCanvas.tsx'
import { renderPage } from '../book/render.ts'
import { en, format } from '../strings/en.ts'
import { toast, usePreferences } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import {
  ButtonLink,
  Check,
  Confirm,
  cx,
  Field,
  formatDate,
  Panel,
  QueryState,
  Select,
  ui,
} from '../ui/kit.tsx'
import { playPageTurn } from '../ui/sounds.ts'
import { useGuiScale } from '../ui/useGuiScale.ts'
import styles from './ReaderScreen.module.css'
import { AppealDialog, ReportDialog } from './ReportDialog.tsx'
import { VerifyEmailNotice, VISIBILITY_OPTIONS } from './SignDialog.tsx'

const GENERATION = [en.reader.original, en.reader.copyOfOriginal, en.reader.copyOfCopy]
const THUMBS_PER_STEP = 40

export default function ReaderScreen() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['book', id], queryFn: () => api.get<BookDetail>(`/api/books/${id}`) })
  const missing = query.error instanceof ApiError && query.error.status === 404

  if (query.data?.status === 'DRAFT' && query.data.viewer.isOwner) {
    return <ReaderRedirect to={`/editor/${id}`} />
  }
  return (
    <Screen title={query.data?.title || en.reader.title} back="/community" wide>
      {missing ? (
        // Para quem não pode ver, o livro "não existe": a mesma mensagem para privado, oculto ou removido
        <Panel>
          <p className={cx(ui.text, ui.center)}>{en.reader.unavailable}</p>
        </Panel>
      ) : (
        <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
          {query.data && <Reader key={query.data.id} book={query.data} />}
        </QueryState>
      )}
    </Screen>
  )
}

function ReaderRedirect({ to }: { to: string }) {
  const navigate = useNavigate()
  useEffect(() => void navigate(to, { replace: true }), [navigate, to])
  return null
}

/** No celular o livro inteiro não cabe: mostra só a área de texto, em escala inteira (documento 03, §13). */
function useReaderScale(): { scale: number; compact: boolean } {
  const preference = usePreferences((state) => state.guiScale)
  const gui = useGuiScale(preference === 'auto' ? null : preference)
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  if (width >= 600)
    return { scale: Math.max(1, Math.min(gui, Math.floor((width - 16) / BOOK.imageWidth))), compact: false }
  return { scale: Math.max(1, Math.floor((width - 8) / (BOOK.textWidth + 8))), compact: true }
}

function Thumbnail({
  text,
  number,
  total,
  glyphs,
}: {
  text: string
  number: number
  total: number
  glyphs: GlyphSource
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx)
      renderPage(ctx, layoutPage(text), {
        glyphs,
        background: null,
        pageNumber: number,
        pageCount: total,
        random: () => 0,
      })
  }, [text, number, total, glyphs])
  return (
    <canvas
      ref={ref}
      className={styles.thumb}
      width={BOOK.imageWidth * INTERNAL_SCALE}
      height={BOOK.imageHeight * INTERNAL_SCALE}
      aria-hidden="true"
    />
  )
}

interface SearchHit {
  page: number
  /** Posição no texto bruto do primeiro e do último caractere do trecho */
  start: number
  end: number
  snippet: string
}

/** Busca no texto ignorando os códigos § (documento 03, §6). */
function searchBook(pages: string[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const hits: SearchHit[] = []
  pages.forEach((page, pageIndex) => {
    const glyphs = layoutPage(page).lines.flatMap((line) => line.glyphs)
    const plain = glyphs.map((glyph) => String.fromCodePoint(glyph.codePoint)).join('')
    // Um caractere por glifo: a posição no texto visível leva de volta ao texto bruto
    const lower = [...plain].map((ch) => ch.toLowerCase())
    const target = [...needle]
    for (let i = 0; i + target.length <= lower.length && hits.length < 100; i++) {
      if (!target.every((ch, offset) => lower[i + offset] === ch)) continue
      const first = glyphs[i]
      const last = glyphs[i + target.length - 1]
      if (!first || !last) continue
      const text = stripFormatting(page).replace(/\s+/g, ' ')
      const at = text.toLowerCase().indexOf(needle)
      hits.push({
        page: pageIndex,
        start: first.index,
        end: last.index + (last.codePoint > 0xffff ? 2 : 1),
        snippet: text.slice(Math.max(0, at - 16), at + needle.length + 24),
      })
      i += target.length - 1
    }
  })
  return hits
}

function Reader({ book }: { book: BookDetail }) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { scale, compact } = useReaderScale()
  const pages = useMemo(() => (book.pages.length > 0 ? book.pages : ['']), [book.pages])
  const glyphs = useBookGlyphs(pages)
  const [pageIndex, setPageIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [loop, setLoop] = useState(false)
  const [panel, setPanel] = useState<'pages' | 'search' | 'text' | null>(null)
  const [thumbs, setThumbs] = useState(THUMBS_PER_STEP)
  const [search, setSearch] = useState('')
  const [hit, setHit] = useState<SearchHit | null>(null)
  const [dialog, setDialog] = useState<'report' | 'appeal' | 'delete' | null>(null)
  const [liked, setLiked] = useState(book.viewer.liked)
  const [likeCount, setLikeCount] = useState(book.likeCount)
  const [favorited, setFavorited] = useState(book.viewer.favorited)
  const [copies, setCopies] = useState(book.viewer.copies)
  const touch = useRef<number | null>(null)
  const own = book.viewer.isOwner
  const interactive = book.reviewState === 'NONE' && book.status === 'SIGNED'
  const text = pages[pageIndex] ?? ''
  const last = pages.length - 1

  const goTo = useCallback(
    (index: number, options: { silent?: boolean } = {}) => {
      const target = Math.max(0, Math.min(last, index))
      setPageIndex((current) => {
        if (current !== target && !options.silent) playPageTurn()
        return target
      })
    },
    [last],
  )

  // Play: vira as páginas sozinho; no Play o som de página fica desligado
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setPageIndex((current) => {
        if (current < last) return current + 1
        if (loop) return 0
        setPlaying(false)
        return current
      })
    }, 1000 / speed)
    return () => window.clearInterval(timer)
  }, [playing, speed, loop, last])

  const turn = (index: number) => {
    setPlaying(false)
    setHit(null)
    goTo(index)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(pageIndex - 1)
    else if (event.key === 'ArrowRight' || event.key === 'PageDown') turn(pageIndex + 1)
    else if (event.key === 'Home') turn(0)
    else if (event.key === 'End') turn(last)
    else if (event.key === ' ' && target.tagName !== 'BUTTON' && target.tagName !== 'A')
      setPlaying((value) => !value)
    else return
    event.preventDefault()
  }

  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current
    touch.current = null
    const end = event.changedTouches[0]?.clientX
    if (start === null || end === undefined || Math.abs(end - start) < 40) return
    turn(pageIndex + (end < start ? 1 : -1))
  }

  const needLogin = (message: string): boolean => {
    if (me) return false
    toast(message)
    return true
  }

  // Like e favorito alternam na hora; se a API recusar, voltam
  const toggleLike = async () => {
    if (needLogin(en.reader.signInToLike)) return
    const next = !liked
    setLiked(next)
    setLikeCount((count) => count + (next ? 1 : -1))
    try {
      const result = await (next ? api.put : api.delete)<{ likeCount: number }>(`/api/books/${book.id}/like`)
      setLikeCount(result.likeCount)
    } catch (cause) {
      setLiked(!next)
      setLikeCount((count) => count + (next ? -1 : 1))
      toast(errorMessage(cause), 'error')
    }
  }

  const toggleFavorite = async () => {
    if (needLogin(en.reader.signInToFavorite)) return
    const next = !favorited
    setFavorited(next)
    try {
      await (next ? api.put : api.delete)(`/api/books/${book.id}/favorite`)
      void queryClient.invalidateQueries({ queryKey: ['library', 'favorites'] })
    } catch (cause) {
      setFavorited(!next)
      toast(errorMessage(cause), 'error')
    }
  }

  const makeCopy = async () => {
    if (needLogin(en.reader.signInToCopy)) return
    try {
      const copy = await api.post<{ id: string; generation: number }>(`/api/books/${book.id}/copy`)
      setCopies((items) => [...items, copy])
      void queryClient.invalidateQueries({ queryKey: ['library', 'copies'] })
      toast(en.reader.copied)
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    }
  }

  const share = async () => {
    const url = `${window.location.origin}/book/${book.id}`
    try {
      if (navigator.share && compact) await navigator.share({ title: book.title, url })
      else {
        await navigator.clipboard.writeText(url)
        toast(en.reader.linkCopied)
      }
    } catch {
      // A pessoa fechou o menu de compartilhar
    }
  }

  const hits = useMemo(() => searchBook(pages, search), [pages, search])
  const layout = useMemo(() => layoutPage(text), [text])
  const overlay = useMemo(
    () =>
      hit && hit.page === pageIndex
        ? { caret: null, selection: [], highlights: selectionRects(layout, hit.start, hit.end) }
        : undefined,
    [hit, pageIndex, layout],
  )
  const hasOriginalCopy = copies.some((copy) => copy.generation === 1)
  const canCopy = interactive && (book.allowCopies || own) && !hasOriginalCopy

  return (
    <div className={styles.reader} onKeyDown={onKeyDown}>
      <p className={cx(ui.text, ui.center)}>
        {format(en.reader.byAuthor, { author: '' })}
        <Link to={`/u/${book.author.username}`}>{book.author.username}</Link>
        {' · '}
        {GENERATION[0]}
        {book.signedAt && ` · ${formatDate(book.signedAt)}`}
        {' · '}
        {format(pages.length === 1 ? en.book.onePage : en.book.pages, { count: pages.length })}
      </p>

      <ReviewBanner book={book} onAppeal={() => setDialog('appeal')} />
      {pages.length > LIMITS.gamePages && own && (
        <p className={cx(ui.warning, ui.center)}>{en.editor.over100Pages}</p>
      )}

      <div
        tabIndex={0}
        className={styles.stage}
        aria-label={en.reader.bookLabel}
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={onTouchEnd}
      >
        <PageCanvas
          text={text}
          pageNumber={pageIndex + 1}
          pageCount={pages.length}
          glyphs={glyphs}
          scale={scale}
          compact={compact}
          overlay={overlay}
        />
        <PageText text={text} pageNumber={pageIndex + 1} pageCount={pages.length} />
      </div>

      <div className={ui.row}>
        {/* Como no jogo, os botões somem na primeira e na última página */}
        <Button
          className={cx(ui.small, pageIndex === 0 && styles.invisible)}
          onClick={() => turn(pageIndex - 1)}
          aria-label={en.reader.previousPage}
        >
          {'<'}
        </Button>
        <p className={ui.text}>
          {format(en.reader.pageIndicator, { page: pageIndex + 1, total: pages.length })}
        </p>
        <Button
          className={cx(ui.small, pageIndex >= last && styles.invisible)}
          onClick={() => turn(pageIndex + 1)}
          aria-label={en.reader.nextPage}
        >
          {'>'}
        </Button>
      </div>

      <div className={ui.row}>
        <Button
          disabled={pages.length < 2}
          aria-pressed={playing}
          onClick={() => {
            // Do fim, o Play recomeça do início
            if (!playing && pageIndex >= last) goTo(0, { silent: true })
            setPlaying((value) => !value)
          }}
        >
          {playing ? en.reader.pause : en.reader.play}
        </Button>
        <label className={styles.speed}>
          <span>{format(en.reader.speed, { speed })}</span>
          <input
            type="range"
            min={1}
            max={20}
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
        </label>
        <Button
          className={cx(ui.small, loop && ui.tabActive)}
          aria-pressed={loop}
          onClick={() => setLoop((value) => !value)}
        >
          {en.reader.loop}
        </Button>
        <Button
          className={cx(ui.small, panel === 'pages' && ui.tabActive)}
          onClick={() => setPanel(panel === 'pages' ? null : 'pages')}
        >
          {en.reader.pages}
        </Button>
        <Button
          className={cx(ui.small, panel === 'search' && ui.tabActive)}
          onClick={() => setPanel(panel === 'search' ? null : 'search')}
        >
          {en.reader.search}
        </Button>
        <Button
          className={cx(ui.small, panel === 'text' && ui.tabActive)}
          onClick={() => setPanel(panel === 'text' ? null : 'text')}
        >
          {en.reader.textViewButton}
        </Button>
      </div>

      {panel === 'pages' && (
        <Panel title={en.reader.pages}>
          <div className={styles.thumbs}>
            {pages.slice(0, thumbs).map((page, index) => (
              <button
                key={index}
                type="button"
                className={cx(styles.thumbButton, index === pageIndex && styles.thumbActive)}
                aria-label={format(en.reader.goToPage, { page: index + 1 })}
                onClick={() => turn(index)}
              >
                <Thumbnail text={page} number={index + 1} total={pages.length} glyphs={glyphs} />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
          {thumbs < pages.length && (
            <div className={ui.row}>
              <Button onClick={() => setThumbs((count) => count + THUMBS_PER_STEP)}>
                {en.common.loadMore}
              </Button>
            </div>
          )}
        </Panel>
      )}

      {panel === 'search' && (
        <Panel title={en.reader.search}>
          <Field
            label={en.reader.searchLabel}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          {search.trim().length >= 2 && hits.length === 0 && (
            <p className={ui.muted}>{en.reader.noResults}</p>
          )}
          <ul className={ui.list}>
            {hits.map((item, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={ui.item}
                  onClick={() => {
                    setPlaying(false)
                    goTo(item.page)
                    setHit(item)
                  }}
                >
                  {format(en.reader.searchHit, { page: item.page + 1, snippet: item.snippet })}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {panel === 'text' && (
        <Panel title={format(en.reader.pageIndicator, { page: pageIndex + 1, total: pages.length })}>
          {/* O texto da página como texto de verdade, sem os códigos */}
          <pre className={cx(ui.pre, ui.readable)}>{stripFormatting(text) || en.reader.emptyPage}</pre>
        </Panel>
      )}

      {interactive && (
        <>
          <div className={ui.row}>
            <Button
              className={liked ? ui.tabActive : undefined}
              aria-pressed={liked}
              onClick={() => void toggleLike()}
            >
              {format(en.reader.like, { count: likeCount })}
            </Button>
            <Button
              className={favorited ? ui.tabActive : undefined}
              aria-pressed={favorited}
              onClick={() => void toggleFavorite()}
            >
              {favorited ? en.reader.favorited : en.reader.favorite}
            </Button>
            {canCopy && <Button onClick={() => void makeCopy()}>{en.reader.makeCopy}</Button>}
            {hasOriginalCopy && <ButtonLink to="/library?tab=copies">{en.reader.inCopies}</ButtonLink>}
            {book.visibility !== 'PRIVATE' && <Button onClick={() => void share()}>{en.reader.share}</Button>}
            {!own && (
              <Button onClick={() => (needLogin(en.reader.signInToReport) ? undefined : setDialog('report'))}>
                {en.reader.report}
              </Button>
            )}
          </div>
          {me && !me.emailVerified && <VerifyEmailNotice />}
          <Comments book={book} />
        </>
      )}

      {own && <OwnerPanel book={book} onDelete={() => setDialog('delete')} />}

      {dialog === 'report' && (
        <ReportDialog
          targetType="BOOK"
          targetId={book.id}
          pageIndex={pageIndex}
          pageCount={pages.length}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'appeal' && book.moderation && (
        <AppealDialog actionId={book.moderation.actionId} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && (
        <Confirm
          title={en.reader.deleteBook}
          message={format(en.library.deleteConfirm, { title: book.title })}
          confirmLabel={en.library.delete}
          danger
          onConfirm={() =>
            void api
              .delete(`/api/books/${book.id}`)
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: ['library'] })
                void navigate('/library?tab=signed')
              })
              .catch((cause: unknown) => toast(errorMessage(cause), 'error'))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** Em revisão, oculto ou removido: só o dono vê, sempre com o motivo e o próximo passo. */
function ReviewBanner({ book, onAppeal }: { book: BookDetail; onAppeal: () => void }) {
  if (book.reviewState === 'NONE') return null
  const moderation = book.moderation
  return (
    <div className={styles.banner} role="status">
      <p className={ui.text}>
        {book.reviewState === 'PENDING_REVIEW'
          ? en.reader.underReview
          : book.reviewState === 'HIDDEN'
            ? en.reader.hidden
            : en.reader.removed}
      </p>
      {moderation && (
        <>
          <p className={ui.text}>
            {format(en.moderation.rule, {
              rule: moderation.guideline
                ? (GUIDELINES[moderation.guideline as GuidelineId] ?? moderation.guideline)
                : en.nav.guidelines,
            })}
          </p>
          <p className={ui.text}>{format(en.moderation.reason, { reason: moderation.reason })}</p>
          <p className={ui.muted}>
            {moderation.automated ? en.moderation.automated : en.moderation.byModerator}
          </p>
          {moderation.appealStatus ? (
            <p className={ui.text}>{en.appeal.status[moderation.appealStatus]}</p>
          ) : (
            <Button onClick={onAppeal}>{en.appeal.button}</Button>
          )}
        </>
      )}
    </div>
  )
}

/** Comentários predefinidos: etiquetas com contagem; clicar marca ou desmarca o seu. */
function Comments({ book }: { book: BookDetail }) {
  const { data: me } = useMe()
  const key = ['book', book.id, 'comments']
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ enabled: boolean; items: CommentPreset[] }>(`/api/books/${book.id}/comments`),
  })
  if (!query.data || (!query.data.enabled && query.data.items.every((item) => item.count === 0))) return null

  const toggle = async (preset: CommentPreset) => {
    if (!me) {
      toast(en.reader.signInToComment)
      return
    }
    try {
      await (preset.mine ? api.delete : api.put)(`/api/books/${book.id}/comments/${preset.presetId}`)
      await queryClient.invalidateQueries({ queryKey: key })
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    }
  }

  return (
    <Panel title={en.reader.comments}>
      <div className={cx(ui.row, ui.rowStart)}>
        {query.data.items
          .filter((preset) => query.data.enabled || preset.count > 0)
          .map((preset) => (
            <Button
              key={preset.presetId}
              className={cx(ui.small, Boolean(preset.mine) && ui.tabActive)}
              aria-pressed={Boolean(preset.mine)}
              disabled={!query.data.enabled && !preset.mine}
              title={preset.users.length > 0 ? preset.users.join(', ') : undefined}
              onClick={() => void toggle(preset)}
            >
              {preset.count > 0 ? `${preset.label} ${preset.count}` : preset.label}
            </Button>
          ))}
      </div>
      {!query.data.enabled && <p className={ui.muted}>{en.reader.commentsOff}</p>}
    </Panel>
  )
}

/** Visão do dono: visibilidade, cópias, comentários, exportar e excluir. */
function OwnerPanel({ book, onDelete }: { book: BookDetail; onDelete: () => void }) {
  const [visibility, setVisibility] = useState<Visibility>(book.visibility)
  const [guidelines, setGuidelines] = useState(false)
  const [allowCopies, setAllowCopies] = useState(book.allowCopies)
  const [allowComments, setAllowComments] = useState(book.allowComments)
  const changed = visibility !== book.visibility
  const shared = visibility !== 'PRIVATE'

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['book', book.id] })
  const fail = (cause: unknown) => toast(errorMessage(cause), 'error')

  const saveVisibility = () =>
    api
      .patch(`/api/books/${book.id}/visibility`, {
        visibility,
        ...(shared ? { acceptGuidelines: guidelines } : {}),
      })
      .then(async () => {
        await refresh()
        await queryClient.invalidateQueries({ queryKey: ['library'] })
        toast(en.reader.visibilitySaved)
      })
      .catch(fail)

  const setOption = (changes: { allowCopies?: boolean; allowComments?: boolean }) =>
    api.patch(`/api/books/${book.id}`, changes).then(refresh).catch(fail)

  return (
    <Panel title={en.reader.yourBook}>
      <Select
        label={en.sign.visibility}
        value={visibility}
        onChange={(event) => setVisibility(event.target.value as Visibility)}
        options={VISIBILITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
      {changed && shared && (
        <Check checked={guidelines} onChange={(event) => setGuidelines(event.target.checked)}>
          {en.sign.followsGuidelines} <Link to="/guidelines">{en.nav.guidelines}</Link>
        </Check>
      )}
      {changed && (
        <div className={cx(ui.row, ui.rowStart)}>
          <Button disabled={shared && !guidelines} onClick={() => void saveVisibility()}>
            {en.common.save}
          </Button>
        </div>
      )}
      <Check
        checked={allowCopies}
        onChange={(event) => {
          setAllowCopies(event.target.checked)
          void setOption({ allowCopies: event.target.checked })
        }}
      >
        {en.reader.allowCopies}
      </Check>
      <Check
        checked={allowComments}
        onChange={(event) => {
          setAllowComments(event.target.checked)
          void setOption({ allowComments: event.target.checked })
        }}
      >
        {en.reader.allowComments}
      </Check>
      <p className={ui.muted}>
        {format(en.reader.numbers, { likes: book.likeCount, favorites: book.favoriteCount })}
      </p>
      <div className={cx(ui.row, ui.rowStart)}>
        <Button onClick={() => void download(`/api/books/${book.id}/export`, 'book.stendhal').catch(fail)}>
          {en.editor.export}
        </Button>
        <Button className={ui.danger} onClick={onDelete}>
          {en.reader.deleteBook}
        </Button>
      </div>
    </Panel>
  )
}
