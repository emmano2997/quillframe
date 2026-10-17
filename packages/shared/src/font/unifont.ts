// Glifos da GNU Unifont, que o jogo usa para emojis e símbolos fora da fonte bitmap (documento 05).
// A Unifont tem licença livre (SIL OFL 1.1); o recorte com os glifos que o jogo usa fica em
// assets/pack/font/unifont-glyphs.bin, gerado por scripts/unifont-subset.mjs.

export interface UnifontGlyph {
  /** Primeira coluna do desenho (o jogo corta o que fica à esquerda) */
  readonly left: number
  /** Última coluna do desenho */
  readonly right: number
  /** 16 linhas; bit 31 = coluna 0, como o jogo guarda */
  readonly rows: Uint32Array
}

/** Altura de um glifo da Unifont, em pixels da Unifont (meio pixel de GUI) */
export const UNIFONT_ROWS = 16

/**
 * Larguras fixas que o jogo impõe a blocos inteiros (`size_overrides` do provedor da Unifont), para
 * os caracteres largos não ficarem apertados. Valem só para caracteres que existem na Unifont.
 */
export const UNIFONT_SIZE_OVERRIDES: readonly { from: number; to: number; left: number; right: number }[] = [
  { from: 0x3001, to: 0x30ff, left: 0, right: 15 }, // Pontuação CJK, hiragana, katakana
  { from: 0x3200, to: 0x9fff, left: 0, right: 15 }, // Ideogramas CJK e afins
  { from: 0x1100, to: 0x11ff, left: 0, right: 15 }, // Hangul Jamo
  { from: 0x3130, to: 0x318f, left: 0, right: 15 }, // Hangul Compatibility Jamo
  { from: 0xa960, to: 0xa97f, left: 0, right: 15 }, // Hangul Jamo Extended-A
  { from: 0xd7b0, to: 0xd7ff, left: 0, right: 15 }, // Hangul Jamo Extended-B
  { from: 0xac00, to: 0xd7af, left: 1, right: 15 }, // Hangul Syllables
  { from: 0xf900, to: 0xfaff, left: 0, right: 15 }, // CJK Compatibility Ideographs
  { from: 0xff01, to: 0xff5e, left: 0, right: 15 }, // Halfwidth and Fullwidth Forms
]

/**
 * O recorte vem em dois arquivos: `common` (símbolos, emojis e escritas do BMP, ~150 kB), que o
 * leitor sempre carrega, e `extra` (CJK, hangul, plano 2 em diante, ~1 MB), só para livros que usam.
 */
export type UnifontPart = 'common' | 'extra'

export function unifontPart(codePoint: number): UnifontPart {
  if (codePoint >= 0x10000) return codePoint >= 0x1f000 && codePoint <= 0x1ffff ? 'common' : 'extra'
  const cjk =
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  return cjk ? 'extra' : 'common'
}

/** Avanço em pixels de GUI de um glifo da Unifont, como o jogo calcula */
export function unifontAdvance(glyph: Pick<UnifontGlyph, 'left' | 'right'>): number {
  return Math.trunc((glyph.right - glyph.left + 1) / 2) + 1
}

/**
 * Lê os bits de uma linha do .hex ("CODEPOINT:BITS", 8 a 32 pixels de largura) e mede o glifo como o
 * jogo: left = primeira coluna com pixel, right = última (glifo vazio: 0 e a largura).
 */
export function parseUnihex(codePoint: number, hex: string): UnifontGlyph | null {
  const bitWidth = hex.length / 4
  if (![8, 16, 24, 32].includes(bitWidth)) return null
  const digits = bitWidth / 4
  const rows = new Uint32Array(UNIFONT_ROWS)
  let mask = 0
  for (let r = 0; r < UNIFONT_ROWS; r++) {
    const value = parseInt(hex.slice(r * digits, (r + 1) * digits), 16)
    const aligned = (value * 2 ** (32 - bitWidth)) >>> 0
    rows[r] = aligned
    mask = (mask | aligned) >>> 0
  }
  const override = UNIFONT_SIZE_OVERRIDES.find((o) => codePoint >= o.from && codePoint <= o.to)
  if (override) return { left: override.left, right: override.right, rows }
  const left = mask === 0 ? 0 : Math.clz32(mask)
  const right = mask === 0 ? bitWidth : Math.clz32((mask & -mask) >>> 0)
  return { left, right, rows }
}

