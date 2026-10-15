import { useState } from 'react'
import { en } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import styles from './TitleScreen.module.css'

interface TitleScreenProps {
  onOpenViewer: () => void
}

// Fase 0: só o leitor funciona; o resto da tela segue o desenho do documento 03, §2.5
export function TitleScreen({ onOpenViewer }: TitleScreenProps) {
  const [splash] = useState(() => en.splash[Math.floor(Math.random() * en.splash.length)])
  return (
    <div className={styles.screen}>
      <main className={styles.center}>
        <div className={styles.logoArea}>
          <h1 className={styles.logo}>QUILLFRAME</h1>
          <p className={styles.splash} aria-hidden="true">
            {splash}
          </p>
        </div>
        <Button wide disabled title={en.title.comingSoon}>
          {en.title.myBooks}
        </Button>
        <Button wide disabled title={en.title.comingSoon}>
          {en.title.community}
        </Button>
        <Button wide onClick={onOpenViewer}>
          {en.title.bookViewer}
        </Button>
        <div className={styles.row}>
          <Button disabled title={en.title.comingSoon}>
            {en.title.options}
          </Button>
          <Button disabled title={en.title.comingSoon}>
            {en.title.friends}
          </Button>
        </div>
      </main>
      <footer className={styles.footer}>
        <span>{en.app.version}</span>
        <span>{en.app.disclaimer}</span>
      </footer>
    </div>
  )
}
