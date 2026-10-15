import { describe, expect, it } from 'vitest'
import { GLYPH_KIND, glyphAdvance, glyphKind } from '../src/index.ts'

const cp = (ch: string) => ch.codePointAt(0) ?? 0

describe('glyphAdvance', () => {
  it('bate com as larguras conhecidas da fonte padrão (documento 01, §4)', () => {
    const expected: Record<string, number> = {
      i: 2,
      '!': 2,
      l: 3,
      I: 4,
      t: 4,
      ' ': 4,
      f: 5,
      k: 5,
      a: 6,
      M: 6,
      '0': 6,
      '@': 7,
      '~': 7,
    }
    for (const [ch, advance] of Object.entries(expected)) expect(glyphAdvance(cp(ch)), ch).toBe(advance)
  })

  it('negrito soma 1 px, inclusive no espaço', () => {
    expect(glyphAdvance(cp('a'), true)).toBe(7)
    expect(glyphAdvance(cp(' '), true)).toBe(5)
  })

  it('negrito soma 0,5 px nos glifos da Unifont', () => {
    expect(glyphKind(cp('💔'))).toBe(GLYPH_KIND.unifont)
    expect(glyphAdvance(cp('💔'))).toBe(7)
    expect(glyphAdvance(cp('💔'), true)).toBe(7.5)
  })

  it('o ZWNJ do provedor de espaço tem largura 0', () => {
    expect(glyphKind(0x200c)).toBe(GLYPH_KIND.space)
    expect(glyphAdvance(0x200c)).toBe(0)
  })

  it('caractere sem glifo vira a caixa de avanço 6', () => {
    expect(glyphKind(0x10ffff)).toBe(GLYPH_KIND.missing)
    expect(glyphAdvance(0x10ffff)).toBe(6)
    expect(glyphAdvance(-1)).toBe(6)
  })
})
