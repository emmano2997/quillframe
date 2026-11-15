// Gera a fonte TrueType da interface (documento 03, F5; documento 05) a partir da fonte pixel do
// projeto: cada pixel vira um quadrado e o avanço de cada caractere é a largura do jogo. O WOFF2 é o
// mesmo TTF com as tabelas comprimidas em Brotli; quem chama passa o compressor (no Node, zlib).
import { GLYPH_CELL_ROWS, type PixelFont, type PixelGlyph } from './pixel-font.ts'

/** Unidades por pixel. A fonte tem 8 pixels por em: em `font-size: 8px`, 1 pixel da fonte = 1 px */
export const TTF_PIXEL_UNITS = 128
export const TTF_UNITS_PER_EM = 8 * TTF_PIXEL_UNITS
/** A base fica entre as linhas 6 e 7 da grade: 7 pixels acima, 1 abaixo */
const BASELINE_ROW = GLYPH_CELL_ROWS - 1
/** Data fixa (1/1/2026) para o arquivo gerado ser sempre igual */
const TIMESTAMP = BigInt(Date.UTC(2026, 0, 1) / 1000) + 2082844800n

export interface TtfOptions {
  /** Avanço em pixels de cada caractere (a largura do jogo) */
  advance: (codePoint: number) => number
  familyName: string
  version: string
}

/** Nome e versão da fonte da interface (pnpm font:web) */
export const WEB_FONT_OPTIONS = { familyName: 'quillframe', version: '1.0' } as const

interface OutlineGlyph {
  codePoint: number | null
  advance: number
  /** Retângulos [x0, y0, x1, y1] em unidades, y para cima */
  rects: [number, number, number, number][]
}

class Writer {
  private bytes: number[] = []
  u8(v: number) {
    this.bytes.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v)
  }
  i16(v: number) {
    return this.u16(v < 0 ? v + 0x10000 : v)
  }
  u32(v: number) {
    return this.u16(Math.floor(v / 0x10000) & 0xffff).u16(v & 0xffff)
  }
  i64(v: bigint) {
    return this.u32(Number((v >> 32n) & 0xffffffffn)).u32(Number(v & 0xffffffffn))
  }
  tag(t: string) {
    for (const c of t) this.u8(c.charCodeAt(0))
    return this
  }
  raw(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i] ?? 0)
    return this
  }
  pad(multiple: number) {
    while (this.bytes.length % multiple !== 0) this.bytes.push(0)
    return this
  }
  get length() {
    return this.bytes.length
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

/** Pixels acesos em retângulos: trechos de cada linha, unidos com os trechos iguais logo abaixo */
function rectsOf(glyph: PixelGlyph): [number, number, number, number][] {
  const P = TTF_PIXEL_UNITS
  const open = new Map<string, [number, number, number, number]>()
  const rects: [number, number, number, number][] = []
  glyph.rows.forEach((row, r) => {
    const top = (BASELINE_ROW - (glyph.top + r)) * P
    const seen = new Set<string>()
    for (let x = 0; x < row.length;) {
      if (!row[x]) {
        x++
        continue
      }
      let end = x
      while (row[end]) end++
      const key = `${x}:${end}`
      const rect = open.get(key)
      if (rect) rect[1] = top - P
      else {
        const created: [number, number, number, number] = [x * P, top - P, end * P, top]
        open.set(key, created)
        rects.push(created)
      }
      seen.add(key)
      x = end
    }
    for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key)
  })
  return rects
}

function checksum(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    sum =
      (sum +
        (((data[i] ?? 0) << 24) |
          ((data[i + 1] ?? 0) << 16) |
          ((data[i + 2] ?? 0) << 8) |
          (data[i + 3] ?? 0))) >>>
      0
  }
  return sum
}

