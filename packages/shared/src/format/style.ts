// Estilo do texto e aplicação dos códigos §, como no jogo (Style.applyLegacyFormat).
import { COLOR_CODES, type ColorCode } from './colors.ts'

export type StyleCode = 'k' | 'l' | 'm' | 'n' | 'o'
export type FormatCode = ColorCode | StyleCode | 'r'

export interface TextStyle {
  /** null = sem cor: quem desenha decide a cor padrão (documento 04, §4) */
  readonly color: ColorCode | null
  readonly bold: boolean
  readonly italic: boolean
  readonly underlined: boolean
  readonly strikethrough: boolean
  readonly obfuscated: boolean
}

const PLAIN = { bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false }

/** Style.EMPTY do jogo: sem cor e sem estilos. É o alvo do §r durante a medição. */
export const EMPTY_STYLE: TextStyle = Object.freeze({ color: null, ...PLAIN })

/** Estilo base das páginas na tela de leitura (BookViewScreen.PAGE_TEXT_STYLE): preto, sem sombra. */
export const PAGE_STYLE: TextStyle = Object.freeze({ color: '0', ...PLAIN })

const CODE_CHARS = new Set<string>([...COLOR_CODES, 'k', 'l', 'm', 'n', 'o', 'r'])

/**
 * Código de formatação de um caractere, ou null se não for código.
 * O jogo passa o caractere por Character.toLowerCase, então "§L" vale como "§l"
 * (e o sinal de Kelvin U+212A vale como "k").
 */
export function toFormatCode(ch: string | undefined): FormatCode | null {
  if (ch === undefined) return null
  const lower = ch.toLowerCase()
  return lower.length === 1 && CODE_CHARS.has(lower) ? (lower as FormatCode) : null
}

export function isColorCode(code: FormatCode): code is ColorCode {
  return code !== 'k' && code !== 'l' && code !== 'm' && code !== 'n' && code !== 'o' && code !== 'r'
}

/** Aplica um código que não é §r. Uma cor apaga todos os estilos ativos (documento 01, §6). */
export function applyFormatCode(style: TextStyle, code: Exclude<FormatCode, 'r'>): TextStyle {
  switch (code) {
    case 'k':
      return { ...style, obfuscated: true }
    case 'l':
      return { ...style, bold: true }
    case 'm':
      return { ...style, strikethrough: true }
    case 'n':
      return { ...style, underlined: true }
    case 'o':
      return { ...style, italic: true }
    default:
      return { color: code, ...PLAIN }
  }
}

export function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underlined === b.underlined &&
    a.strikethrough === b.strikethrough &&
    a.obfuscated === b.obfuscated
  )
}
