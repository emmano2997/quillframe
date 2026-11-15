// Alterações do editor que ainda não chegaram ao servidor, guardadas no IndexedDB deste aparelho
// (documento 03, §5.10). São apagadas ao sair da conta.
import { createStore, del, entries, get, set } from 'idb-keyval'

export const pendingStore = createStore('quillframe', 'pending-pages')

export interface PendingBook {
  bookId: string
  /** Páginas como estavam no editor */
  pages: string[]
  savedAt: number
}

export async function savePending(book: PendingBook): Promise<void> {
  try {
    await set(book.bookId, book, pendingStore)
  } catch {
    // Sem IndexedDB (modo privado): a alteração fica só na memória
  }
}

export async function loadPending(bookId: string): Promise<PendingBook | null> {
  try {
    return (await get<PendingBook>(bookId, pendingStore)) ?? null
  } catch {
    return null
  }
}

export async function clearPendingBook(bookId: string): Promise<void> {
  try {
    await del(bookId, pendingStore)
  } catch {
    // Nada a apagar
  }
}

export async function hasPendingChanges(): Promise<boolean> {
  try {
    return (await entries(pendingStore)).length > 0
  } catch {
    return false
  }
}
