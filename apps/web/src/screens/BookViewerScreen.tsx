import { parseStendhal, type StendhalBook } from '@quillframe/shared'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { BookView } from '../book/BookView.tsx'
import { createBoxGlyphs, createPackGlyphs, loadReferenceGlyphs, type GlyphSource } from '../book/glyphs.ts'
import { en, format } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import styles from './BookViewerScreen.module.css'

interface SampleBook {
  name: string
  load: () => Promise<string>
}

interface BookViewerScreenProps {
  onBack: () => void
  guiScale: number
  onCycleScale: () => void
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

type FontMode = 'pack' | 'reference' | 'boxes'
const FONT_LABELS: Record<FontMode, string> = {
  pack: en.viewer.packFont,
  reference: en.viewer.referenceFont,
  boxes: en.viewer.boxFont,
}

async function loadBackground(): Promise<HTMLImageElement | null> {
  const image = new Image()
  image.src = '/reference-pack/book.png'
  return image.decode().then(
    () => image,
    () => null,
  )
}

export function BookViewerScreen({ onBack, guiScale, onCycleScale }: BookViewerScreenProps) {
  const [samples, setSamples] = useState<SampleBook[]>([])
  const [book, setBook] = useState<StendhalBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<{
    glyphs: GlyphSource
    background: HTMLImageElement | null
  } | null>(null)
  const [fontMode, setFontMode] = useState<FontMode>('pack')
  const [boxes] = useState(createBoxGlyphs)
  const [pack, setPack] = useState(() => createPackGlyphs())
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Pacote de referência e livros de exemplo só existem no servidor de desenvolvimento
    if (!import.meta.env.DEV) return
    void import('../dev/sampleBooks.ts').then((module) => setSamples(module.sampleBooks))
    void Promise.all([loadReferenceGlyphs(), loadBackground()]).then(([glyphs, background]) => {
      if (!glyphs) return
      setReference({ glyphs, background })
      // Emojis e símbolos da Unifont: no desenvolvimento, vêm do pacote de referência
      setPack(createPackGlyphs(glyphs))
    })
  }, [])

  const open = (text: string) => {
    try {
      setBook(parseStendhal(text))
      setError(null)
    } catch (cause) {
      setError(
        format(en.viewer.fileError, { message: cause instanceof Error ? cause.message : String(cause) }),
      )
    }
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(format(en.viewer.fileError, { message: 'the file is larger than 2 MB.' }))
      return
    }
    open(await file.text())
  }

  const modes: FontMode[] = reference ? ['pack', 'reference', 'boxes'] : ['pack', 'boxes']
  const cycleFont = () => setFontMode((mode) => modes[(modes.indexOf(mode) + 1) % modes.length] ?? 'pack')
  const glyphs =
    fontMode === 'reference' && reference ? reference.glyphs : fontMode === 'boxes' ? boxes : pack
  const background = fontMode === 'reference' ? (reference?.background ?? null) : null
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Button onClick={onBack}>{en.viewer.back}</Button>
        <h1 className={styles.title}>{en.viewer.title}</h1>
        <Button onClick={onCycleScale}>{format(en.viewer.guiScale, { scale: guiScale })}</Button>
      </header>

      <div className={styles.layout}>
        <aside className={styles.panel}>
          <Button onClick={() => fileInput.current?.click()}>{en.viewer.openFile}</Button>
          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".stendhal,.txt"
            onChange={onFile}
          />
          {samples.length > 0 && (
            <>
              <h2 className={styles.panelTitle}>{en.viewer.sampleBooks}</h2>
              <ul className={styles.list}>
                {samples.map((sample) => (
                  <li key={sample.name}>
                    <Button onClick={() => void sample.load().then(open)}>{sample.name}</Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button onClick={cycleFont}>{FONT_LABELS[fontMode]}</Button>
        </aside>

        <section>
          {error && <p className={styles.error}>{error}</p>}
          {book && (
            <>
              <p className={styles.bookTitle}>
                {book.title} {format(en.viewer.byAuthor, { author: book.author })}
              </p>
              <BookView book={book} glyphs={glyphs} background={background} scale={guiScale} />
            </>
          )}
          {!reference && <p className={styles.hint}>{en.viewer.noReference}</p>}
        </section>
      </div>
    </div>
  )
}
