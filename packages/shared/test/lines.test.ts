import { describe, expect, it } from 'vitest'
import {
  editorLines,
  fitsInGamePage,
  layoutPage,
  readerLines,
  splitLines,
  type TextLine,
} from '../src/index.ts'

// "a" tem 6 px: 19 "a" = 114 px, a largura exata da linha
const a = (n: number) => 'a'.repeat(n)
const ranges = (lines: TextLine[]) => lines.map((l) => `${l.start}-${l.end}:${l.breakKind}`)

describe('splitLines', () => {
  it('uma linha de exatamente 114 px cabe', () => {
    expect(ranges(splitLines(a(19)))).toEqual(['0-19:end'])
  })

  it('passou de 114 px: quebra no caractere que não coube', () => {
    expect(ranges(splitLines(a(20)))).toEqual(['0-19:char', '19-20:end'])
  })

  it('quebra no último espaço e consome o espaço', () => {
    // 10 "a" + espaço = 64 px; o 9º "a" da segunda palavra passa de 114
    expect(ranges(splitLines(`${a(10)} ${a(10)}`))).toEqual(['0-10:space', '11-21:end'])
  })

  it('um espaço que passa do limite é consumido e não gera linha nova', () => {
    expect(ranges(splitLines(`${a(19)} `))).toEqual(['0-19:space'])
  })

  it('"\\n" quebra na hora e é consumido', () => {
    expect(ranges(splitLines('ab\ncd'))).toEqual(['0-2:newline', '3-5:end'])
  })

  it('"§\\n" não quebra a linha', () => {
    expect(ranges(splitLines('ab§\ncd'))).toEqual(['0-6:end'])
  })

  it('o primeiro caractere com largura nunca quebra, mesmo maior que o limite', () => {
    expect(ranges(splitLines('aa', { maxWidth: 3 }))).toEqual(['0-1:char', '1-2:end'])
  })

  it('negrito ocupa 1 px a mais por caractere', () => {
    // "a" em negrito = 7 px: cabem 16 (112 px)
    expect(ranges(splitLines(`§l${a(17)}`))).toEqual(['0-18:char', '18-19:end'])
  })

  it('a linha seguinte começa com o estilo do ponto da quebra', () => {
    const lines = splitLines(`§c${a(20)}`)
    expect(lines[1]?.style).toMatchObject({ color: 'c' })
  })
})

describe('linhas da leitura e do editor', () => {
  it('"\\n" no fim gera uma linha vazia nos dois', () => {
    expect(readerLines('ab\n')).toHaveLength(2)
    expect(editorLines('ab\n')).toHaveLength(2)
  })

  it('"§\\n" no fim: o editor do jogo conta uma linha a mais, a leitura não', () => {
    expect(readerLines('ab§\n')).toHaveLength(1)
    expect(editorLines('ab§\n')).toHaveLength(2)
  })

  it('página vazia não tem linhas', () => {
    expect(readerLines('')).toHaveLength(0)
    expect(editorLines('')).toHaveLength(0)
  })

  it('cabe no livro: até 14 linhas e 1024 caracteres', () => {
    expect(fitsInGamePage('\n'.repeat(14))).toBe(true)
    expect(fitsInGamePage('\n'.repeat(15))).toBe(false)
    // Códigos contam no limite de caracteres, mas não ocupam espaço na linha
    expect(fitsInGamePage('§r'.repeat(512))).toBe(true)
    expect(fitsInGamePage(`${'§r'.repeat(512)}a`)).toBe(false)
  })

  it('a linha vazia depois de um "\\n" final não conta (editor até a 1.21.5)', () => {
    const fourteenLines = Array.from({ length: 14 }, () => 'x').join('\n')
    expect(fitsInGamePage(`${fourteenLines}\n`)).toBe(true)
    expect(editorLines(`${fourteenLines}\n`)).toHaveLength(15)
  })
})

describe('layoutPage', () => {
  it('posiciona cada glifo pela soma dos avanços', () => {
    const [line] = layoutPage('ai ').lines
    expect(line?.glyphs.map((g) => g.x)).toEqual([0, 6, 8])
    expect(line?.width).toBe(12)
  })

  it('numa linha que continuou, o §r volta ao estilo em que a linha começou', () => {
    const { lines } = layoutPage(`§c${a(20)}§rb`)
    const b = lines[1]?.glyphs.at(-1)
    expect(String.fromCodePoint(b?.codePoint ?? 0)).toBe('b')
    expect(b?.style).toMatchObject({ color: 'c' })
  })

  it('a primeira linha começa preta (estilo da página)', () => {
    expect(layoutPage('x').lines[0]?.glyphs[0]?.style.color).toBe('0')
  })

  it('depois de um §r, a linha seguinte pode começar sem cor', () => {
    // A medição usa §r → estilo vazio; a quebra cai depois dele
    const { lines } = layoutPage(`§c${a(5)}§r${a(20)}`)
    expect(lines[1]?.style.color).toBeNull()
  })

  it('mostra no máximo 14 linhas', () => {
    expect(layoutPage('\n'.repeat(20)).visibleLines).toBe(14)
  })
})
