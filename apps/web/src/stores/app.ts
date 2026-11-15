// Estado da interface fora da árvore de componentes: preferências, toasts e o modal de step-up.
import { create } from 'zustand'

export type GuiScalePreference = 'auto' | 1 | 2 | 3 | 4

export interface Preferences {
  guiScale: GuiScalePreference
  readableFont: boolean
  reduceMotion: boolean
  pageTurnAnimation: boolean
  /** 0 a 100 (documento 03, F11: ligado em 50%) */
  masterVolume: number
  interfaceSounds: boolean
  bookSounds: boolean
}

const DEFAULTS: Preferences = {
  guiScale: 'auto',
  readableFont: false,
  reduceMotion: false,
  pageTurnAnimation: true,
  masterVolume: 50,
  interfaceSounds: true,
  bookSounds: true,
}

// Só preferências de interface ficam no navegador; nada sensível (documento 03, §11)
const PREFERENCES_KEY = 'qf.preferences'

function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<Preferences>
    return { ...DEFAULTS, ...saved }
  } catch {
    return DEFAULTS
  }
}

interface PreferencesStore extends Preferences {
  set: (changes: Partial<Preferences>) => void
}

export const usePreferences = create<PreferencesStore>((set, get) => ({
  ...loadPreferences(),
  set: (changes) => {
    set(changes)
    const { set: _set, ...values } = get()
    void _set
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(values))
    } catch {
      // Armazenamento bloqueado: as preferências valem só nesta visita
    }
  },
}))

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface ToastStore {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

let nextToast = 1

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, kind = 'info') => {
    const id = nextToast++
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind }] }))
    window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })), 5000)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export const toast = (message: string, kind?: Toast['kind']) => useToasts.getState().show(message, kind)

interface ReauthStore {
  /** Promessa pendente do modal "Confirm it's you" */
  resolve: ((confirmed: boolean) => void) | null
  ask: () => Promise<boolean>
  finish: (confirmed: boolean) => void
}

export const useReauth = create<ReauthStore>((set, get) => ({
  resolve: null,
  ask: () =>
    new Promise<boolean>((resolve) => {
      // Dois pedidos ao mesmo tempo compartilham o mesmo modal
      const previous = get().resolve
      set({
        resolve: (confirmed) => {
          previous?.(confirmed)
          resolve(confirmed)
        },
      })
    }),
  finish: (confirmed) => {
    get().resolve?.(confirmed)
    set({ resolve: null })
  },
}))
