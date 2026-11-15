// Salvamento automático do editor (documento 03, §5.10): envia a página cerca de 1,5 s depois da
// última tecla, uma requisição por vez (cada uma depende da versão devolvida pela anterior).
import { api, ApiError } from '../api/client.ts'
import { clearPendingBook, savePending } from './offline.ts'

export type SaveState = 'saved' | 'saving' | 'offline' | 'conflict' | 'error'

const DEBOUNCE_MS = 1500
const MAX_BACKOFF_MS = 30_000

interface VersionResult {
  version: number
  pageCount?: number
}

export class BookSaver {
  readonly bookId: string
  version: number
  private pages: string[]
  private readonly dirty = new Set<number>()
  private timer: number | null = null
  private running: Promise<void> | null = null
  private backoff = 2000
  private disposed = false
  private readonly onState: (state: SaveState) => void
  state: SaveState = 'saved'

  constructor(bookId: string, version: number, pages: string[], onState: (state: SaveState) => void) {
    this.bookId = bookId
    this.version = version
    this.pages = pages
    this.onState = onState
    window.addEventListener('online', this.onOnline)
    window.addEventListener('pagehide', this.onPageHide)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) window.clearTimeout(this.timer)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('pagehide', this.onPageHide)
  }

  get hasPending(): boolean {
    return this.dirty.size > 0 || this.running !== null
  }

  private setState(state: SaveState): void {
    this.state = state
    if (!this.disposed) this.onState(state)
  }

  /** O editor mudou a página `index`. */
  update(pages: string[], index: number): void {
    this.pages = pages
    this.dirty.add(index)
    if (this.state !== 'conflict') this.setState(navigator.onLine ? 'saving' : 'offline')
    this.schedule(DEBOUNCE_MS)
  }

  private schedule(delay: number): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), delay)
  }

  /** Envia tudo o que está pendente (ao trocar de página, ao sair da tela, antes de assinar). */
  flush(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<void> {
    while (this.dirty.size > 0 && this.state !== 'conflict') {
      const index = this.dirty.values().next().value as number
      const content = this.pages[index]
      this.dirty.delete(index)
      if (content === undefined) continue
      try {
        const result = await api.put<VersionResult>(`/api/books/${this.bookId}/pages/${index}`, {
          content,
          baseVersion: this.version,
        })
        this.version = result.version
        this.backoff = 2000
      } catch (error) {
        this.dirty.add(index)
        await this.failed(error)
        return
      }
    }
    if (this.dirty.size === 0 && this.state !== 'conflict') {
      await clearPendingBook(this.bookId)
      this.setState('saved')
    }
  }

  private async failed(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      this.setState('conflict')
      return
    }
    // O que não foi enviado fica guardado neste aparelho e é reenviado depois
    await savePending({ bookId: this.bookId, pages: this.pages, savedAt: Date.now() })
    const offline = !(error instanceof ApiError) || !navigator.onLine
    // Erros definitivos (livro assinado, removido, sessão caída) não melhoram tentando de novo
    const fatal = error instanceof ApiError && ![429, 500, 502, 503, 504].includes(error.status)
    this.setState(offline ? 'offline' : 'error')
    if (fatal) return
    const wait = error instanceof ApiError && error.retryAfter ? error.retryAfter * 1000 : this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    this.schedule(wait)
  }

  /**
   * Operações que mudam a estrutura do livro (inserir, remover, trocar todas as páginas): primeiro
   * envia o que está pendente, depois chama a API com a versão atual.
   */
  async structural(pages: string[], call: (version: number) => Promise<VersionResult>): Promise<void> {
    await this.flush()
    if (this.dirty.size > 0) throw new ApiError(0, { detail: "Couldn't save. Check your connection and try again." })
    const result = await call(this.version)
    this.version = result.version
    this.pages = pages
    this.setState('saved')
  }

  /** "Use this version": envia as páginas deste aparelho por cima do que está no servidor. */
  async overwrite(): Promise<void> {
    const current = await api.get<{ version: number }>(`/api/books/${this.bookId}`)
    const result = await api.put<VersionResult>(`/api/books/${this.bookId}/pages`, {
      pages: this.pages,
      baseVersion: current.version,
    })
    this.version = result.version
    this.dirty.clear()
    await clearPendingBook(this.bookId)
    this.setState('saved')
  }

  private readonly onOnline = (): void => {
    if (this.dirty.size > 0 && this.state !== 'conflict') {
      this.setState('saving')
      void this.flush()
    }
  }

  /** Ao fechar a aba com algo pendente: envia com keepalive e guarda uma cópia neste aparelho. */
  private readonly onPageHide = (): void => {
    if (this.dirty.size === 0) return
    void savePending({ bookId: this.bookId, pages: this.pages, savedAt: Date.now() })
    const [index] = this.dirty
    const content = index === undefined ? undefined : this.pages[index]
    if (index === undefined || content === undefined) return
    void api
      .put(`/api/books/${this.bookId}/pages/${index}`, { content, baseVersion: this.version }, { keepalive: true, silent: true })
      .catch(() => undefined)
  }
}
