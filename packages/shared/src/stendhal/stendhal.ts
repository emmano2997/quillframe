// Leitura e escrita do formato .stendhal (documento 01, §7), sem perda: escrever o que foi lido
// devolve o arquivo idêntico, byte a byte.
//
//   title: <título>
//   author: <autor>
//   pages:
//   #- <página 1>
//   #- <página 2>
//
// As páginas são unidas por "\n" e o arquivo não termina com "\n" extra. Por isso o "\n" antes de
// um "#- " é só separador, e um "\n" no fim do arquivo pertence à última página.

export interface StendhalBook {
  title: string
  author: string
  pages: string[]
}

// A mensagem aparece na tela de importação, por isso em inglês
export class StendhalFormatError extends Error {
  readonly line: number

  constructor(message: string, line: number) {
    super(`${message} (line ${line})`)
    this.name = 'StendhalFormatError'
    this.line = line
  }
}

const PAGE_PREFIX = '#- '
const PAGE_SEPARATOR = `\n${PAGE_PREFIX}`

function readHeaderLine(
  text: string,
  from: number,
  prefix: string,
  line: number,
): { value: string; next: number } {
  const end = text.indexOf('\n', from)
  const raw = end === -1 ? text.slice(from) : text.slice(from, end)
  if (!raw.startsWith(prefix)) throw new StendhalFormatError(`Expected "${prefix.trim()}"`, line)
  return { value: raw.slice(prefix.length), next: end === -1 ? text.length : end + 1 }
}

export function parseStendhal(input: string): StendhalBook {
  // Arquivos editados no Windows podem ter BOM e CRLF; o Stendhal grava UTF-8 com LF
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const text = withoutBom.replace(/\r\n/g, '\n')
  const title = readHeaderLine(text, 0, 'title: ', 1)
  const author = readHeaderLine(text, title.next, 'author: ', 2)
  const pagesHeader = readHeaderLine(text, author.next, 'pages:', 3)
  if (pagesHeader.value !== '') throw new StendhalFormatError('Expected "pages:" alone on its line', 3)

  const body = text.slice(pagesHeader.next)
  if (body === '') return { title: title.value, author: author.value, pages: [] }
  if (!body.startsWith(PAGE_PREFIX)) throw new StendhalFormatError('The first page must start with "#- "', 4)
  return {
    title: title.value,
    author: author.value,
    pages: body.slice(PAGE_PREFIX.length).split(PAGE_SEPARATOR),
  }
}

/** Problemas que impedem escrever o livro no formato (o formato não tem como escapar caracteres). */
export function stendhalIssues(book: StendhalBook): string[] {
  const issues: string[] = []
  if (book.title.includes('\n')) issues.push('The title cannot contain line breaks.')
  if (book.author.includes('\n')) issues.push('The author cannot contain line breaks.')
  book.pages.forEach((page, index) => {
    if (page.includes(PAGE_SEPARATOR)) {
      issues.push(
        `Page ${index + 1} has a line starting with "#- ", which the .stendhal format cannot store.`,
      )
    }
  })
  return issues
}

export function serializeStendhal(book: StendhalBook): string {
  const issues = stendhalIssues(book)
  if (issues.length > 0) throw new Error(issues.join(' '))
  const header = `title: ${book.title}\nauthor: ${book.author}\npages:\n`
  return book.pages.length === 0 ? header : header + PAGE_PREFIX + book.pages.join(PAGE_SEPARATOR)
}
