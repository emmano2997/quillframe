// Livros de exemplo (os casos de teste do packages/shared). Só são importados no modo de
// desenvolvimento: o build de produção não inclui este arquivo nem os livros.
const files = import.meta.glob<string>('../../../../packages/shared/test/fixtures/books/*.stendhal', {
  query: '?raw',
  import: 'default',
})

export const sampleBooks = Object.entries(files).map(([path, load]) => ({
  name: path.split('/').at(-1)?.replace('.stendhal', '') ?? path,
  load,
}))
