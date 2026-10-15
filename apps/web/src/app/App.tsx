import { useState } from 'react'
import { BookViewerScreen } from '../screens/BookViewerScreen.tsx'
import { TitleScreen } from '../screens/TitleScreen.tsx'
import { useGuiScale } from '../ui/useGuiScale.ts'

// Fase 0: duas telas, sem rotas ainda (o React Router entra na Fase 1)
type Screen = 'title' | 'viewer'

const SCALES = [null, 2, 3, 4] as const

export function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [scaleIndex, setScaleIndex] = useState(0)
  const guiScale = useGuiScale(SCALES[scaleIndex] ?? null)

  if (screen === 'viewer') {
    return (
      <BookViewerScreen
        guiScale={guiScale}
        onBack={() => setScreen('title')}
        onCycleScale={() => setScaleIndex((index) => (index + 1) % SCALES.length)}
      />
    )
  }
  return <TitleScreen onOpenViewer={() => setScreen('viewer')} />
}
