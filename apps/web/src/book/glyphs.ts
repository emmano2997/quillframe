// De onde vêm os desenhos dos glifos. Enquanto a fonte própria não existe (documento 01, D5), há duas
// fontes: o pacote de referência local, com a fonte do jogo (só em desenvolvimento), e "caixas" do
// tamanho de cada glifo, que mostram o layout sem arte nenhuma.
import { GLYPH_KIND, glyphAdvance, glyphKind } from '@quillframe/shared'

/** Pixels do canvas por pixel de GUI: 2, para a meia escala da Unifont e o negrito de 0,5 px */
export const INTERNAL_SCALE = 2
const S = INTERNAL_SCALE

export interface GlyphMask {
  /** Máscara branca do glifo */
  image: HTMLCanvasElement
  /** Deslocamento a partir do topo da linha, em pixels do canvas */
  top: number
}

export interface GlyphSource {
  readonly kind: 'reference' | 'boxes'
  mask(codePoint: number): GlyphMask | null
  /** Outro glifo com o mesmo avanço, para o §k (ofuscado) */
  randomSameWidth(codePoint: number, random: () => number): number
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  return canvas
}

/** Caixa 5×8 do caractere sem glifo (SpecialGlyphs.MISSING) */
function missingGlyph(): GlyphMask {
  const image = createCanvas(5 * S, 8 * S)
  const ctx = image.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 5 * S, 8 * S)
    ctx.clearRect(S, S, 3 * S, 6 * S)
  }
  return { image, top: 0 }
}

/** Sem arte: um bloco do tamanho da tinta de cada glifo */
export function createBoxGlyphs(): GlyphSource {
  const cache = new Map<number, GlyphMask | null>()
  const missing = missingGlyph()
  return {
    kind: 'boxes',
    mask(codePoint) {
      const kind = glyphKind(codePoint)
      if (kind === GLYPH_KIND.space) return null
      if (kind === GLYPH_KIND.missing) return missing
      const advance = glyphAdvance(codePoint)
      if (!cache.has(codePoint)) {
        const image = createCanvas((advance - 1) * S, 7 * S)
        const ctx = image.getContext('2d')
        if (ctx) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
          ctx.fillRect(0, S, Math.max(S, (advance - 1) * S), 6 * S)
        }
        cache.set(codePoint, advance > 1 ? { image, top: 0 } : null)
      }
      return cache.get(codePoint) ?? null
    },
    randomSameWidth: (codePoint) => codePoint,
  }
}

interface ReferenceBitmap {
  type: 'bitmap'
  file: string
  cellWidth: number
  cellHeight: number
  ascent: number
  scale: number
  glyphs: Record<string, [number, number]>
}
interface ReferenceUnihex {
  type: 'unihex'
  file: string
  bounds: Record<string, [number, number]>
}
interface ReferenceFont {
  gameVersion: string
  providers: ({ type: 'space' } | ReferenceBitmap | ReferenceUnihex)[]
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

/** Carrega o pacote de referência (pnpm reference-pack). Devolve null se ele não existir. */
export async function loadReferenceGlyphs(base = '/reference-pack'): Promise<GlyphSource | null> {
  const response = await fetch(`${base}/font.json`).catch(() => null)
  if (!response?.ok) return null
  const font = (await response.json()) as ReferenceFont

  const bitmaps: { def: ReferenceBitmap; sheet: HTMLImageElement }[] = []
  let unihex: { bounds: Record<string, [number, number]>; rows: Map<number, string> } | null = null
  for (const provider of font.providers) {
    if (provider.type === 'bitmap') {
      bitmaps.push({ def: provider, sheet: await loadImage(`${base}/${provider.file}`) })
    } else if (provider.type === 'unihex') {
      const text = await (await fetch(`${base}/${provider.file}`)).text()
      const rows = new Map<number, string>()
      for (const line of text.split('\n')) {
        const colon = line.indexOf(':')
        if (colon > 0) rows.set(parseInt(line.slice(0, colon), 16), line.slice(colon + 1).trim())
      }
      unihex = { bounds: provider.bounds, rows }
    }
  }

  // Glifos bitmap agrupados por avanço, para o §k
  const byAdvance = new Map<number, number[]>()
  for (const { def } of bitmaps) {
    for (const key of Object.keys(def.glyphs)) {
      const cp = Number(key)
      if (glyphKind(cp) !== GLYPH_KIND.bitmap) continue
      const advance = glyphAdvance(cp)
      byAdvance.set(advance, [...(byAdvance.get(advance) ?? []), cp])
    }
  }

  const cache = new Map<number, GlyphMask | null>()
  const missing = missingGlyph()

  const bitmapMask = (codePoint: number): GlyphMask | null => {
    for (const { def, sheet } of bitmaps) {
      const cell = def.glyphs[codePoint]
      if (!cell) continue
      const width = Math.round(def.cellWidth * def.scale * S)
      const height = Math.round(def.cellHeight * def.scale * S)
      const image = createCanvas(width, height)
      const ctx = image.getContext('2d')
      if (!ctx) return null
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        sheet,
        cell[0] * def.cellWidth,
        cell[1] * def.cellHeight,
        def.cellWidth,
        def.cellHeight,
        0,
        0,
        width,
        height,
      )
      // GlyphBitmap.getTop() = 7 − ascent
      return { image, top: (7 - def.ascent) * S }
    }
    return null
  }

  const unihexMask = (codePoint: number): GlyphMask | null => {
    const hex = unihex?.rows.get(codePoint)
    const bounds = unihex?.bounds[codePoint]
    if (!hex || !bounds) return null
    const [left, right] = bounds
    const bitWidth = hex.length / 4
    const digits = bitWidth / 4
    // Meia escala: 1 pixel da Unifont = 0,5 pixel de GUI = 1 pixel do canvas
    const image = createCanvas(right - left + 1, 16)
    const ctx = image.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    for (let row = 0; row < 16; row++) {
      const value = parseInt(hex.slice(row * digits, (row + 1) * digits), 16)
      for (let column = left; column <= right && column < bitWidth; column++) {
        if ((value >> (bitWidth - 1 - column)) & 1) ctx.fillRect(column - left, row, 1, 1)
      }
    }
    return { image, top: 0 }
  }

  return {
    kind: 'reference',
    mask(codePoint) {
      if (cache.has(codePoint)) return cache.get(codePoint) ?? null
      const kind = glyphKind(codePoint)
      const mask =
        kind === GLYPH_KIND.space
          ? null
          : kind === GLYPH_KIND.bitmap
            ? bitmapMask(codePoint)
            : kind === GLYPH_KIND.unifont
              ? unihexMask(codePoint)
              : missing
      cache.set(codePoint, mask)
      return mask
    },
    randomSameWidth(codePoint, random) {
      const options = byAdvance.get(glyphAdvance(codePoint))
      if (!options || options.length === 0) return codePoint
      return options[Math.floor(random() * options.length)] ?? codePoint
    },
  }
}