function glyfEntry(glyph: OutlineGlyph): Uint8Array {
  if (glyph.rects.length === 0) return new Uint8Array(0)
  const w = new Writer()
  const xs = glyph.rects.flatMap(([x0, , x1]) => [x0, x1])
  const ys = glyph.rects.flatMap(([, y0, , y1]) => [y0, y1])
  w.i16(glyph.rects.length)
    .i16(Math.min(...xs))
    .i16(Math.min(...ys))
    .i16(Math.max(...xs))
    .i16(Math.max(...ys))
  glyph.rects.forEach((_, i) => w.u16(i * 4 + 3))
  w.u16(0) // sem instruções
  // Sentido horário (y para cima): baixo-esquerda, cima-esquerda, cima-direita, baixo-direita
  const points = glyph.rects.flatMap(([x0, y0, x1, y1]) => [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
  ])
  for (let i = 0; i < points.length; i++) w.u8(0x01) // no contorno, coordenadas em int16
  // Coordenadas relativas ao ponto anterior
  points.forEach(([x = 0], i) => w.i16(x - (points[i - 1]?.[0] ?? 0)))
  points.forEach(([, y = 0], i) => w.i16(y - (points[i - 1]?.[1] ?? 0)))
  return w.pad(4).done()
}

function nameTable(names: Record<number, string>): Uint8Array {
  const entries = Object.entries(names).map(([id, text]) => {
    const bytes: number[] = []
    for (const c of text) {
      const code = c.charCodeAt(0)
      bytes.push(code >> 8, code & 0xff)
    }
    return { id: Number(id), bytes }
  })
  const w = new Writer()
    .u16(0)
    .u16(entries.length)
    .u16(6 + entries.length * 12)
  let offset = 0
  for (const { id, bytes } of entries) {
    w.u16(3).u16(1).u16(0x0409).u16(id).u16(bytes.length).u16(offset)
    offset += bytes.length
  }
  for (const { bytes } of entries) w.raw(bytes)
  return w.done()
}

function cmapTable(glyphs: OutlineGlyph[]): Uint8Array {
  // Formato 4: um segmento por trecho de code points seguidos (os ids também são seguidos)
  const segments: { start: number; end: number; delta: number }[] = []
  glyphs.forEach((glyph, id) => {
    const cp = glyph.codePoint
    if (cp === null) return
    if (cp > 0xfffe) throw new Error(`U+${cp.toString(16)}: o cmap formato 4 só cobre o BMP`)
    const last = segments.at(-1)
    if (last && last.end + 1 === cp && (cp + last.delta) % 0x10000 === id) last.end = cp
    else segments.push({ start: cp, end: cp, delta: (id - cp + 0x10000) % 0x10000 })
  })
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 })
  const count = segments.length
  const entrySelector = Math.floor(Math.log2(count))
  const searchRange = 2 * 2 ** entrySelector
  const sub = new Writer()
    .u16(4)
    .u16(16 + count * 8)
    .u16(0)
    .u16(count * 2)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(count * 2 - searchRange)
  segments.forEach((s) => sub.u16(s.end))
  sub.u16(0)
  segments.forEach((s) => sub.u16(s.start))
  segments.forEach((s) => sub.u16(s.delta))
  segments.forEach(() => sub.u16(0))
  const data = sub.done()
  // Unicode BMP (0, 3) e Windows Unicode BMP (3, 1) apontam para a mesma subtabela
  return new Writer().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20).raw(data).done()
}

