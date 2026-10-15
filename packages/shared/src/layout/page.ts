// Posição de cada glifo de uma página, do jeito que a tela de leitura do jogo desenha (documento 04, §6).
import { BOOK } from '../constants.ts'
import { iterateFormatted } from '../format/decompose.ts'
import type { TextStyle } from '../format/style.ts'
import { glyphAdvance } from '../font/metrics.ts'
import { readerLines, type TextLine } from './lines.ts'

export interface PlacedGlyph {
  /** Posição no texto bruto (útil para caret, seleção e busca) */
  index: number
  codePoint: number
  /** x relativo ao início da linha, em pixels de GUI */
  x: number
  advance: number
  style: TextStyle
}

export interface PageLine extends TextLine {
  /** y relativo ao topo da área de texto */
  y: number
  width: number
  glyphs: PlacedGlyph[]
}

export interface PageLayout {
  lines: PageLine[]
  /** O jogo só mostra as primeiras 14 linhas */
  visibleLines: number
}

/**
 * Cada linha é desenhada a partir do estilo em que começou, e o §r volta para esse estilo
 * (não para o preto). É o que o jogo faz numa linha que continua depois de uma quebra.
 */
export function layoutPage(text: string): PageLayout {
  const lines = readerLines(text).map((line, lineIndex): PageLine => {
    const glyphs: PlacedGlyph[] = []
    let x = 0
    iterateFormatted(
      text.slice(line.start, line.end),
      0,
      line.style,
      line.style,
      (index, style, codePoint) => {
        const advance = glyphAdvance(codePoint, style.bold)
        glyphs.push({ index: line.start + index, codePoint, x, advance, style })
        x += advance
        return true
      },
    )
    return { ...line, y: lineIndex * BOOK.lineHeight, width: x, glyphs }
  })
  return { lines, visibleLines: Math.min(lines.length, BOOK.maxLines) }
}
