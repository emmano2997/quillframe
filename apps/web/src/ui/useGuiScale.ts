import { useEffect, useState } from 'react'

// Como o "GUI Scale: Auto" do jogo: o maior inteiro em que a tela de menus cabe na janela. A largura
// de referência é 180 (e não os 320 do jogo) para que um celular em pé fique em 2×: na escala 1× o
// texto teria 8 px e os botões ficariam abaixo do alvo mínimo de toque (documento 03, §12).
function autoScale(): number {
  const fit = Math.floor(Math.min(window.innerWidth / 180, window.innerHeight / 240))
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
