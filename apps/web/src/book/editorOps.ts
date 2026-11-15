// Operações do editor sobre o texto bruto da página (com os códigos §). São funções puras: o que o
// editor faz com a seleção está todo aqui (documento 03, §5.4 e §5.6).
import {
  applyFormatCode,
  BOOK,
  fitsInGamePage,
  isColorCode,
  layoutPage,
  LIMITS,
  PAGE_STYLE,
  sanitizePageContent,
  toFormatCode,
  type ColorCode,
  type FormatCode,
  type PageLayout,
  type StyleCode,
  type TextStyle,
} from '@quillframe/shared'

export interface Edit {
  text: string
  selectionStart: number
  selectionEnd: number
}

const SECTION = '§'
const STYLE_FLAGS: [StyleCode, keyof TextStyle][] = [
  ['k', 'obfuscated'],
  ['l', 'bold'],
  ['m', 'strikethrough'],
  ['n', 'underlined'],
  ['o', 'italic'],
]

/** Estilo ativo logo antes da posição `index` (o que vale para o próximo caractere digitado). */
export function styleAt(text: string, index: number): TextStyle {
  let style = PAGE_STYLE
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] !== SECTION) continue
    // Um "§" cujo par passa da posição ainda não fez efeito
    if (i + 1 >= index) break
    const code = toFormatCode(text[i + 1])
    if (code !== null) style = code === 'r' ? PAGE_STYLE : applyFormatCode(style, code)
    i++
  }
  return style
}

function styleCodes(style: TextStyle): string {
  return STYLE_FLAGS.filter(([, flag]) => style[flag])
    .map(([code]) => SECTION + code)
    .join('')
}

/** Códigos que levam do estilo padrão da página até `style`: a cor vem antes dos estilos. */
export function codesFor(style: TextStyle): string {
  const color = style.color !== null && style.color !== PAGE_STYLE.color ? SECTION + style.color : ''
  return color + styleCodes(style)
}

/** Onde começa a sequência de códigos de estilo colada antes de `index` ("§l§o|" → início do "§l"). */
function styleRunStart(text: string, index: number): number {
  let start = index
  while (start >= 2 && text[start - 2] === SECTION) {
    const code = toFormatCode(text[start - 1])
    if (code === null || code === 'r' || isColorCode(code)) break
    // O "§" precisa ser o início de um par, não o fim de outro ("§§l")
    let sections = 0
    for (let i = start - 2; i >= 0 && text[i] === SECTION; i--) sections++
    if (sections % 2 === 0) break
    start -= 2
  }
  return start
}

/**
 * Aplica uma cor, um estilo ou o reset (documento 03, §5.4).
 * - Sem seleção: o código entra no caret e vale para o que vier depois, como no jogo.
 * - Com seleção: o código entra no início e, no fim, o estado anterior é restaurado com §r + cor +
 *   estilos (não existe código para "desligar o negrito").
 * - A cor vem antes dos estilos, porque no Java uma cor apaga os estilos ativos.
 */
export function applyFormat(text: string, start: number, end: number, code: FormatCode): Edit {
  const prefix = (at: number): { insert: string; from: number } => {
    if (code === 'r') return { insert: `${SECTION}r`, from: at }
    if (!isColorCode(code)) return { insert: SECTION + code, from: at }
    // Cor: os estilos que estavam ativos são reaplicados depois dela (§c§l, nunca §l§c)
    const from = styleRunStart(text, at)
    return { insert: SECTION + code + styleCodes(styleAt(text, at)), from }
  }

  if (start === end) {
    const { insert, from } = prefix(start)
    const next = text.slice(0, from) + insert + text.slice(start)
    const caret = from + insert.length
    return { text: next, selectionStart: caret, selectionEnd: caret }
  }

  const before = styleAt(text, end)
  const { insert, from } = prefix(start)
  let middle = text.slice(start, end)
  // Um estilo aplicado sobre um trecho com cores precisa voltar depois de cada cor ou reset
  if (code !== 'r' && !isColorCode(code)) {
    let out = ''
    for (let i = 0; i < middle.length; i++) {
      out += middle[i]
      if (middle[i] === SECTION && i + 1 < middle.length) {
        const inner = toFormatCode(middle[i + 1])
        out += middle[i + 1]
        if (inner !== null && (inner === 'r' || isColorCode(inner))) out += SECTION + code
        i++
      }
    }
    middle = out
  }
  const restore = `${SECTION}r${codesFor(before)}`
  const head = text.slice(0, from) + insert
  const next = head + middle + restore + text.slice(end)
  return { text: next, selectionStart: head.length, selectionEnd: head.length + middle.length }
}

/** Remove os códigos válidos do trecho (ou da página inteira); os inválidos ficam (documento 03, F12). */
export function clearFormatting(text: string, start: number, end: number): Edit {
  const whole = start === end
  const from = whole ? 0 : start
  const to = whole ? text.length : end
  let out = ''
  for (let i = from; i < to; i++) {
    if (text[i] === SECTION && i + 1 < to && toFormatCode(text[i + 1]) !== null) {
      i++
      continue
    }
    // "§" seguido de outra coisa esconde os dois caracteres: pula o par inteiro, sem mexer nele
    if (text[i] === SECTION && i + 1 < to) {
      out += text.slice(i, i + 2)
      i++
      continue
    }
    out += text[i]
  }
  const next = text.slice(0, from) + out + text.slice(to)
  return whole
    ? { text: next, selectionStart: Math.min(start, next.length), selectionEnd: Math.min(start, next.length) }
    : { text: next, selectionStart: from, selectionEnd: from + out.length }
}

