// Book and Quill: o editor (documento 03, §5). A entrada real é uma <textarea> com o texto bruto da
// página (com os códigos §); o canvas ao lado mostra o livro como o jogo desenha.
import {
  BOOK,
  COLOR_CODES,
  COLORS,
  layoutPage,
  LIMITS,
  parseStendhal,
  sanitizeLine,
  sanitizePageContent,
  serializeStendhal,
  stendhalIssues,
  truncateUtf16,
  type FormatCode,
  type StendhalBook,
} from '@quillframe/shared'
import { useQuery } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { api, download, errorMessage } from '../api/client.ts'
import type { BookDetail } from '../api/types.ts'
import { useDocumentTitle, useOnline } from '../app/Screen.tsx'
import { queryClient } from '../app/session.ts'
import {
  applyFormat,
  caretPosition,
  clearFormatting,
  countInvalidCodes,
  fitChange,
  indexAtPoint,
  lineBounds,
  moveVertically,
  pageStats,
  selectionRects,
  styleAt,
  type Edit,
} from '../book/editorOps.ts'
import { clearPendingBook, loadPending } from '../book/offline.ts'
import { PageCanvas, useBookGlyphs, type Overlay } from '../book/PageCanvas.tsx'
import { BookSaver, type SaveState } from '../book/saver.ts'
import { en, format } from '../strings/en.ts'
import { toast, usePreferences } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Confirm, cx, Dialog, QueryState, Tabs, ui } from '../ui/kit.tsx'
import { playPageTurn } from '../ui/sounds.ts'
import { useGuiScale } from '../ui/useGuiScale.ts'
import styles from './EditorScreen.module.css'
import { SignDialog } from './SignDialog.tsx'
import { SymbolPicker } from './SymbolPicker.tsx'

const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const HISTORY_LIMIT = 200
/** Digitações seguidas neste intervalo viram um passo só do desfazer */
const HISTORY_MERGE_MS = 800

const SAVE_TEXT: Record<SaveState, string> = {
  saved: en.editor.saved,
  saving: en.editor.saving,
  offline: en.editor.offline,
  conflict: en.editor.conflict,
  error: en.editor.saveError,
}

interface Snapshot extends Edit {
  at: number
}

type ConfirmState = { title: string; message: string; label: string; run: () => void } | null

export default function EditorScreen() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: ['book', id, 'edit'],
    queryFn: () => api.get<BookDetail>(`/api/books/${id}`),
    staleTime: 0,
    gcTime: 0,
  })
  useDocumentTitle(query.data?.title || en.editor.untitled)

  if (query.data && (query.data.status !== 'DRAFT' || !query.data.viewer.isOwner)) {
    return <Navigate to={`/book/${id}`} replace />
  }
  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && <Editor key={`${query.data.id}:${query.dataUpdatedAt}`} book={query.data} reload={() => void query.refetch()} />}
    </QueryState>
  )
}

/** Escala do livro: a da interface, limitada ao que cabe na largura da tela. */
function useBookScale(): number {
  const preference = usePreferences((state) => state.guiScale)
  const gui = useGuiScale(preference === 'auto' ? null : preference)
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return Math.max(1, Math.min(gui, Math.floor((width - 16) / BOOK.imageWidth)))
}

