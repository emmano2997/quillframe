// Todo texto visível do site fica aqui, em inglês (documento 03, §1.3).

export const en = {
  app: {
    name: 'quillframe',
    version: 'quillframe 0.1',
    disclaimer: 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.',
  },
  splash: [
    'Every page is a frame!',
    'Now with 1024 characters!',
    '100% handwritten!',
    'Turn the page!',
    'Ink not included!',
    'Sign here!',
    'Made with pixels!',
    'Also try paper!',
  ],
  title: {
    myBooks: 'My Books',
    community: 'Community',
    friends: 'Friends',
    options: 'Options...',
    bookViewer: 'Book Viewer',
    comingSoon: 'Coming soon',
  },
  viewer: {
    title: 'Book Viewer',
    back: 'Back',
    openFile: 'Open .stendhal File',
    sampleBooks: 'Sample Books',
    byAuthor: 'by {author}',
    previousPage: 'Previous Page',
    nextPage: 'Next Page',
    pageIndicator: 'Page {page} of {total}',
    guiScale: 'GUI Scale: {scale}',
    referenceFont: 'Font: Game reference (local only)',
    boxFont: 'Font: Glyph boxes',
    noReference:
      'Showing glyph boxes. To compare with the game font locally, run "pnpm reference-pack" with Minecraft installed.',
    fileError: "Couldn't open this file: {message}",
    overflow: 'This page has more than 14 lines. Lines after 14 are hidden, like in the game.',
    tooManyPages: "This book has more than 100 pages and can't be imported into the game.",
    textView: 'Text of this page',
  },
} as const

/** Troca {nome} pelos valores: format('Page {page}', { page: 2 }) → 'Page 2' */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}
