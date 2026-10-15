import { describe, expect, it } from 'vitest'
import {
  applyFormatCode,
  EMPTY_STYLE,
  iterateFormatted,
  PAGE_STYLE,
  REPLACEMENT_CHARACTER,
  stripFormatting,
  toFormatCode,
  type TextStyle,
} from '../src/index.ts'

function visible(text: string, style: TextStyle = PAGE_STYLE, reset: TextStyle = EMPTY_STYLE) {
  const out: { index: number; ch: string; style: TextStyle }[] = []
  iterateFormatted(text, 0, style, reset, (index, s, codePoint) => {
    out.push({ index, ch: String.fromCodePoint(codePoint), style: s })
    return true
  })
  return out
}

describe('toFormatCode', () => {
  it('reconhece cores e estilos, inclusive maiúsculos', () => {
    expect(toFormatCode('a')).toBe('a')
    expect(toFormatCode('A')).toBe('a')
    expect(toFormatCode('L')).toBe('l')
    expect(toFormatCode('r')).toBe('r')
    expect(toFormatCode('9')).toBe('9')
  })

  it('aceita o sinal de Kelvin como "k", como o Character.toLowerCase do Java', () => {
    expect(toFormatCode(String.fromCharCode(0x212a))).toBe('k')
  })

  it('recusa o que não é código', () => {
    for (const ch of ['g', 'i', ' ', '\n', '§', '´', 'İ']) expect(toFormatCode(ch)).toBeNull()
    expect(toFormatCode(undefined)).toBeNull()
  })
})

describe('applyFormatCode', () => {
  it('uma cor apaga os estilos ativos', () => {
    const boldThenRed = applyFormatCode(applyFormatCode(EMPTY_STYLE, 'l'), 'c')
    expect(boldThenRed).toMatchObject({ color: 'c', bold: false })
  })

  it('estilo depois da cor soma', () => {
    const redThenBold = applyFormatCode(applyFormatCode(EMPTY_STYLE, 'c'), 'l')
    expect(redThenBold).toMatchObject({ color: 'c', bold: true })
  })
})

describe('iterateFormatted', () => {
  it('aplica os códigos e esconde o "§" e o código', () => {
    const chars = visible('a§cb')
    expect(chars.map((c) => c.ch).join('')).toBe('ab')
    expect(chars[1]).toMatchObject({ index: 3, style: { color: 'c' } })
  })

  it('"§" + caractere que não é código esconde os dois', () => {
    expect(
      visible('a§ b')
        .map((c) => c.ch)
        .join(''),
    ).toBe('ab')
    expect(
      visible('a§§b')
        .map((c) => c.ch)
        .join(''),
    ).toBe('ab')
    expect(
      visible('x§´y')
        .map((c) => c.ch)
        .join(''),
    ).toBe('xy')
  })

  it('"§" + "\\n" esconde a quebra de linha', () => {
    expect(
      visible('a§\nb')
        .map((c) => c.ch)
        .join(''),
    ).toBe('ab')
  })

  it('descarta um "§" no fim do texto', () => {
    expect(
      visible('ab§')
        .map((c) => c.ch)
        .join(''),
    ).toBe('ab')
  })

  it('"§r" volta para o estilo de reset', () => {
    const chars = visible('§c§la§rb', PAGE_STYLE, EMPTY_STYLE)
    expect(chars[0]?.style).toMatchObject({ color: 'c', bold: true })
    expect(chars[1]?.style).toEqual(EMPTY_STYLE)
  })

  it('junta surrogates e troca os soltos por U+FFFD', () => {
    expect(visible('💔').map((c) => c.ch)).toEqual(['💔'])
    expect(visible('a\uD83D').map((c) => c.ch.codePointAt(0))).toEqual([0x61, REPLACEMENT_CHARACTER])
    // "§" esconde só a primeira metade do emoji; a segunda vira U+FFFD
    expect(visible('§💔x').map((c) => c.ch.codePointAt(0))).toEqual([REPLACEMENT_CHARACTER, 0x78])
  })

  it('para quando o sink devolve false', () => {
    let count = 0
    const done = iterateFormatted('abc', 0, EMPTY_STYLE, EMPTY_STYLE, () => ++count < 2)
    expect(done).toBe(false)
    expect(count).toBe(2)
  })
})

describe('stripFormatting', () => {
  it('devolve só o texto visível', () => {
    expect(stripFormatting('§4💔§r ok§§!')).toBe('💔 ok!')
  })
})
