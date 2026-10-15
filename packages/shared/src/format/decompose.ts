// Percorre um texto com códigos §, entregando cada caractere visível com o seu estilo.
// Reproduz StringDecomposer.iterateFormatted do jogo (documento 04, §2).
import { applyFormatCode, EMPTY_STYLE, toFormatCode, type TextStyle } from './style.ts'

export const SECTION_SIGN = '§'
export const REPLACEMENT_CHARACTER = 0xfffd

/** Recebe a posição no texto, o estilo e o code point. Devolver false interrompe. */
export type FormattedCharSink = (index: number, style: TextStyle, codePoint: number) => boolean

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff

/**
 * Devolve true se chegou ao fim do texto e false se o `sink` interrompeu.
 *
 * - "§" + código válido muda o estilo; "§r" volta para `resetStyle`.
 * - "§" + qualquer outro caractere esconde os dois (inclusive espaço e "\n").
 * - "§" no fim do texto é descartado.
 * - Surrogates soltos viram U+FFFD.
 */
export function iterateFormatted(
  text: string,
  start: number,
  style: TextStyle,
  resetStyle: TextStyle,
  sink: FormattedCharSink,
): boolean {
  const size = text.length
  let current = style
  for (let i = start; i < size; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 0xa7) {
      if (i + 1 >= size) break
      const code = toFormatCode(text[i + 1])
      if (code !== null) current = code === 'r' ? resetStyle : applyFormatCode(current, code)
      i++
    } else if (isHighSurrogate(ch)) {
      if (i + 1 >= size) {
        if (!sink(i, current, REPLACEMENT_CHARACTER)) return false
        break
      }
      const low = text.charCodeAt(i + 1)
      if (isLowSurrogate(low)) {
        if (!sink(i, current, (ch - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000)) return false
        i++
      } else if (!sink(i, current, REPLACEMENT_CHARACTER)) return false
    } else if (!sink(i, current, isLowSurrogate(ch) ? REPLACEMENT_CHARACTER : ch)) {
      return false
    }
  }
  return true
}

/** Texto visível, sem os códigos (para busca, leitores de tela e o filtro de conteúdo). */
export function stripFormatting(text: string): string {
  let out = ''
  iterateFormatted(text, 0, EMPTY_STYLE, EMPTY_STYLE, (_index, _style, codePoint) => {
    out += String.fromCodePoint(codePoint)
    return true
  })
  return out
}
