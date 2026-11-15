// Estado de login: vem sempre de GET /api/me, nunca de algo guardado no navegador (documento 03, §11).
import { QueryClient, useQuery } from '@tanstack/react-query'
import { clear as clearPending } from 'idb-keyval'
import { api, ApiError } from '../api/client.ts'
import type { AppConfig, Me } from '../api/types.ts'
import { pendingStore } from '../book/offline.ts'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros da API (404, 403...) não melhoram tentando de novo; falhas de rede, sim
      retry: (count, error) => !(error instanceof ApiError) && count < 2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

export const ME_KEY = ['me'] as const

async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/api/me', { silent: true })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/** `data` é `null` para visitante e `undefined` enquanto carrega. */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 60_000 })
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<AppConfig>('/api/config'),
    staleTime: Infinity,
  })
}

export function refreshMe(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ME_KEY })
}

/** Ao sair (ou quando a sessão cai), apaga o cache e as alterações guardadas neste aparelho. */
export async function clearLocalData(): Promise<void> {
  queryClient.clear()
  queryClient.setQueryData(ME_KEY, null)
  try {
    await clearPending(pendingStore)
  } catch {
    // IndexedDB indisponível: não havia nada guardado
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout', {}, { silent: true })
  } catch {
    // Sessão já encerrada no servidor: o resultado para o usuário é o mesmo
  }
  await clearLocalData()
}
