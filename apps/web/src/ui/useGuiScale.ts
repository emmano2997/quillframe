import { useEffect, useState } from 'react'

// Como o "GUI Scale: Auto" do jogo: o maior inteiro em que uma tela de 320×240 cabe na janela
function autoScale(): number {
  const fit = Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240))
  return Math.min(4, Math.max(1, fit))
}

/** Escala de GUI em uso (1 a 4) e aplicada ao CSS em --gui. `preferred` = null é automático. */
export function useGuiScale(preferred: number | null): number {
  const [auto, setAuto] = useState(autoScale)

  useEffect(() => {
    const onResize = () => setAuto(autoScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const scale = preferred ?? auto
  useEffect(() => {
    document.documentElement.style.setProperty('--gui', `${scale}px`)
  }, [scale])
  return scale
}
