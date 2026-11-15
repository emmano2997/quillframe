// Cloudflare Turnstile: o único script de terceiros do site, e só nas telas que precisam dele
// (documento 03, §11). Sem chave pública (desenvolvimento), devolve um token fixo.
import { useEffect, useRef } from 'react'
import { useConfig } from '../app/session.ts'

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; theme: string },
  ) => string
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptLoad: Promise<void> | null = null

function loadScript(): Promise<void> {
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptLoad = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.append(script)
  })
  return scriptLoad
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const { data: config } = useConfig()
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const siteKey = config?.turnstileSiteKey

  useEffect(() => {
    if (config === undefined) return
    if (!siteKey) {
      callback.current('dev-no-turnstile')
      return
    }
    let widget: string | null = null
    let cancelled = false
    void loadScript().then(() => {
      if (cancelled || !container.current || !window.turnstile) return
      widget = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'dark',
        callback: (token) => callback.current(token),
        'expired-callback': () => callback.current(null),
      })
    })
    return () => {
      cancelled = true
      if (widget) window.turnstile?.remove(widget)
    }
  }, [config, siteKey])

  return siteKey ? <div ref={container} /> : null
}
