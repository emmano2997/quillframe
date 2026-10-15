import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GLYPH_KIND,
  glyphAdvance,
  glyphKind,
  parsePixelFont,
  PixelFontError,
  stripFormatting,
} from '../src/index.ts'

const root = path.resolve(import.meta.dirname, '../../..')
const fontText = fs.readFileSync(path.join(root, 'assets/pack/font/quillframe-font.txt'), 'utf8')
const font = parsePixelFont(fontText)
const booksDir = path.join(import.meta.dirname, 'fixtures/books')

const name = (cp: number) =>
  `${String.fromCodePoint(cp)} (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`
const draw = (cp: number) =>
  font.glyphs.get(cp)?.rows.map((row) => row.map((on) => (on ? '#' : '.')).join('')) ?? []

describe('fonte pixel do projeto (assets/pack/font)', () => {
  it('cada glifo tem a largura do jogo: tinta = avanço − 1 (documento 04, §3)', () => {
    const wrong = [...font.glyphs]
      .filter(([cp, glyph]) => glyph.inkWidth !== glyphAdvance(cp) - 1)
      .map(([cp, glyph]) => `${name(cp)}: tinta ${glyph.inkWidth}, esperado ${glyphAdvance(cp) - 1}`)
    expect(wrong).toEqual([])
  })

  it('só desenha caracteres que o jogo tira da fonte bitmap (o resto vem da Unifont)', () => {
    const wrong = [...font.glyphs.keys()].filter((cp) => glyphKind(cp) !== GLYPH_KIND.bitmap).map(name)
    expect(wrong).toEqual([])
  })

  it('cobre todo o ASCII visível e o Latim-1 (acentos do português)', () => {
    const missing: string[] = []
    for (let cp = 0x21; cp <= 0xff; cp++) {
      if (cp > 0x7e && cp < 0xa1) continue
      if (glyphKind(cp) === GLYPH_KIND.bitmap && !font.glyphs.has(cp)) missing.push(name(cp))
    }
    expect(missing).toEqual([])
  })

  it('cobre todos os caracteres bitmap usados nos livros do autor', () => {
    const missing = new Set<string>()
    for (const file of fs.readdirSync(booksDir)) {
      const text = stripFormatting(fs.readFileSync(path.join(booksDir, file), 'utf8'))
      for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0
        if (glyphKind(cp) === GLYPH_KIND.bitmap && !font.glyphs.has(cp)) missing.add(name(cp))
      }
    }
    expect([...missing]).toEqual([])
  })

  it('glifos normais ficam na grade de 8 linhas; acentos de maiúsculas sobem acima da linha', () => {
    expect(font.glyphs.get(0x41)?.top).toBe(0) // A
    expect(font.glyphs.get(0xc1)?.top).toBeLessThan(0) // Á
    expect(font.glyphs.get(0xe1)?.top).toBe(0) // á cabe na grade
  })

  it('monta acentos centralizados sobre a base', () => {
    expect(draw(0xe1)).toEqual(['..#..', '.#...', '.###.', '....#', '.####', '#...#', '.####', '.....'])
    expect(draw(0xed)).toEqual(['.#', '#.', '#.', '#.', '#.', '#.', '#.', '..']) // í: largura 2, como no jogo
  })
})

describe('parsePixelFont', () => {
  it('lê glifos, peças e composições', () => {
    const parsed = parsePixelFont(
      ['== x', ...Array<string>(7).fill('#.'), '..', '', '== @dot', '#', '', 'y = x + @dot'].join('\n'),
    )
    expect(parsed.glyphs.get(0x78)?.inkWidth).toBe(1)
    expect(parsed.parts.has('@dot')).toBe(true)
    expect(parsed.glyphs.get(0x79)?.top).toBe(-1)
  })

  it('aponta a linha com erro', () => {
    expect(() => parsePixelFont('== a\n##\n#.#')).toThrow(PixelFontError)
    expect(() => parsePixelFont('== a\n##\n#.#')).toThrow(/linha 3/)
    expect(() => parsePixelFont('== a\n#\n#')).toThrow(/8 linhas/)
    expect(() => parsePixelFont('== a\n#x')).toThrow(/'#' e '.'/)
    expect(() => parsePixelFont('b = a + @acute')).toThrow(/base não encontrada/)
  })
})
