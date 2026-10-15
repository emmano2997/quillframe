import { describe, expect, it } from 'vitest'
import { parseStendhal, serializeStendhal, StendhalFormatError, stendhalIssues } from '../src/index.ts'

describe('parseStendhal', () => {
  it('lê cabeçalho e páginas', () => {
    const book = parseStendhal('title: Test\nauthor: Lois_2997\npages:\n#- one\ntwo\n#- \n#- three')
    expect(book).toEqual({ title: 'Test', author: 'Lois_2997', pages: ['one\ntwo', '', 'three'] })
  })

  it('o "\\n" antes de "#- " é só separador; um "\\n" no fim pertence à última página', () => {
    expect(parseStendhal('title: t\nauthor: a\npages:\n#- one\n\n#- two\n').pages).toEqual(['one\n', 'two\n'])
  })

  it('aceita livro sem páginas', () => {
    expect(parseStendhal('title: t\nauthor: a\npages:\n').pages).toEqual([])
  })

  it('converte CRLF e remove BOM', () => {
    const bom = String.fromCharCode(0xfeff)
    expect(parseStendhal(`${bom}title: t\r\nauthor: a\r\npages:\r\n#- x\r\ny`).pages).toEqual(['x\ny'])
  })

  it('recusa arquivos fora do formato, dizendo a linha', () => {
    expect(() => parseStendhal('name: t')).toThrow(StendhalFormatError)
    expect(() => parseStendhal('title: t\nauthor: a\npages:\nsem prefixo')).toThrow(/line 4/)
  })
})

describe('serializeStendhal', () => {
  it('é o inverso exato do parse', () => {
    const text = 'title: t\nauthor: a\npages:\n#- one\n\n#- \n\n#- '
    expect(serializeStendhal(parseStendhal(text))).toBe(text)
  })

  it('aponta páginas que o formato não consegue guardar', () => {
    const book = { title: 't', author: 'a', pages: ['ok', 'line\n#- not a page'] }
    expect(stendhalIssues(book)).toHaveLength(1)
    expect(() => serializeStendhal(book)).toThrow(/Page 2/)
  })
})