/** Tabelas da fonte, por tag, na ordem do arquivo */
export function buildPixelFontTables(font: PixelFont, options: TtfOptions): Map<string, Uint8Array> {
  const P = TTF_PIXEL_UNITS
  const notdef: OutlineGlyph = {
    codePoint: null,
    advance: 6 * P,
    // Caixa 5×8 do caractere sem glifo, como no jogo
    rects: [
      [0, -P, 5 * P, 0],
      [0, 6 * P, 5 * P, 7 * P],
      [0, 0, P, 6 * P],
      [4 * P, 0, 5 * P, 6 * P],
    ],
  }
  const space: OutlineGlyph = { codePoint: 0x20, advance: options.advance(0x20) * P, rects: [] }
  const glyphs: OutlineGlyph[] = [
    notdef,
    ...[...new Set([...font.glyphs.keys(), 0x20])]
      .sort((a, b) => a - b)
      .map((cp) => {
        const glyph = font.glyphs.get(cp)
        return glyph ? { codePoint: cp, advance: options.advance(cp) * P, rects: rectsOf(glyph) } : space
      }),
  ]

  const glyf = new Writer()
  const loca = new Writer()
  for (const glyph of glyphs) {
    loca.u32(glyf.length)
    glyf.raw(glyfEntry(glyph))
  }
  loca.u32(glyf.length)

  const all = glyphs.flatMap((g) => g.rects)
  const xMin = Math.min(...all.map((r) => r[0]))
  const yMin = Math.min(...all.map((r) => r[1]))
  const xMax = Math.max(...all.map((r) => r[2]))
  const yMax = Math.max(...all.map((r) => r[3]))
  const advances = glyphs.map((g) => g.advance)
  const lsb = glyphs.map((g) => (g.rects.length ? Math.min(...g.rects.map((r) => r[0])) : 0))
  const rsb = glyphs.map((g) => (g.rects.length ? g.advance - Math.max(...g.rects.map((r) => r[2])) : 0))
  // Linha de 9 pixels, como a do jogo: 8 acima da base (7 + 1 de espaço), 1 abaixo
  const ascender = 8 * P
  const descender = -P
  const codePoints = glyphs.flatMap((g) => (g.codePoint === null ? [] : [g.codePoint]))

  const head = new Writer()
    .u32(0x00010000)
    .u32(Math.round(Number(options.version) * 0x10000)) // fontRevision, Fixed 16.16
    .u32(0) // checkSumAdjustment, preenchido no fim
    .u32(0x5f0f3cf5)
    .u16(0b1011) // base em y=0, lsb em x=0, ppem inteiro
    .u16(TTF_UNITS_PER_EM)
    .i64(TIMESTAMP)
    .i64(TIMESTAMP)
    .i16(xMin)
    .i16(yMin)
    .i16(xMax)
    .i16(yMax)
    .u16(0)
    .u16(8) // menor tamanho legível: 8 px por em
    .i16(2)
    .i16(1) // loca com offsets de 32 bits
    .i16(0)

  const hhea = new Writer()
    .u32(0x00010000)
    .i16(ascender)
    .i16(descender)
    .i16(0)
    .u16(Math.max(...advances))
    .i16(Math.min(...lsb))
    .i16(Math.min(...rsb))
    .i16(xMax)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(glyphs.length)

  const maxPoints = Math.max(...glyphs.map((g) => g.rects.length * 4))
  const maxContours = Math.max(...glyphs.map((g) => g.rects.length))
  const maxp = new Writer().u32(0x00010000).u16(glyphs.length).u16(maxPoints).u16(maxContours)
  maxp.u16(0).u16(0).u16(2) // composite points, composite contours, zones
  for (let i = 0; i < 8; i++) maxp.u16(0)

  const os2 = new Writer()
    .u16(4)
    .i16(Math.round(advances.reduce((a, b) => a + b, 0) / advances.length))
    .u16(400)
    .u16(5)
    .u16(0) // fsType: pode embutir
    .i16(5 * P) // subscrito: tamanho x, y, deslocamento x, y
    .i16(5 * P)
    .i16(0)
    .i16(P)
    .i16(5 * P) // sobrescrito
    .i16(5 * P)
    .i16(0)
    .i16(4 * P)
    .i16(P) // riscado: espessura e posição
    .i16(3 * P)
    .i16(0)
    .raw(new Uint8Array(10)) // PANOSE
    .u32(0b11) // Basic Latin e Latin-1
    .u32(0)
    .u32(0)
    .u32(0)
    .tag('QFRM')
    .u16(0x40 | 0x80) // REGULAR, USE_TYPO_METRICS
    .u16(Math.min(...codePoints))
    .u16(Math.max(...codePoints))
    .i16(ascender)
    .i16(descender)
    .i16(0)
    .u16(Math.max(yMax, ascender))
    .u16(Math.max(-yMin, -descender))
    .u32(1) // Latin 1
    .u32(0)
    .i16(5 * P) // altura x
    .i16(7 * P) // altura das maiúsculas
    .u16(0)
    .u16(0x20)
    .u16(1)

  const hmtx = new Writer()
  glyphs.forEach((g, i) => hmtx.u16(g.advance).i16(lsb[i] ?? 0))

  const post = new Writer().u32(0x00030000).u32(0).i16(-P).i16(P).u32(0).u32(0).u32(0).u32(0).u32(0)

  const name = nameTable({
    1: options.familyName,
    2: 'Regular',
    3: `${options.familyName} Regular ${options.version}`,
    4: options.familyName,
    5: `Version ${options.version}`,
    6: options.familyName.replace(/[^A-Za-z0-9-]/g, ''),
  })

  return new Map(
    [
      ['OS/2', os2.done()],
      ['cmap', cmapTable(glyphs)],
      ['glyf', glyf.done()],
      ['head', head.done()],
      ['hhea', hhea.done()],
      ['hmtx', hmtx.done()],
      ['loca', loca.done()],
      ['maxp', maxp.done()],
      ['name', name],
      ['post', post.done()],
    ].sort(([a = ''], [b = '']) => (a < b ? -1 : 1)) as [string, Uint8Array][],
  )
}

