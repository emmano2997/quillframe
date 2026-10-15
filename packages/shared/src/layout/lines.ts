// Quebra de linha igual à do jogo (StringSplitter.splitLines + LineBreakFinder, documento 04, §5).
import { BOOK, LIMITS } from '../constants.ts'
import { iterateFormatted } from '../format/decompose.ts'
import { EMPTY_STYLE, PAGE_STYLE, type TextStyle } from '../format/style.ts'
import { glyphAdvance } from '../font/metrics.ts'

const NEWLINE = 10
const SPACE = 32

export interface TextLine {
  /** Posição do primeiro caractere da linha no texto bruto */
  start: number
  /** Fim da linha (exclusivo), sem o espaço ou o "\n" consumido na quebra */
  end: number
  /** Estilo ativo no início da linha */
  style: TextStyle
  /** Como a linha terminou: "\n", espaço, caractere que não coube ou fim do texto */
  breakKind: 'newline' | 'space' | 'char' | 'end'
}

export interface SplitOptions {
  maxWidth?: number
  /** Estilo no início do texto */
  style?: TextStyle
  /** Estilo que o §r restaura durante a medição */
  resetStyle?: TextStyle
}

class LineBreakFinder {
  readonly maxWidth: number
  lineBreak = -1
  lineBreakStyle: TextStyle = EMPTY_STYLE
  private hadNonZeroWidthChar = false
  private width = 0
  private lastSpace = -1
  private lastSpaceStyle: TextStyle = EMPTY_STYLE

  constructor(maxWidth: number) {
    this.maxWidth = Math.max(maxWidth, 1)
  }

  readonly accept = (position: number, style: TextStyle, codePoint: number): boolean => {
    if (codePoint === NEWLINE) return this.finish(position, style)
    if (codePoint === SPACE) {
      this.lastSpace = position
      this.lastSpaceStyle = style
    }
    const charWidth = glyphAdvance(codePoint, style.bold)
    this.width += charWidth
    // Só quebra depois de algum caractere com largura, e quando passa (não quando iguala) o limite
    if (this.hadNonZeroWidthChar && this.width > this.maxWidth) {
      return this.lastSpace !== -1
        ? this.finish(this.lastSpace, this.lastSpaceStyle)
        : this.finish(position, style)
    }
    this.hadNonZeroWidthChar ||= charWidth !== 0
    return true
  }

  private finish(position: number, style: TextStyle): boolean {
    this.lineBreak = position
    this.lineBreakStyle = style
    return false
  }
}

/**
 * Divide o texto em linhas como StringSplitter.splitLines(String, ...) do jogo.
 * Não acrescenta a linha vazia que aparece depois de um "\n" final: veja readerLines e editorLines.
 */
export function splitLines(text: string, options: SplitOptions = {}): TextLine[] {
  const maxWidth = options.maxWidth ?? BOOK.textWidth
  const resetStyle = options.resetStyle ?? EMPTY_STYLE
  const lines: TextLine[] = []
  let start = 0
  let style = options.style ?? EMPTY_STYLE
  while (start < text.length) {
    const finder = new LineBreakFinder(maxWidth)
    if (iterateFormatted(text, start, style, resetStyle, finder.accept)) {
      lines.push({ start, end: text.length, style, breakKind: 'end' })
      break
    }
    const lineBreak = finder.lineBreak
    const tail = text.charCodeAt(lineBreak)
    const consumed = tail === NEWLINE || tail === SPACE
    lines.push({
      start,
      end: lineBreak,
      style,
      breakKind: tail === NEWLINE ? 'newline' : tail === SPACE ? 'space' : 'char',
    })
    start = consumed ? lineBreak + 1 : lineBreak
    style = finder.lineBreakStyle
  }
  return lines
}

function trailingEmptyLine(text: string, last: TextLine): TextLine {
  return { start: text.length, end: text.length, style: last.style, breakKind: 'end' }
}

/**
 * Linhas como a tela de leitura mostra (BookViewScreen → Font.split): começa no estilo da página
 * e, se a última quebra foi um "\n", termina com uma linha vazia.
 */
export function readerLines(text: string): TextLine[] {
  const lines = splitLines(text, { style: PAGE_STYLE })
  const last = lines.at(-1)
  if (last?.breakKind === 'newline') lines.push(trailingEmptyLine(text, last))
  return lines
}

/**
 * Linhas como o editor do jogo 26.x conta (MultilineTextField): começa sem estilo e, se o texto
 * termina com "\n" (mesmo um "\n" escondido por um "§" antes dele), soma uma linha vazia.
 */
export function editorLines(text: string): TextLine[] {
  const lines = splitLines(text, { style: EMPTY_STYLE })
  const last = lines.at(-1)
  if (text.endsWith('\n')) {
    lines.push(
      last ? trailingEmptyLine(text, last) : { start: 0, end: 0, style: EMPTY_STYLE, breakKind: 'end' },
    )
  }
  return lines
}

/**
 * A página cabe no livro? Até 1024 caracteres e até 14 linhas, sem contar a linha vazia que vem
 * depois de um "\n" final. É a regra do editor do jogo até a 1.21.5 (9 × linhas ≤ 128), com que os
 * livros do autor foram escritos; o editor do 26.x conta essa linha a mais, mas mostra a página igual.
 */
export function fitsInGamePage(text: string): boolean {
  return text.length <= LIMITS.pageChars && splitLines(text).length <= BOOK.maxLines
}
