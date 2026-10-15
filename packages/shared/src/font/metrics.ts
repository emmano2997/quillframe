// Avanço (largura) de cada caractere na fonte padrão do jogo (documento 04, §3).
import { GLYPH_METRICS_RLE } from './glyph-metrics.generated.ts'

export const GLYPH_KIND = { missing: 0, space: 1, bitmap: 2, unifont: 3 } as const
export type GlyphKind = (typeof GLYPH_KIND)[keyof typeof GLYPH_KIND]

const CODEPOINT_COUNT = 0x110000
/** Caractere sem glifo: o jogo desenha uma caixa 5×8 com avanço 6 */
const MISSING_VALUE = (GLYPH_KIND.missing << 5) | 6
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

let table: Uint8Array | null = null

function decodeBase64(text: string): Uint8Array {
  const lookup = new Uint8Array(128)
  for (let i = 0; i < BASE64.length; i++) lookup[BASE64.charCodeAt(i)] = i
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let pos = 0
  for (let i = 0; i < clean.length; i++) {
    value = (value << 6) | (lookup[clean.charCodeAt(i)] ?? 0)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[pos++] = (value >> bits) & 0xff
    }
  }
  return out
}

function metricsTable(): Uint8Array {
  if (table) return table
  const rle = decodeBase64(GLYPH_METRICS_RLE)
  const result = new Uint8Array(CODEPOINT_COUNT)
  let pos = 0
  let codePoint = 0
  while (pos < rle.length) {
    const value = rle[pos++] ?? 0
    let count = 0
    let shift = 0
    let byte: number
    do {
      byte = rle[pos++] ?? 0
      count += (byte & 0x7f) * 2 ** shift
      shift += 7
    } while (byte & 0x80)
    result.fill(value, codePoint, codePoint + count)
    codePoint += count
  }
  if (codePoint !== CODEPOINT_COUNT) throw new Error('Tabela de larguras corrompida')
  table = result
  return result
}

function valueOf(codePoint: number): number {
  return codePoint >= 0 && codePoint < CODEPOINT_COUNT
    ? (metricsTable()[codePoint] ?? MISSING_VALUE)
    : MISSING_VALUE
}

export function glyphKind(codePoint: number): GlyphKind {
  return (valueOf(codePoint) >> 5) as GlyphKind
}

/**
 * Avanço em pixels de GUI. O negrito soma 1 px, ou 0,5 px nos glifos da Unifont
 * (GlyphInfo.getBoldOffset), por isso o resultado pode ser fracionário.
 */
export function glyphAdvance(codePoint: number, bold = false): number {
  const value = valueOf(codePoint)
  const advance = value & 31
  if (!bold) return advance
  return advance + (value >> 5 === GLYPH_KIND.unifont ? 0.5 : 1)
}
