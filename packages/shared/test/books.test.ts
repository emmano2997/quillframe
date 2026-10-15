// Os livros do autor (documento 01, §8) como casos de teste.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fitsInGamePage,
  layoutPage,
  parseStendhal,
  serializeStendhal,
  splitLines,
  stripFormatting,
} from '../src/index.ts'

const dir = path.join(import.meta.dirname, 'fixtures', 'books')
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.stendhal'))

// Páginas contadas pelos "#- " de cada arquivo
const EXPECTED_PAGES: Record<string, number> = {
  'candles.stendhal': 39,
  'good_luck.stendhal': 50,
  'magnolia.stendhal': 11,
  'magnolia_pt-br.stendhal': 12,
  'novo_vem_comigo.stendhal': 11,
  'o_sol_e_a_lua.stendhal': 51,
  'palhaco.stendhal': 22,
  'partitura.stendhal': 1,
  'two_birds.stendhal': 60,
  'vem_comigo.stendhal': 9,
}

// Página com mais de 14 linhas, provavelmente colada pelo Stendhal, que não passa pelo limite do
// editor ("dajornada" sem espaço sugere texto colado). No jogo, as 2 últimas linhas não aparecem.
// [a validar no jogo]: abrir "candles", página 31, e ver se a página termina em "determinação".
const KNOWN_OVERFLOW: Record<string, { page: number; lines: number }[]> = {
  'candles.stendhal': [{ page: 31, lines: 16 }],
}

describe.each(files)('%s', (file) => {
  const bytes = fs.readFileSync(path.join(dir, file))
  const book = parseStendhal(bytes.toString('utf8'))

  it('lê e escreve de volta o arquivo idêntico, byte a byte', () => {
    expect(book.pages).toHaveLength(EXPECTED_PAGES[file] ?? -1)
    expect(Buffer.from(serializeStendhal(book), 'utf8').equals(bytes)).toBe(true)
  })

  // O editor do jogo não deixa passar de 14 linhas. Os livros têm 131 páginas com exatamente 14:
  // se as larguras ou a quebra de linha estivessem erradas, elas estourariam aqui.
  it('toda página cabe no livro, como no editor do jogo', () => {
    const overflowing = book.pages
      .map((page, index) => ({ page: index + 1, fits: fitsInGamePage(page), lines: splitLines(page).length }))
      .filter((p) => !p.fits)
      .map(({ page, lines }) => ({ page, lines }))
    expect(overflowing).toEqual(KNOWN_OVERFLOW[file] ?? [])
  })

  it('quebra de linhas (retrato para comparar com o jogo)', async () => {
    const report = book.pages
      .map((page, index) => {
        const { lines } = layoutPage(page)
        const body = lines.map((line) => `|${stripFormatting(page.slice(line.start, line.end))}|`).join('\n')
        return `=== Page ${index + 1} (${lines.length} lines) ===\n${body}`
      })
      .join('\n\n')
    await expect(`${book.title}\n\n${report}\n`).toMatchFileSnapshot(
      `__snapshots__/${file.replace('.stendhal', '.lines.txt')}`,
    )
  })
})
