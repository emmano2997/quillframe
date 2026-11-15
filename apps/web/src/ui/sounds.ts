// Sons próprios, sintetizados no navegador (documento 03, §2.2): nenhum arquivo de áudio do jogo.
// Nada toca antes da primeira interação, e o volume vem de Options → "Music & Sounds...".
import { usePreferences } from '../stores/app.ts'

let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

function volume(kind: 'interface' | 'book'): number {
  const prefs = usePreferences.getState()
  const enabled = kind === 'interface' ? prefs.interfaceSounds : prefs.bookSounds
  return enabled ? (prefs.masterVolume / 100) * 0.25 : 0
}

/** Clique curto dos botões. */
export function playClick(): void {
  const gainValue = volume('interface')
  const ctx = gainValue > 0 ? audio() : null
  if (!ctx) return
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(520, ctx.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.05)
  gain.gain.setValueAtTime(gainValue, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + 0.07)
}

/** Virar de página: um sopro de ruído filtrado. */
export function playPageTurn(): void {
  const gainValue = volume('book')
  const ctx = gainValue > 0 ? audio() : null
  if (!ctx) return
  const length = Math.floor(ctx.sampleRate * 0.18)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(1800, ctx.currentTime)
  filter.frequency.linearRampToValueAtTime(700, ctx.currentTime + 0.18)
  const gain = ctx.createGain()
  gain.gain.value = gainValue * 2
  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start()
}
