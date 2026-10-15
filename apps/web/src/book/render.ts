// Desenha uma página no canvas como a tela de leitura do jogo (documento 04, §6).
import {
  BOOK,
  COLORS,
  GLYPH_KIND,
  glyphKind,
  layoutPage,
  type ColorCode,
  type PageLayout,
  type PlacedGlyph,
} from '@quillframe/shared'
import { INTERNAL_SCALE, type GlyphMask, type GlyphSource } from './glyphs.ts'

const S = INTERNAL_SCALE

/**
 * Cor de um texto "sem cor" (depois de um §r numa linha que continuou). O jogo 1.21 desenhava em
 * preto; o 26.x parece desenhar em branco com sombra [a validar no jogo] (documento 04, §6).
 */
const NO_COLOR = '#000000'

export function colorOf(code: ColorCode | null): string {
  return code === null ? NO_COLOR : COLORS[code].hex
}

export interface RenderOptions {
  glyphs: GlyphSource
  /** Textura do livro (192×192 a partir do canto); null desenha um papel simples */
  background: CanvasImageSource | null
  pageNumber: number
  pageCount: number
  random?: () => number
}

const tintCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>()

function tinted(mask: GlyphMask, color: string): HTMLCanvasElement {
  let byColor = tintCache.get(mask.image)
  if (!byColor) {
    byColor = new Map()
    tintCache.set(mask.image, byColor)
  }
  let image = byColor.get(color)
  if (!image) {
    image = document.createElement('canvas')
    image.width = mask.image.width
    image.height = mask.image.height
    const ctx = image.getContext('2d')
    if (ctx) {
      ctx.drawImage(mask.image, 0, 0)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, image.width, image.height)
    }
    byColor.set(color, image)
  }
  return image
}

function drawBackground(ctx: CanvasRenderingContext2D, background: CanvasImageSource | null) {
  if (background) {
    ctx.drawImage(
      background,
      0,
      0,
      BOOK.imageWidth,
      BOOK.imageHeight,
      0,
      0,
      BOOK.imageWidth * S,
      BOOK.imageHeight * S,
    )
    return
  }
  // Papel provisório, até a arte própria do livro (documento 01, D6)
  ctx.fillStyle = '#5b3d22'
  ctx.fillRect(18 * S, 1 * S, 152 * S, 181 * S)
  ctx.fillStyle = '#efe2bf'
  ctx.fillRect(20 * S, 3 * S, 148 * S, 177 * S)
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: PlacedGlyph,
  originX: number,
  originY: number,
  options: RenderOptions,
) {
  const { style } = glyph
  const kind = glyphKind(glyph.codePoint)
  const random = options.random ?? Math.random
  const codePoint =
    style.obfuscated && kind !== GLYPH_KIND.space
      ? options.glyphs.randomSameWidth(glyph.codePoint, random)
      : glyph.codePoint
  const color = colorOf(style.color)
  const x = (originX + glyph.x) * S
  const lineTop = originY * S

  const mask = options.glyphs.mask(codePoint)
  if (mask) {
    const image = tinted(mask, color)
    const top = lineTop + mask.top
    // Negrito: o mesmo glifo de novo, 1 px depois (0,5 px na Unifont)
    const offsets = style.bold ? [0, kind === GLYPH_KIND.unifont ? S / 2 : S] : [0]
    for (const offset of offsets) {
      if (style.italic) {
        // Itálico: inclina 0,25 px por pixel de altura, com o topo 1 px à direita
        ctx.setTransform(1, 0, -0.25, 1, x + offset + S - 0.25 * mask.top, top)
        ctx.drawImage(image, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      } else {
        ctx.drawImage(image, x + offset, top)
      }
    }
  }

  // Riscado e sublinhado: de 1 px antes do glifo até o fim do avanço
  ctx.fillStyle = color
  if (style.strikethrough) ctx.fillRect(x - S, lineTop + 3.5 * S, (glyph.advance + 1) * S, S)
  if (style.underlined) ctx.fillRect(x - S, lineTop + 8 * S, (glyph.advance + 1) * S, S)
}

/** Texto simples (indicador de página), alinhado à direita em `rightX` */
function drawRightAligned(
  ctx: CanvasRenderingContext2D,
  text: string,
  rightX: number,
  y: number,
  options: RenderOptions,
) {
  const [line] = layoutPage(text).lines
  if (!line) return
  for (const glyph of line.glyphs) drawGlyph(ctx, glyph, rightX - Math.ceil(line.width), y, options)
}

export function renderPage(ctx: CanvasRenderingContext2D, layout: PageLayout, options: RenderOptions) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, BOOK.imageWidth * S, BOOK.imageHeight * S)
  drawBackground(ctx, options.background)
  drawRightAligned(
    ctx,
    `Page ${options.pageNumber} of ${options.pageCount}`,
    BOOK.pageIndicatorRightX,
    BOOK.pageIndicatorY,
    options,
  )
  for (const line of layout.lines.slice(0, layout.visibleLines)) {
    for (const glyph of line.glyphs) drawGlyph(ctx, glyph, BOOK.textX, BOOK.textY + line.y, options)
  }
}

export function hasObfuscatedText(layout: PageLayout): boolean {
  return layout.lines.some((line) => line.glyphs.some((glyph) => glyph.style.obfuscated))
}
