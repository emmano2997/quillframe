import { BOOK, LIMITS, layoutPage, splitLines, stripFormatting, type StendhalBook } from '@quillframe/shared'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { en, format } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import styles from './BookView.module.css'
import { INTERNAL_SCALE, type GlyphSource } from './glyphs.ts'
import { hasObfuscatedText, renderPage } from './render.ts'

interface BookViewProps {
  book: StendhalBook
  glyphs: GlyphSource
  background: CanvasImageSource | null
  /** Pixels de tela por pixel de GUI */
  scale: number
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Tamanho do livro em CSS para que cada pixel do canvas vire um número inteiro de pixels físicos,
 * inclusive em telas com zoom (devicePixelRatio 1,25, 1,5...). O canvas tem 2 pixels por pixel de
 * GUI, então a escala física fica num múltiplo de 2.
 */
function cssSize(guiScale: number): number {
  const dpr = window.devicePixelRatio || 1
  const deviceScale = Math.max(INTERNAL_SCALE, Math.floor((guiScale * dpr) / INTERNAL_SCALE) * INTERNAL_SCALE)
  return (BOOK.imageWidth * deviceScale) / dpr
}

export function BookView({ book, glyphs, background, scale }: BookViewProps) {
  const [pageIndex, setPageIndex] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageCount = Math.max(1, book.pages.length)
  const page = book.pages[pageIndex] ?? ''
  const layout = useMemo(() => layoutPage(page), [page])
  const overflow = splitLines(page).length > BOOK.maxLines

  useEffect(() => setPageIndex(0), [book])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const draw = () => renderPage(ctx, layout, { glyphs, background, pageNumber: pageIndex + 1, pageCount })
    draw()
    // §k troca os caracteres a cada quadro; com movimento reduzido, fica parado
    if (!hasObfuscatedText(layout) || reducedMotion()) return
    const timer = window.setInterval(draw, 50)
    return () => window.clearInterval(timer)
  }, [layout, glyphs, background, pageIndex, pageCount])

  const goTo = (index: number) => setPageIndex(Math.min(pageCount - 1, Math.max(0, index)))
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') goTo(pageIndex - 1)
    else if (event.key === 'ArrowRight' || event.key === 'PageDown') goTo(pageIndex + 1)
    else if (event.key === 'Home') goTo(0)
    else if (event.key === 'End') goTo(pageCount - 1)
    else return
    event.preventDefault()
  }

  const indicator = format(en.viewer.pageIndicator, { page: pageIndex + 1, total: pageCount })
  return (
    <div className={styles.view} onKeyDown={onKeyDown}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={BOOK.imageWidth * INTERNAL_SCALE}
        height={BOOK.imageHeight * INTERNAL_SCALE}
        style={{ width: cssSize(scale), height: cssSize(scale) }}
        role="img"
        aria-label={indicator}
        tabIndex={0}
      />
      <div className={styles.controls}>
        <Button onClick={() => goTo(pageIndex - 1)} disabled={pageIndex === 0}>
          {en.viewer.previousPage}
        </Button>
        <Button onClick={() => goTo(pageIndex + 1)} disabled={pageIndex >= pageCount - 1}>
          {en.viewer.nextPage}
        </Button>
      </div>
      {overflow && <p className={styles.notice}>{en.viewer.overflow}</p>}
      {book.pages.length > LIMITS.gamePages && <p className={styles.notice}>{en.viewer.tooManyPages}</p>}
      {/* Alternativa em texto para leitores de tela (documento 03, §12) */}
      <section className="sr-only" aria-live="polite" aria-label={en.viewer.textView}>
        <p>{indicator}</p>
        <pre>{stripFormatting(page)}</pre>
      </section>
    </div>
  )
}