function Editor({ book, reload }: { book: BookDetail; reload: () => void }) {
  const navigate = useNavigate()
  const online = useOnline()
  const scale = useBookScale()
  const [pages, setPages] = useState(() => (book.pages.length > 0 ? book.pages : ['']))
  const [pageIndex, setPageIndex] = useState(0)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [mode, setMode] = useState<'visual' | 'raw'>('visual')
  const [title, setTitle] = useState(book.title)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [dialog, setDialog] = useState<'sign' | 'symbols' | 'shortcuts' | null>(null)
  const [importPreview, setImportPreview] = useState<StendhalBook | null>(null)
  const [busy, setBusy] = useState(false)

  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const anchor = useRef(0)
  const history = useRef(new Map<number, { undo: Snapshot[]; redo: Snapshot[] }>())
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  const [saver] = useState(() => new BookSaver(book.id, book.version ?? 0, pages, setSaveState))
  useEffect(() => () => saver.dispose(), [saver])

  const text = pages[pageIndex] ?? ''
  const glyphs = useBookGlyphs(pages)
  const layout = useMemo(() => layoutPage(text), [text])
  const stats = pageStats(text)
  const activeStyle = styleAt(text, selection.start)

  // A <textarea> é a dona do caret: depois de cada alteração, a seleção dela acompanha o estado
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    if (element.value !== text) element.value = text
    if (element.selectionStart !== selection.start || element.selectionEnd !== selection.end) {
      element.setSelectionRange(selection.start, selection.end)
    }
  }, [text, selection])

  // Alterações que ficaram neste aparelho (sem conexão, aba fechada) voltam ao abrir o livro
  useEffect(() => {
    let current = true
    void loadPending(book.id).then((pending) => {
      if (!current || !pending) return
      const same = pending.pages.length === book.pages.length && pending.pages.every((page, i) => page === book.pages[i])
      if (same) {
        void clearPendingBook(book.id)
        return
      }
      setPages(pending.pages)
      setPageIndex((index) => Math.min(index, pending.pages.length - 1))
      saver
        .structural(pending.pages, (version) =>
          api.put(`/api/books/${book.id}/pages`, { pages: pending.pages, baseVersion: version }),
        )
        .then(() => clearPendingBook(book.id))
        .then(() => toast(en.editor.restored))
        .catch(() => setSaveState('conflict'))
    })
    return () => {
      current = false
    }
  }, [book, saver])

  const record = useCallback(
    (index: number) => {
      const entry = history.current.get(index) ?? { undo: [], redo: [] }
      history.current.set(index, entry)
      const last = entry.undo.at(-1)
      const now = Date.now()
      const previous = pagesRef.current[index] ?? ''
      // Digitação contínua vira um passo só
      if (!last || now - last.at > HISTORY_MERGE_MS) {
        entry.undo.push({ text: previous, selectionStart: selection.start, selectionEnd: selection.end, at: now })
        if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift()
      } else {
        last.at = now
      }
      entry.redo = []
    },
    [selection],
  )

  /** Grava uma alteração da página atual: histórico, estado e autosave. */
  const commit = useCallback(
    (edit: Edit, options: { history?: boolean } = {}) => {
      if (edit.text !== pagesRef.current[pageIndex]) {
        if (options.history !== false) record(pageIndex)
        const next = pagesRef.current.map((page, index) => (index === pageIndex ? edit.text : page))
        setPages(next)
        saver.update(next, pageIndex)
      }
      setSelection({ start: edit.selectionStart, end: edit.selectionEnd })
    },
    [pageIndex, record, saver],
  )

  /** Passa a alteração pelos limites da página (1024 caracteres, 14 linhas) antes de gravar. */
  const tryEdit = useCallback(
    (edit: Edit): boolean => {
      const fitted = fitChange(text, edit.text, edit.selectionEnd)
      if (fitted.rejected) {
        toast(en.editor.didNotFit, 'error')
        // A <textarea> já mostra o texto recusado: volta ao que estava
        if (textarea.current) textarea.current.value = text
        setSelection({ start: selection.start, end: selection.end })
        return false
      }
      if (fitted.truncated) {
        toast(en.editor.didNotFit, 'error')
        commit({ text: fitted.text, selectionStart: fitted.caret, selectionEnd: fitted.caret })
      } else {
        commit({ ...edit, text: fitted.text })
      }
      return true
    },
    [commit, selection, text],
  )

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const caret = event.target.selectionStart
    tryEdit({ text: event.target.value, selectionStart: caret, selectionEnd: caret })
  }

  const syncSelection = () => {
    const element = textarea.current
    if (!element) return
    setSelection((current) =>
      current.start === element.selectionStart && current.end === element.selectionEnd
        ? current
        : { start: element.selectionStart, end: element.selectionEnd },
    )
  }

  const focusInput = () => textarea.current?.focus({ preventScroll: true })

  const format_ = (code: FormatCode) => {
    tryEdit(applyFormat(text, selection.start, selection.end, code))
    focusInput()
  }

  const clearFormat = () => {
    commit(clearFormatting(text, selection.start, selection.end))
    focusInput()
  }

  const insertText = (value: string) => {
    const next = text.slice(0, selection.start) + value + text.slice(selection.end)
    const caret = selection.start + value.length
    tryEdit({ text: next, selectionStart: caret, selectionEnd: caret })
    focusInput()
  }

  const stepHistory = (direction: 'undo' | 'redo') => {
    const entry = history.current.get(pageIndex)
    const snapshot = entry?.[direction].pop()
    if (!entry || !snapshot) return
    entry[direction === 'undo' ? 'redo' : 'undo'].push({
      text,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      at: 0,
    })
    const next = pages.map((page, index) => (index === pageIndex ? snapshot.text : page))
    setPages(next)
    saver.update(next, pageIndex)
    setSelection({ start: snapshot.selectionStart, end: snapshot.selectionEnd })
  }

  const goToPage = (index: number) => {
    const target = Math.max(0, Math.min(pages.length - 1, index))
    if (target === pageIndex) return
    void saver.flush()
    playPageTurn()
    setPageIndex(target)
    setSelection({ start: 0, end: 0 })
  }

  /** Operação que muda a estrutura do livro: salva o pendente, chama a API e só então troca as páginas. */
  const restructure = async (next: string[], call: (version: number) => Promise<{ version: number }>, index: number) => {
    setBusy(true)
    try {
      await saver.structural(next, call)
      history.current.clear()
      setPages(next)
      setPageIndex(Math.max(0, Math.min(next.length - 1, index)))
      setSelection({ start: 0, end: 0 })
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setBusy(false)
    }
  }

  const addPage = () => {
    if (pages.length >= LIMITS.sitePages) {
      toast(format(en.editor.tooManyPages, { max: LIMITS.sitePages }), 'error')
      return
    }
    const index = pageIndex + 1
    const next = [...pages.slice(0, index), '', ...pages.slice(index)]
    void restructure(next, (version) => api.post(`/api/books/${book.id}/pages`, { index, baseVersion: version }), index)
  }

  const removePage = () => {
    const run = () => {
      const next = pages.length === 1 ? [''] : pages.filter((_, index) => index !== pageIndex)
      void restructure(
        next,
        (version) => api.delete(`/api/books/${book.id}/pages/${pageIndex}`, { baseVersion: version }),
        Math.min(pageIndex, next.length - 1),
      )
    }
    if (text === '') run()
    else setConfirm({ title: en.editor.removePage, message: en.editor.removePageConfirm, label: en.editor.removePage, run })
  }

  const replaceAll = (next: string[], newTitle?: string) =>
    restructure(
      next,
      async (version) => {
        const result = await api.put<{ version: number }>(`/api/books/${book.id}/pages`, {
          pages: next,
          baseVersion: version,
        })
        if (newTitle !== undefined && newTitle !== title) {
          await api.patch(`/api/books/${book.id}`, { title: newTitle })
          setTitle(newTitle)
        }
        return result
      },
      0,
    )

  const clipboardWrite = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast(done)
    } catch {
      toast(en.editor.clipboardBlocked, 'error')
    }
  }

  const clipboardRead = async (): Promise<string | null> => {
    try {
      return await navigator.clipboard.readText()
    } catch {
      toast(en.editor.clipboardBlocked, 'error')
      return null
    }
  }

  const pastePage = async () => {
    const value = await clipboardRead()
    if (value === null) return
    const run = () => {
      const fitted = fitChange('', value, value.length)
      if (fitted.truncated) toast(en.editor.didNotFit, 'error')
      commit({ text: fitted.text, selectionStart: fitted.caret, selectionEnd: fitted.caret })
    }
    if (text === '') run()
    else setConfirm({ title: en.editor.pastePage, message: en.editor.pastePageConfirm, label: en.editor.pastePage, run })
  }

  const asStendhal = (): string | null => {
    const stendhal = { title, author: book.author.username, pages }
    const issues = stendhalIssues(stendhal)
    if (issues.length > 0) {
      toast(issues[0] ?? en.common.error, 'error')
      return null
    }
    return serializeStendhal(stendhal)
  }

  /** Mostra a prévia de um texto .stendhal antes de trocar o livro inteiro. */
  const previewImport = (content: string) => {
    try {
      setImportPreview(parseStendhal(content))
    } catch (cause) {
      toast(format(en.editor.importError, { message: cause instanceof Error ? cause.message : String(cause) }), 'error')
    }
  }

  const applyImport = (imported: StendhalBook) => {
    const next = (imported.pages.length === 0 ? [''] : imported.pages).map(sanitizePageContent)
    const tooLong = next.findIndex((page) => page.length > LIMITS.pageChars)
    if (tooLong !== -1) {
      toast(format(en.editor.importPageTooLong, { page: tooLong + 1 }), 'error')
      return
    }
    if (next.length > LIMITS.sitePages) {
      toast(format(en.editor.tooManyPages, { max: LIMITS.sitePages }), 'error')
      return
    }
    void replaceAll(next, truncateUtf16(sanitizeLine(imported.title), LIMITS.titleChars))
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      toast(en.editor.importTooLarge, 'error')
      return
    }
    previewImport(await file.text())
  }

  const saveTitle = async () => {
    const clean = truncateUtf16(sanitizeLine(title), LIMITS.titleChars)
    setTitle(clean)
    if (clean === book.title) return
    try {
      await api.patch(`/api/books/${book.id}`, { title: clean })
      book.title = clean
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    }
  }

  const done = async () => {
    await saver.flush()
    void queryClient.invalidateQueries({ queryKey: ['library'] })
    void navigate('/library')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const shortcut = (run: () => void) => {
      event.preventDefault()
      run()
    }
    if (event.key === 'Escape') return shortcut(() => void done())
    if (event.key === 'PageUp') return shortcut(() => goToPage(pageIndex - 1))
    if (event.key === 'PageDown') return shortcut(() => goToPage(pageIndex + 1))
    if (mod && event.key === 'Enter') return shortcut(addPage)
    if (mod && !event.shiftKey && key === 'b') return shortcut(() => format_('l'))
    if (mod && !event.shiftKey && key === 'i') return shortcut(() => format_('o'))
    if (mod && !event.shiftKey && key === 'u') return shortcut(() => format_('n'))
    if (mod && event.shiftKey && key === 'x') return shortcut(() => format_('m'))
    if (mod && event.shiftKey && key === 'k') return shortcut(() => format_('k'))
    if (mod && event.key === '\\') return shortcut(clearFormat)
    if (mod && !event.shiftKey && key === 'z') return shortcut(() => stepHistory('undo'))
    if (mod && (key === 'y' || (event.shiftKey && key === 'z'))) return shortcut(() => stepHistory('redo'))

    // No modo Visual as linhas são as do livro, não as da <textarea>: o editor move o caret
    if (mode !== 'visual' || mod || event.altKey) return
    const element = event.currentTarget
    const head = element.selectionDirection === 'backward' ? element.selectionStart : element.selectionEnd
    const tail = element.selectionDirection === 'backward' ? element.selectionEnd : element.selectionStart
    let target: number | null = null
    if (event.key === 'ArrowUp') target = moveVertically(text, head, -1)
    else if (event.key === 'ArrowDown') target = moveVertically(text, head, 1)
    else if (event.key === 'Home') target = lineBounds(text, head).start
    else if (event.key === 'End') target = lineBounds(text, head).end
    if (target === null) return
    event.preventDefault()
    if (event.shiftKey) {
      element.setSelectionRange(Math.min(tail, target), Math.max(tail, target), target < tail ? 'backward' : 'forward')
    } else {
      element.setSelectionRange(target, target)
    }
    syncSelection()
  }

  const onPoint = (x: number, y: number, phase: 'down' | 'move' | 'up') => {
    const index = indexAtPoint(layout, x, y)
    if (phase === 'down') {
      anchor.current = index
      focusInput()
    }
    const start = Math.min(anchor.current, index)
    const end = Math.max(anchor.current, index)
    textarea.current?.setSelectionRange(start, end, index < anchor.current ? 'backward' : 'forward')
    setSelection({ start, end })
  }

  const overlay: Overlay = useMemo(() => {
    const element = textarea.current
    const head = element?.selectionDirection === 'backward' ? selection.start : selection.end
    return {
      caret: focused && mode === 'visual' ? caretPosition(layout, head) : null,
      selection: selectionRects(layout, selection.start, selection.end),
    }
  }, [focused, layout, mode, selection])

  const invalid = countInvalidCodes(text)
  const charsClass = stats.chars >= LIMITS.pageChars ? ui.error : stats.chars > LIMITS.pageChars * 0.9 ? ui.warning : ui.muted
  const toggled = (on: boolean) => cx(styles.tool, on && ui.tabActive)

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Button className={ui.small} onClick={() => void done()}>
          {en.common.back}
        </Button>
        <input
          className={cx(ui.input, styles.title)}
          value={title}
          maxLength={LIMITS.titleChars}
          placeholder={en.editor.untitled}
          aria-label={en.editor.titleLabel}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
        />
        <p
          className={cx(styles.saveState, saveState === 'saved' ? ui.muted : saveState === 'saving' ? ui.text : ui.warning)}
          aria-live="polite"
        >
          {!online && saveState !== 'conflict' ? en.editor.offline : SAVE_TEXT[saveState]}
        </p>
        <Button className={ui.small} onClick={() => setDialog('shortcuts')}>
          {en.editor.shortcuts}
        </Button>
      </header>

      {pages.length > LIMITS.gamePages && <p className={cx(ui.warning, ui.center)}>{en.editor.over100Pages}</p>}
      <p className={cx(ui.muted, ui.center, styles.mobileHint)}>{en.editor.mobileHint}</p>

      <div className={styles.layout}>
        <aside className={styles.side} aria-label={en.editor.formatting}>
          <h2 className={ui.panelTitle}>{en.editor.colors}</h2>
          <div className={styles.colors}>
            {COLOR_CODES.map((code) => (
              <button
                key={code}
                type="button"
                className={cx(styles.color, activeStyle.color === code && styles.colorActive)}
                style={{ backgroundColor: COLORS[code].hex }}
                title={`${COLORS[code].name} (§${code})`}
                aria-label={COLORS[code].name}
                aria-pressed={activeStyle.color === code}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => format_(code)}
              />
            ))}
          </div>
          <h2 className={ui.panelTitle}>{en.editor.styles}</h2>
          <div className={styles.tools}>
            <Button className={toggled(activeStyle.bold)} aria-pressed={activeStyle.bold} onClick={() => format_('l')}>
              {en.editor.bold}
            </Button>
            <Button className={toggled(activeStyle.italic)} aria-pressed={activeStyle.italic} onClick={() => format_('o')}>
              {en.editor.italic}
            </Button>
            <Button className={toggled(activeStyle.underlined)} aria-pressed={activeStyle.underlined} onClick={() => format_('n')}>
              {en.editor.underline}
            </Button>
            <Button className={toggled(activeStyle.strikethrough)} aria-pressed={activeStyle.strikethrough} onClick={() => format_('m')}>
              {en.editor.strikethrough}
            </Button>
            <Button className={toggled(activeStyle.obfuscated)} aria-pressed={activeStyle.obfuscated} onClick={() => format_('k')}>
              {en.editor.obfuscated}
            </Button>
            <Button className={styles.tool} onClick={() => format_('r')}>
              {en.editor.reset}
            </Button>
            <Button className={styles.tool} onClick={clearFormat}>
              {en.editor.clearFormatting}
            </Button>
            <Button className={styles.tool} onClick={() => setDialog('symbols')}>
              {en.editor.symbols}
            </Button>
          </div>
        </aside>

        <section className={styles.center}>
          <div className={styles.bookRow}>
            <PageCanvas
              text={text}
              pageNumber={pageIndex + 1}
              pageCount={pages.length}
              glyphs={glyphs}
              scale={scale}
              overlay={overlay}
              label={en.editor.canvasLabel}
              onPoint={onPoint}
            />
            <div className={mode === 'raw' ? styles.rawPanel : styles.hiddenInput}>
              {mode === 'raw' && <p className={ui.muted}>{en.editor.rawHint}</p>}
              <textarea
                ref={textarea}
                className={mode === 'raw' ? cx(ui.textarea, styles.raw) : styles.textarea}
                defaultValue={text}
                aria-label={format(en.editor.pageInput, { page: pageIndex + 1 })}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoFocus
                onChange={onChange}
                onKeyDown={onKeyDown}
                onSelect={syncSelection}
                onKeyUp={syncSelection}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
              />
              {mode === 'raw' && invalid > 0 && (
                <p className={ui.warning}>{format(en.editor.invalidCodes, { count: invalid })}</p>
              )}
            </div>
          </div>
          <div className={ui.row}>
            <Button className={ui.small} onClick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0} aria-label={en.reader.previousPage}>
              {'<'}
            </Button>
            <p className={ui.text}>{format(en.reader.pageIndicator, { page: pageIndex + 1, total: pages.length })}</p>
            <Button
              className={ui.small}
              onClick={() => goToPage(pageIndex + 1)}
              disabled={pageIndex >= pages.length - 1}
              aria-label={en.reader.nextPage}
            >
              {'>'}
            </Button>
          </div>
          <p className={ui.text} aria-live="polite">
            <span className={charsClass}>
              {stats.chars}/{LIMITS.pageChars}
            </span>
            {' · '}
            <span className={stats.lines > BOOK.maxLines ? ui.error : ui.muted}>
              {format(en.editor.lines, { lines: stats.lines, max: BOOK.maxLines })}
            </span>
          </p>
          {stats.lines > BOOK.maxLines && <p className={cx(ui.warning, ui.center)}>{en.editor.hiddenLines}</p>}
          <Tabs
            label={en.editor.viewMode}
            tabs={[
              { id: 'visual', label: en.editor.visual },
              { id: 'raw', label: en.editor.raw },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next)
              window.setTimeout(focusInput, 0)
            }}
          />
        </section>

        <aside className={styles.side} aria-label={en.editor.pageTools}>
          <h2 className={ui.panelTitle}>{en.editor.page}</h2>
          <div className={styles.tools}>
            <Button className={styles.tool} disabled={busy} onClick={addPage}>
              {en.editor.addPage}
            </Button>
            <Button className={styles.tool} disabled={busy} onClick={removePage}>
              {en.editor.removePage}
            </Button>
            <Button className={styles.tool} onClick={() => void clipboardWrite(text, en.editor.pageCopied)}>
              {en.editor.copyPage}
            </Button>
            <Button className={styles.tool} onClick={() => void pastePage()}>
              {en.editor.pastePage}
            </Button>
            <Button
              className={styles.tool}
              disabled={text === ''}
              onClick={() =>
                setConfirm({
                  title: en.editor.clearPage,
                  message: en.editor.clearPageConfirm,
                  label: en.editor.clearPage,
                  run: () => commit({ text: '', selectionStart: 0, selectionEnd: 0 }),
                })
              }
            >
              {en.editor.clearPage}
            </Button>
          </div>
          <h2 className={ui.panelTitle}>{en.editor.book}</h2>
          <div className={styles.tools}>
            <Button
              className={styles.tool}
              onClick={() => {
                const content = asStendhal()
                if (content !== null) void clipboardWrite(content, en.editor.bookCopied)
              }}
            >
              {en.editor.copyBook}
            </Button>
            <Button
              className={styles.tool}
              disabled={busy}
              onClick={() => void clipboardRead().then((value) => value !== null && previewImport(value))}
            >
              {en.editor.pasteBook}
            </Button>
            <Button
              className={styles.tool}
              disabled={busy}
              onClick={() =>
                setConfirm({
                  title: en.editor.clearBook,
                  message: en.editor.clearBookConfirm,
                  label: en.editor.clearBook,
                  run: () => void replaceAll(['']),
                })
              }
            >
              {en.editor.clearBook}
            </Button>
            <Button className={styles.tool} disabled={busy} onClick={() => fileInput.current?.click()}>
              {en.editor.import}
            </Button>
            <input ref={fileInput} className="sr-only" type="file" accept=".stendhal,.txt" tabIndex={-1} onChange={(event) => void onFile(event)} />
            <Button
              className={styles.tool}
              onClick={() =>
                void saver
                  .flush()
                  .then(() => download(`/api/books/${book.id}/export`, 'book.stendhal'))
                  .catch((cause: unknown) => toast(errorMessage(cause), 'error'))
              }
            >
              {en.editor.export}
            </Button>
          </div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <Button wide disabled={busy} onClick={() => void saver.flush().then(() => setDialog('sign'))}>
          {en.editor.sign}
        </Button>
        <Button wide onClick={() => void done()}>
          {en.editor.done}
        </Button>
      </footer>

      {confirm && (
        <Confirm
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          danger
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
      {dialog === 'symbols' && <SymbolPicker onPick={insertText} onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'sign' && (
        <SignDialog
          bookId={book.id}
          author={book.author.username}
          initialTitle={title}
          pageCount={pages.length}
          onClose={() => setDialog(null)}
        />
      )}
      {importPreview && (
        <Dialog title={en.editor.importTitle} onClose={() => setImportPreview(null)}>
          <p className={ui.text}>{format(en.editor.importSummary, { title: importPreview.title || en.editor.untitled, pages: Math.max(1, importPreview.pages.length) })}</p>
          {importPreview.pages.length > LIMITS.gamePages && <p className={ui.warning}>{en.editor.over100Pages}</p>}
          <p className={ui.warning}>{en.editor.importReplaces}</p>
          <div className={ui.row}>
            <Button
              className={ui.danger}
              onClick={() => {
                const imported = importPreview
                setImportPreview(null)
                applyImport(imported)
              }}
            >
              {en.editor.importConfirm}
            </Button>
            <Button onClick={() => setImportPreview(null)}>{en.common.cancel}</Button>
          </div>
        </Dialog>
      )}
      {saveState === 'conflict' && (
        <Dialog title={en.editor.conflictTitle} onClose={() => undefined}>
          <p className={cx(ui.text, ui.center)}>{en.editor.conflict}</p>
          <div className={ui.row}>
            <Button onClick={() => void saver.overwrite().catch((cause: unknown) => toast(errorMessage(cause), 'error'))}>
              {en.editor.useThisVersion}
            </Button>
            <Button onClick={() => void clearPendingBook(book.id).then(reload)}>{en.editor.loadOtherVersion}</Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={en.editor.shortcutsTitle} onClose={onClose}>
      <ShortcutList />
      <div className={ui.row}>
        <Button onClick={onClose}>{en.common.close}</Button>
      </div>
    </Dialog>
  )
}

export function ShortcutList() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <table className={styles.shortcuts}>
      <tbody>
        {en.shortcuts.map(([keys, action]) => (
          <tr key={keys}>
            <th scope="row">{mac ? keys.replaceAll('Ctrl', 'Cmd') : keys}</th>
            <td>{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
