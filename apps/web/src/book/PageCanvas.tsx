// A página do livro num canvas, com as medidas exatas do jogo. É usada pelo leitor e pelo editor
// (que desenha o caret e a seleção por cima).
import {
  BOOK,
  GLYPH_KIND,
  glyphKind,
  layoutPage,
  stripFormatting,
  unifontPart,
  type PageLayout,
} from '@quillframe/shared'
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { en, format } from '../strings/en.ts'
import { usePreferences } from '../stores/app.ts'
import styles from './BookView.module.css'
import { createPackGlyphs, INTERNAL_SCALE, loadUnifont, type GlyphSource } from './glyphs.ts'
import { hasObfuscatedText, renderPage } from './render.ts'

const S = INTERNAL_SCALE

/** Os textos usam caracteres do arquivo grande da Unifont (CJK, hangul...)? */
function needsUnifontExtra(pages: readonly string[]): boolean {
  for (const page of pages) {
    for (const ch of page) {
      const cp = ch.codePointAt(0) ?? 0
      if (cp > 0x2e7f && glyphKind(cp) === GLYPH_KIND.unifont && unifontPart(cp) === 'extra') return true
    }
  }
  return false
}

/** A fonte do projeto, com o recorte da Unifont carregado sob demanda para os textos dados. */
export function useBookGlyphs(pages: readonly string[]): GlyphSource {
  const [glyphs, setGlyphs] = useState(() => createPackGlyphs())
  const extra = useMemo(() => needsUnifontExtra(pages), [pages])
  useEffect(() => {
    let current = true
    loadUnifont(extra ? ['common', 'extra'] : ['common']).then(
      () => current && setGlyphs(createPackGlyphs()),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [extra])
  return glyphs
}

/**
 * Tamanho em CSS para que cada pixel do canvas vire um número inteiro de pixels físicos, inclusive
 * em telas com zoom (devicePixelRatio 1,25, 1,5...).
 */
function cssPixels(guiPixels: number, guiScale: number): number {
  const dpr = window.devicePixelRatio || 1
  const deviceScale = Math.max(S, Math.floor((guiScale * dpr) / S) * S)
  return (guiPixels * deviceScale) / dpr
}

export interface Overlay {
  /** Caret na posição do texto bruto, ou null para não desenhar */
  caret: { line: number; x: number } | null
  selection: { x: number; y: number; width: number }[]
  /** Trechos realçados pela busca do leitor */
  highlights?: { x: number; y: number; width: number }[]
}

interface PageCanvasProps {
  text: string
  pageNumber: number
  pageCount: number
  glyphs: GlyphSource
  /** Pixels de tela por pixel de GUI */
  scale: number
  /** Só a área de texto, sem a moldura do livro (leitor no celular, documento 03, §13) */
  compact?: boolean
  overlay?: Overlay | undefined
  label?: string
  /** Ponto da área de texto em pixels de GUI */
  onPoint?: (
    x: number,
    y: number,
    phase: 'down' | 'move' | 'up',
    event: PointerEvent<HTMLCanvasElement>,
  ) => void
  children?: ReactNode
}

const MARGIN = 4

export function PageCanvas({
  text,
  pageNumber,
  pageCount,
  glyphs,
  scale,
  compact = false,
  overlay,
  label,
  onPoint,
  children,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layout: PageLayout = useMemo(() => layoutPage(text), [text])
  const reduceMotion = usePreferences((state) => state.reduceMotion)
  const dragging = useRef(false)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    let blink = true
    const draw = () => {
      renderPage(ctx, layout, { glyphs, background: null, pageNumber, pageCount })
      if (!overlay) return
      const originX = BOOK.textX * S
      const originY = BOOK.textY * S
      ctx.fillStyle = 'rgba(40, 90, 200, 0.35)'
      for (const rect of overlay.selection) {
        ctx.fillRect(originX + rect.x * S, originY + rect.y * S, rect.width * S, BOOK.lineHeight * S)
      }
      ctx.fillStyle = 'rgba(255, 200, 0, 0.45)'
      for (const rect of overlay.highlights ?? []) {
        ctx.fillRect(originX + rect.x * S, originY + rect.y * S, rect.width * S, BOOK.lineHeight * S)
      }
      if (overlay.caret && blink && overlay.caret.line < BOOK.maxLines) {
        ctx.fillStyle = '#000'
        ctx.fillRect(
          originX + overlay.caret.x * S,
          originY + overlay.caret.line * BOOK.lineHeight * S - S,
          S,
          BOOK.lineHeight * S,
        )
      }
    }
    draw()
    const prefersReduced = reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // §k troca os caracteres a cada quadro; com movimento reduzido, fica parado
    const animateText = hasObfuscatedText(layout) && !prefersReduced
    const timers: number[] = []
    if (animateText) timers.push(window.setInterval(draw, 50))
    if (overlay?.caret) {
      timers.push(
        window.setInterval(() => {
          blink = !blink
          if (!animateText) draw()
        }, 530),
      )
    }
    return () => timers.forEach((timer) => window.clearInterval(timer))
  }, [layout, glyphs, pageNumber, pageCount, overlay, reduceMotion])

  const point = (event: PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') => {
    if (!onPoint) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * BOOK.imageWidth - BOOK.textX
    const y = ((event.clientY - rect.top) / rect.height) * BOOK.imageHeight - BOOK.textY
    onPoint(x, y, phase, event)
  }

  const full = cssPixels(BOOK.imageWidth, scale)
  const unit = full / BOOK.imageWidth
  const indicator = format(en.reader.pageIndicator, { page: pageNumber, total: pageCount })
  const canvas = (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      width={BOOK.imageWidth * S}
      height={BOOK.imageHeight * S}
      style={{
        width: full,
        height: full,
        ...(compact
          ? { marginLeft: -(BOOK.textX - MARGIN) * unit, marginTop: -(BOOK.textY - MARGIN) * unit }
          : {}),
        ...(onPoint ? { cursor: 'text', touchAction: 'none' } : {}),
      }}
      role="img"
      aria-label={label ?? indicator}
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        point(event, 'down')
      }}
      onPointerMove={(event) => dragging.current && point(event, 'move')}
      onPointerUp={(event) => {
        dragging.current = false
        point(event, 'up')
      }}
    />
  )

  return (
    <div className={styles.view}>
      {compact ? (
        <div
          className={styles.compact}
          style={{
            width: (BOOK.textWidth + 2 * MARGIN) * unit,
            height: (BOOK.textHeight + 2 * MARGIN) * unit,
          }}
        >
          {canvas}
        </div>
      ) : (
        canvas
      )}
      {children}
    </div>
  )
}

/** Alternativa em texto de uma página, para leitores de tela (documento 03, §12). */
export function PageText({
  text,
  pageNumber,
  pageCount,
}: {
  text: string
  pageNumber: number
  pageCount: number
}) {
  return (
    <section className="sr-only" aria-live="polite" aria-label={en.reader.textView}>
      <p>{format(en.reader.pageIndicator, { page: pageNumber, total: pageCount })}</p>
      <pre>{stripFormatting(text)}</pre>
    </section>
  )
}