/** Códigos § que não são de formatação ("§ ", "§§"): contados no modo Raw. */
export function countInvalidCodes(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== SECTION) continue
    if (i + 1 >= text.length || toFormatCode(text[i + 1]) === null) count++
    i++
  }
  return count
}

export interface FitResult {
  text: string
  /** Posição do caret depois do texto inserido */
  caret: number
  /** O texto precisou ser cortado para caber */
  truncated: boolean
  /** A alteração foi recusada por inteiro */
  rejected: boolean
}

/**
 * Faz uma alteração caber na página: até 1024 caracteres e 14 linhas, como no jogo. Uma digitação
 * que não cabe é recusada; uma colagem entra até onde couber (documento 03, F13).
 */
export function fitChange(previous: string, proposed: string, caret: number): FitResult {
  const next = sanitizePageContent(proposed)
  const shift = proposed.length - next.length
  const nextCaret = Math.max(0, Math.min(next.length, caret - shift))
  // Apagar sempre pode, mesmo numa página que já passa do limite (livro importado)
  if (fitsInGamePage(next) || next.length <= previous.length) {
    return { text: next, caret: nextCaret, truncated: false, rejected: false }
  }

  // Trecho inserido = o que sobra entre o prefixo e o sufixo comuns
  let prefix = 0
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++
  }
  const inserted = next.slice(prefix, next.length - suffix)
  const head = next.slice(0, prefix)
  const tail = next.slice(next.length - suffix)

  // Busca binária do maior pedaço do trecho inserido que ainda cabe
  let low = 0
  let high = inserted.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (fitsInGamePage(head + inserted.slice(0, middle) + tail)) low = middle
    else high = middle - 1
  }
  // Não parte um par substituto (emoji) ao meio
  const cut = inserted.charCodeAt(low - 1)
  if (low > 0 && cut >= 0xd800 && cut <= 0xdbff) low--
  if (low === 0) return { text: previous, caret: Math.min(prefix, previous.length), truncated: true, rejected: true }
  return { text: head + inserted.slice(0, low) + tail, caret: prefix + low, truncated: true, rejected: false }
}

export interface CaretPosition {
  line: number
  /** x relativo ao início da área de texto, em pixels de GUI */
  x: number
}

function lineOf(layout: PageLayout, index: number): number {
  let line = 0
  for (let i = 0; i < layout.lines.length; i++) {
    if ((layout.lines[i]?.start ?? Infinity) <= index) line = i
  }
  return line
}

/** Posição do caret na tela para uma posição no texto bruto. */
export function caretPosition(layout: PageLayout, index: number): CaretPosition {
  const lineIndex = lineOf(layout, index)
  const line = layout.lines[lineIndex]
  if (!line) return { line: 0, x: 0 }
  const glyph = line.glyphs.find((item) => item.index >= index)
  return { line: lineIndex, x: glyph ? glyph.x : line.width }
}

/** Posição no texto bruto para um ponto da área de texto (clique no canvas). */
export function indexAtPoint(layout: PageLayout, x: number, y: number): number {
  if (layout.lines.length === 0) return 0
  const lineIndex = Math.max(0, Math.min(layout.lines.length - 1, Math.floor(y / BOOK.lineHeight)))
  const line = layout.lines[lineIndex]
  if (!line) return 0
  for (const glyph of line.glyphs) {
    if (x < glyph.x + glyph.advance / 2) return glyph.index
  }
  return line.end
}

/** Seta para cima ou para baixo: a posição na linha vizinha mais próxima do mesmo x. */
export function moveVertically(text: string, index: number, direction: -1 | 1): number {
  const layout = layoutPage(text)
  const { line, x } = caretPosition(layout, index)
  const target = line + direction
  if (target < 0) return 0
  if (target >= layout.lines.length) return text.length
  return indexAtPoint(layout, x, target * BOOK.lineHeight)
}

export function lineBounds(text: string, index: number): { start: number; end: number } {
  const layout = layoutPage(text)
  const line = layout.lines[lineOf(layout, index)]
  return line ? { start: line.start, end: line.end } : { start: 0, end: 0 }
}

/** Retângulos da seleção, um por linha, em pixels de GUI relativos à área de texto. */
export function selectionRects(
  layout: PageLayout,
  start: number,
  end: number,
): { x: number; y: number; width: number }[] {
  if (start === end) return []
  const rects: { x: number; y: number; width: number }[] = []
  layout.lines.slice(0, layout.visibleLines).forEach((line, lineIndex) => {
    if (end <= line.start || start > line.end) return
    const from = line.glyphs.find((glyph) => glyph.index >= start)
    const to = line.glyphs.find((glyph) => glyph.index >= end)
    const x = from ? from.x : line.width
    const right = to ? to.x : line.width
    // Uma linha vazia dentro da seleção ganha uma marca fina
    rects.push({ x, y: lineIndex * BOOK.lineHeight, width: Math.max(right - x, 2) })
  })
  return rects
}

export function pageStats(text: string): { chars: number; lines: number; overChars: boolean; overLines: boolean } {
  const lines = Math.max(1, layoutPage(text).lines.length)
  return {
    chars: text.length,
    lines,
    overChars: text.length > LIMITS.pageChars,
    overLines: !fitsInGamePage(text) && text.length <= LIMITS.pageChars,
  }
}

export type { ColorCode }
