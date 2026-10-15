// Gera a amostra da fonte pixel do projeto (docs/img/fonte-quillframe.png, documento 05):
// a folha com todos os glifos e páginas dos livros de exemplo desenhadas com ela.
//
// Os caracteres que o jogo tira da Unifont (emojis, ✮, ☼...) usam a Unifont do pacote de referência
// local, se existir (pnpm reference-pack); senão viram caixas. O layout é o mesmo nos dois casos.
//
// Uso: pnpm font:specimen
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  BOOK,
  COLORS,
  GLYPH_KIND,
  glyphAdvance,
  glyphKind,
  layoutPage,
  parsePixelFont,
  parseStendhal,
} from '../packages/shared/src/index.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs/img/fonte-quillframe.png')
const font = parsePixelFont(fs.readFileSync(path.join(ROOT, 'assets/pack/font/quillframe-font.txt'), 'utf8'))

/** Pixels da imagem por pixel de GUI (par, por causa da meia escala da Unifont) */
const S = 4
const H = S / 2

// ── Unifont do pacote de referência (opcional) ──
const unifont = new Map()
const referenceDir = path.join(ROOT, '.reference-pack')
if (fs.existsSync(path.join(referenceDir, 'font.json'))) {
  const reference = JSON.parse(fs.readFileSync(path.join(referenceDir, 'font.json'), 'utf8'))
  const provider = reference.providers.find((p) => p.type === 'unihex')
  if (provider) {
    for (const line of fs.readFileSync(path.join(referenceDir, provider.file), 'utf8').split('\n')) {
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const cp = parseInt(line.slice(0, colon), 16)
      const bounds = provider.bounds[cp]
      if (bounds) unifont.set(cp, { hex: line.slice(colon + 1).trim(), bounds })
    }
  }
}

// ── Imagem RGBA ──
function createImage(width, height, color) {
  const data = Buffer.alloc(width * height * 4)
  const image = { width, height, data }
  fillRect(image, 0, 0, width, height, color)
  return image
}

function hexColor(hex) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function fillRect(image, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(image.height, Math.floor(y + h)); yy++) {
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(image.width, Math.floor(x + w)); xx++) {
      const i = (yy * image.width + xx) * 4
      image.data[i] = r
      image.data[i + 1] = g
      image.data[i + 2] = b
      image.data[i + 3] = 255
    }
  }
}

function encodePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(typed))
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Desenho de glifos (x, y em pixels de GUI; y = topo da linha) ──
function drawGlyph(image, codePoint, x, y, color, style = {}) {
  const shear = (row) => (style.italic ? 1 - row * 0.25 : 0)
  const offsets = style.bold ? [0, glyphKind(codePoint) === GLYPH_KIND.unifont ? 0.5 : 1] : [0]
  for (const offset of offsets) {
    const glyph = font.glyphs.get(codePoint)
    if (glyph) {
      glyph.rows.forEach((row, r) =>
        row.forEach((on, c) => {
          if (on)
            fillRect(image, (x + offset + c + shear(glyph.top + r)) * S, (y + glyph.top + r) * S, S, S, color)
        }),
      )
      continue
    }
    const kind = glyphKind(codePoint)
    const uni = kind === GLYPH_KIND.unifont ? unifont.get(codePoint) : null
    if (uni) {
      const bitWidth = uni.hex.length / 4
      const digits = bitWidth / 4
      const [left, right] = uni.bounds
      for (let row = 0; row < 16; row++) {
        const value = parseInt(uni.hex.slice(row * digits, (row + 1) * digits), 16)
        for (let column = left; column <= right; column++) {
          if ((value >> (bitWidth - 1 - column)) & 1)
            fillRect(
              image,
              (x + offset + shear(row / 2)) * S + (column - left) * H,
              y * S + row * H,
              H,
              H,
              color,
            )
        }
      }
    } else if (kind !== GLYPH_KIND.space) {
      // Sem desenho: caixa do tamanho da tinta
      const width = Math.max(1, glyphAdvance(codePoint) - 1)
      fillRect(image, (x + offset) * S, (y + 1) * S, width * S, S, color)
      fillRect(image, (x + offset) * S, (y + 6) * S, width * S, S, color)
      fillRect(image, (x + offset) * S, (y + 1) * S, S, 6 * S, color)
      fillRect(image, (x + offset + width - 1) * S, (y + 1) * S, S, 6 * S, color)
    }
  }
}