// Formato do recorte (antes da compressão gzip), tudo em little-endian:
//   "QFU1"  u32 número de trechos
//   trechos: u32 primeiro code point, u16 quantidade (code points seguidos)
//   glifos, na ordem: u8 left, u8 right, e as 16 linhas só com as colunas left..right,
//   cada linha com ceil(largura / 8) bytes (bit mais alto = coluna mais à esquerda).
const MAGIC = 'QFU1'

function columnsOf(glyph: Pick<UnifontGlyph, 'left' | 'right'>): number {
  return Math.max(0, glyph.right - glyph.left + 1)
}

export function encodeUnifontSubset(glyphs: ReadonlyMap<number, UnifontGlyph>): Uint8Array {
  const codePoints = [...glyphs.keys()].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const cp of codePoints) {
    const last = runs.at(-1)
    if (last && last[0] + last[1] === cp && last[1] < 0xffff) last[1]++
    else runs.push([cp, 1])
  }
  const out: number[] = [...MAGIC].map((c) => c.charCodeAt(0))
  const u32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
  u32(runs.length)
  for (const [start, count] of runs) {
    u32(start)
    out.push(count & 0xff, count >>> 8)
  }
  for (const cp of codePoints) {
    const glyph = glyphs.get(cp)
    if (!glyph) continue
    out.push(glyph.left, glyph.right)
    const width = columnsOf(glyph)
    const bytes = Math.ceil(width / 8)
    for (const row of glyph.rows) {
      // Colunas left..right, alinhadas à esquerda; o que passa da coluna 31 é vazio
      const shifted = glyph.left >= 32 ? 0 : (row << glyph.left) >>> 0
      for (let b = 0; b < bytes; b++) out.push(b < 4 ? (shifted >>> (24 - b * 8)) & 0xff : 0)
    }
  }
  return Uint8Array.from(out)
}

export function decodeUnifontSubset(data: Uint8Array): Map<number, UnifontGlyph> {
  if (String.fromCharCode(...data.subarray(0, 4)) !== MAGIC) throw new Error('Arquivo da Unifont inválido')
  let pos = 4
  const u32 = () => {
    const v =
      ((data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8) | ((data[pos + 2] ?? 0) << 16)) +
      (data[pos + 3] ?? 0) * 0x1000000
    pos += 4
    return v
  }
  const runCount = u32()
  const runs: [number, number][] = []
  for (let i = 0; i < runCount; i++) {
    const start = u32()
    runs.push([start, (data[pos] ?? 0) | ((data[pos + 1] ?? 0) << 8)])
    pos += 2
  }
  const glyphs = new Map<number, UnifontGlyph>()
  for (const [start, count] of runs) {
    for (let cp = start; cp < start + count; cp++) {
      const left = data[pos++] ?? 0
      const right = data[pos++] ?? 0
      const bytes = Math.ceil(columnsOf({ left, right }) / 8)
      const rows = new Uint32Array(UNIFONT_ROWS)
      for (let r = 0; r < UNIFONT_ROWS; r++) {
        let value = 0
        for (let b = 0; b < bytes; b++) {
          if (b < 4) value += (data[pos + b] ?? 0) * 2 ** (24 - b * 8)
        }
        pos += bytes
        rows[r] = left >= 32 ? 0 : (value >>> left) >>> 0
      }
      glyphs.set(cp, { left, right, rows })
    }
  }
  if (pos !== data.length) throw new Error('Arquivo da Unifont corrompido')
  return glyphs
}
