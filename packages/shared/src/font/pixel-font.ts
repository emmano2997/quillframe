// Leitor da fonte pixel do projeto (assets/pack/font/quillframe-font.txt, documento 05).
// A arte é própria; só as larguras seguem o jogo, para a arte ASCII dos livros não desalinhar.

export interface PixelGlyph {
  /** Linhas do desenho, de cima para baixo; true = pixel aceso */
  readonly rows: readonly (readonly boolean[])[]
  /** Linha da primeira linha do desenho, a partir do topo da linha de texto (0 = topo, 7 = descida) */
  readonly top: number
  /** Coluna mais à direita com pixel + 1 (a "tinta" que o jogo mede) */
  readonly inkWidth: number
}

export interface PixelFont {
  /** Glifos por code point */
  readonly glyphs: ReadonlyMap<number, PixelGlyph>
  /** Peças com nome (acentos e bases), usadas nas composições */
  readonly parts: ReadonlyMap<string, PixelGlyph>
}

export class PixelFontError extends Error {
  constructor(line: number, message: string) {
    super(`linha ${line}: ${message}`)
    this.name = 'PixelFontError'
  }
}

/** Linhas de um glifo normal: 0 a 6 acima da base, 7 abaixo dela */
export const GLYPH_CELL_ROWS = 8

function inkWidthOf(rows: readonly (readonly boolean[])[]): number {
  let width = 0
  for (const row of rows) {
    const last = row.lastIndexOf(true)
    if (last + 1 > width) width = last + 1
  }
  return width
}

function firstInkRow(glyph: PixelGlyph): number {
  const index = glyph.rows.findIndex((row) => row.includes(true))
  return index < 0 ? GLYPH_CELL_ROWS : glyph.top + index
}

function makeGlyph(rows: boolean[][], top: number): PixelGlyph {
  return { rows, top, inkWidth: inkWidthOf(rows) }
}

/** `A`, `U+00C1` ou `@nome` → code point ou nome da peça */
function parseKey(token: string, line: number): number | string {
  if (token.startsWith('@') && token.length > 1) return token
  if (/^U\+[0-9A-F]{4,6}$/i.test(token)) return parseInt(token.slice(2), 16)
  const chars = [...token]
  if (chars.length !== 1) throw new PixelFontError(line, `esperava um caractere, U+XXXX ou @nome: "${token}"`)
  return chars[0]?.codePointAt(0) ?? 0
}

/**
 * Põe um acento em cima da base, centralizado. O espaço entre os dois é 1 linha quando cabe acima da
 * base sem subir além do topo da linha; senão, o acento encosta na base (maiúsculas, acentos altos).
 */
export function composeGlyph(base: PixelGlyph, mark: PixelGlyph): PixelGlyph {
  const baseWidth = Math.max(base.inkWidth, base.rows[0]?.length ?? 0)
  const markWidth = mark.inkWidth
  const width = Math.max(baseWidth, markWidth)
  const baseX = Math.floor((width - baseWidth) / 2)
  const markX = Math.floor((width - markWidth) / 2)

  const baseTop = firstInkRow(base)
  const gap = Math.min(1, Math.max(0, baseTop - mark.rows.length))
  const markTop = baseTop - gap - mark.rows.length
  const top = Math.min(base.top, markTop)
  const bottom = base.top + base.rows.length

  const rows = Array.from({ length: bottom - top }, () => Array<boolean>(width).fill(false))
  const paint = (glyph: PixelGlyph, glyphTop: number, x: number) => {
    glyph.rows.forEach((row, r) =>
      row.forEach((on, c) => {
        const target = rows[glyphTop - top + r]
        if (on && target) target[x + c] = true
      }),
    )
  }
  paint(base, base.top, baseX)
  paint(mark, markTop, markX)
  return makeGlyph(rows, top)
}

/**
 * Formato (uma instrução por bloco):
 *
 *     // comentário
 *     == A            glifo: caractere, U+XXXX ou @nome (peça para composições)
 *     .###.           desenho: '#' pixel, '.' vazio, todas as linhas com a mesma largura
 *     ...
 *     á = a + @acute  composição: base com um acento por cima
 *
 * Glifos têm pelo menos 8 linhas: a última fica abaixo da base (descida). Linhas a mais sobem acima
 * do topo da linha de texto, como os acentos das maiúsculas. Peças (@nome) podem ter qualquer altura.
 */
export function parsePixelFont(text: string): PixelFont {
  const glyphs = new Map<number, PixelGlyph>()
  const parts = new Map<string, PixelGlyph>()
  const compositions: { key: number; base: number | string; mark: string; line: number }[] = []

  let current: { key: number | string; line: number; rows: boolean[][] } | null = null
  const finish = () => {
    if (!current) return
    const { key, line, rows } = current
    current = null
    if (rows.length === 0) throw new PixelFontError(line, 'glifo sem desenho')
    if (typeof key === 'string') {
      if (parts.has(key)) throw new PixelFontError(line, `peça repetida: ${key}`)
      parts.set(key, makeGlyph(rows, 0))
      return
    }
    if (rows.length < GLYPH_CELL_ROWS)
      throw new PixelFontError(
        line,
        `o glifo precisa de ${GLYPH_CELL_ROWS} linhas ou mais (tem ${rows.length})`,
      )
    if (glyphs.has(key)) throw new PixelFontError(line, `glifo repetido: ${String.fromCodePoint(key)}`)
    glyphs.set(key, makeGlyph(rows, GLYPH_CELL_ROWS - rows.length))
  }

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const content = raw.trim()
    if (content.startsWith('//')) return
    if (content === '') return finish()

    if (content.startsWith('== ')) {
      finish()
      current = { key: parseKey(content.slice(3).trim(), line), line, rows: [] }
      return
    }

    const composition = /^(\S+)\s+=\s+(\S+)\s+\+\s+(@\S+)$/.exec(content)
    if (composition && !current) {
      const [, target = '', base = '', mark = ''] = composition
      const key = parseKey(target, line)
      if (typeof key === 'string') throw new PixelFontError(line, 'composições geram caracteres, não peças')
      compositions.push({ key, base: parseKey(base, line), mark, line })
      return
    }

    if (!current) throw new PixelFontError(line, `linha fora de um glifo: "${content}"`)
    if (!/^[#.]+$/.test(content))
      throw new PixelFontError(line, `desenho só pode ter '#' e '.': "${content}"`)
    const first = current.rows[0]
    if (first && first.length !== content.length)
      throw new PixelFontError(
        line,
        `largura diferente das outras linhas (${content.length} ≠ ${first.length})`,
      )
    current.rows.push([...content].map((ch) => ch === '#'))
  })
  finish()

  for (const { key, base, mark, line } of compositions) {
    const baseGlyph = typeof base === 'string' ? parts.get(base) : glyphs.get(base)
    const markGlyph = parts.get(mark)
    if (!baseGlyph) throw new PixelFontError(line, `base não encontrada: ${String(base)}`)
    if (!markGlyph) throw new PixelFontError(line, `acento não encontrado: ${mark}`)
    if (glyphs.has(key)) throw new PixelFontError(line, `glifo repetido: ${String.fromCodePoint(key)}`)
    glyphs.set(key, composeGlyph(baseGlyph, markGlyph))
  }

  return { glyphs, parts }
}