function drawText(image, text, x, y, color) {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    drawGlyph(image, cp, x, y, color)
    x += glyphAdvance(cp)
  }
  return x
}

const PAPER = hexColor('#efe2bf')
const COVER = hexColor('#5b3d22')
const INK = hexColor('#000000')

function drawPage(image, pageText, pageNumber, pageCount, left, top) {
  fillRect(image, (left + 18) * S, (top + 1) * S, 152 * S, 181 * S, COVER)
  fillRect(image, (left + 20) * S, (top + 3) * S, 148 * S, 177 * S, PAPER)
  const indicator = `Page ${pageNumber} of ${pageCount}`
  const width = [...indicator].reduce((sum, ch) => sum + glyphAdvance(ch.codePointAt(0) ?? 0), 0)
  drawText(image, indicator, left + BOOK.pageIndicatorRightX - width, top + BOOK.pageIndicatorY, INK)

  const layout = layoutPage(pageText)
  for (const line of layout.lines.slice(0, layout.visibleLines)) {
    for (const glyph of line.glyphs) {
      const color = glyph.style.color ? hexColor(COLORS[glyph.style.color].hex) : INK
      const x = left + BOOK.textX + glyph.x
      const y = top + BOOK.textY + line.y
      drawGlyph(image, glyph.codePoint, x, y, color, glyph.style)
      if (glyph.style.strikethrough)
        fillRect(image, (x - 1) * S, (y + 3.5) * S, (glyph.advance + 1) * S, S, color)
      if (glyph.style.underlined) fillRect(image, (x - 1) * S, (y + 8) * S, (glyph.advance + 1) * S, S, color)
    }
  }
}

// ── Composição da amostra ──
const BG = hexColor('#2b2118')
const WHITE = hexColor('#ffffff')
const GOLD = hexColor('#ffaa00')
const GRAY = hexColor('#aaaaaa')

const all = [...font.glyphs.keys()].sort((a, b) => a - b)
// Glifos separados por um espaço, em linhas de até 590 px
const sheetLines = []
let current = ''
let currentWidth = 0
for (const cp of all) {
  const advance = glyphAdvance(cp) + 4
  if (currentWidth + advance > 590) {
    sheetLines.push(current)
    current = ''
    currentWidth = 0
  }
  current += String.fromCodePoint(cp) + ' '
  currentWidth += advance
}
if (current) sheetLines.push(current)

const samples = [
  ['good_luck', 0],
  ['o_sol_e_a_lua', 0],
  ['palhaco', 0],
  ['good_luck', 21],
  ['candles', 0],
  ['magnolia_pt-br', 0],
]
const booksDir = path.join(ROOT, 'packages/shared/test/fixtures/books')

const PAGE = 192
const columns = 3
const width = 16 + columns * (PAGE + 8) + 8
const sheetTop = 30
const pagesTop = sheetTop + sheetLines.length * 10 + 24
const height = pagesTop + Math.ceil(samples.length / columns) * (PAGE + 14) + 6
const image = createImage(width * S, height * S, BG)

drawText(image, 'quillframe — fonte pixel do projeto', 16, 8, GOLD)
drawText(image, `${font.glyphs.size} glifos com as larguras do jogo`, 16, 18, GRAY)
sheetLines.forEach((line, index) => drawText(image, line, 16, sheetTop + index * 10, WHITE))

drawText(image, 'Páginas dos livros de exemplo', 16, pagesTop - 12, GOLD)
samples.forEach(([name, pageIndex], index) => {
  const book = parseStendhal(fs.readFileSync(path.join(booksDir, `${name}.stendhal`), 'utf8'))
  const left = 12 + (index % columns) * (PAGE + 8)
  const top = pagesTop + Math.floor(index / columns) * (PAGE + 14)
  drawPage(image, book.pages[pageIndex] ?? '', pageIndex + 1, book.pages.length, left, top)
  drawText(image, `${name} · pág. ${pageIndex + 1}`, left + 22, top + PAGE - 8, GRAY)
})

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, encodePng(image))
console.log(
  `Amostra criada em ${path.relative(process.cwd(), OUT)} (${width * S}×${height * S})` +
    (unifont.size ? '' : ' — sem pacote de referência: emojis e símbolos da Unifont aparecem como caixas'),
)