/** Junta as tabelas num arquivo .ttf, com os checksums */
export function buildTtf(tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const count = tables.size
  const entrySelector = Math.floor(Math.log2(count))
  const searchRange = 16 * 2 ** entrySelector
  const w = new Writer()
    .u32(0x00010000)
    .u16(count)
    .u16(searchRange)
    .u16(entrySelector)
    .u16(count * 16 - searchRange)
  let offset = 12 + count * 16
  for (const [tag, data] of tables) {
    w.tag(tag).u32(checksum(data)).u32(offset).u32(data.length)
    offset += Math.ceil(data.length / 4) * 4
  }
  for (const data of tables.values()) w.raw(data).pad(4)
  const font = w.done()
  // head.checkSumAdjustment = 0xB1B0AFBA − soma do arquivo inteiro
  const headOffset = 12 + [...tables.keys()].indexOf('head') * 16
  const view = new DataView(font.buffer)
  const headStart = view.getUint32(headOffset + 8)
  view.setUint32(headStart + 8, (0xb1b0afba - checksum(font)) >>> 0)
  return font
}

/** Tabelas que o WOFF2 conhece por número (especificação WOFF2, §5.1) */
const WOFF2_KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
]

function base128(value: number): number[] {
  const out = [value & 0x7f]
  for (let v = Math.floor(value / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80)
  return out
}

/**
 * WOFF2 sem transformações: as tabelas do TTF, concatenadas e comprimidas. glyf e loca usam a
 * "transformação nula" (versão 3), permitida pela especificação.
 */
export function buildWoff2(
  tables: ReadonlyMap<string, Uint8Array>,
  compress: (data: Uint8Array) => Uint8Array,
): Uint8Array {
  const directory = new Writer()
  const stream = new Writer()
  for (const [tag, data] of tables) {
    const known = WOFF2_KNOWN_TAGS.indexOf(tag)
    const transform = tag === 'glyf' || tag === 'loca' ? 3 : 0
    directory.u8(((known < 0 ? 63 : known) | (transform << 6)) & 0xff)
    if (known < 0) directory.tag(tag)
    directory.raw(base128(data.length))
    stream.raw(data)
  }
  const compressed = compress(stream.done())
  const sfntSize = buildTtf(tables).length
  const headerSize = 48
  const total = headerSize + directory.length + compressed.length
  const padded = Math.ceil(total / 4) * 4
  return new Writer()
    .tag('wOF2')
    .u32(0x00010000)
    .u32(padded)
    .u16(tables.size)
    .u16(0)
    .u32(sfntSize)
    .u32(compressed.length)
    .u16(1)
    .u16(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .raw(directory.done())
    .raw(compressed)
    .pad(4)
    .done()
}
