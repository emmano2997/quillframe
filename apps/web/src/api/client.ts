// Cliente HTTP da API (documento 03, §11). A sessão fica só no cookie HttpOnly: o JavaScript nunca
// vê o token. Toda mutação vai como JSON, com o token CSRF lido do cookie `__Host-qf_csrf`.

export interface FieldIssue {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  /** Mensagem em inglês, pronta para a tela */
  readonly detail: string
  readonly fields: FieldIssue[]
  /** Corpo completo do erro (ex.: `currentVersion` num VERSION_CONFLICT) */
  readonly body: Record<string, unknown>
  readonly retryAfter: number | null

  constructor(status: number, body: Record<string, unknown>, retryAfter: number | null = null) {
    const detail =
      typeof body['detail'] === 'string' ? body['detail'] : 'Something went wrong. Please try again.'
    super(detail)
    this.status = status
    this.code = typeof body['code'] === 'string' ? body['code'] : 'INTERNAL'
    this.detail = detail
    this.fields = Array.isArray(body['fields']) ? (body['fields'] as FieldIssue[]) : []
    this.body = body
    this.retryAfter = retryAfter
  }

  fieldMessage(field: string): string | undefined {
    return this.fields.find((issue) => issue.field === field)?.message
  }
}

const CSRF_COOKIE = '__Host-qf_csrf'
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function csrfFromCookie(): string | null {
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(`${CSRF_COOKIE}=`)) return decodeURIComponent(part.slice(CSRF_COOKIE.length + 1))
  }
  return null
}

async function fetchCsrf(): Promise<string | null> {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
  if (!response.ok) return null
  return ((await response.json()) as { csrfToken?: string }).csrfToken ?? null
}

interface Handlers {
  /** Abre o modal "Confirm it's you"; resolve true se a pessoa confirmou */
  reauth: () => Promise<boolean>
  /** A sessão caiu no meio do uso */
  sessionLost: () => void
}

const handlers: Handlers = { reauth: async () => false, sessionLost: () => undefined }

export function setApiHandlers(next: Partial<Handlers>): void {
  Object.assign(handlers, next)
}

export interface RequestOptions {
  /** Não abrir o modal de step-up nem avisar da sessão perdida (telas de login) */
  silent?: boolean
  keepalive?: boolean
  signal?: AbortSignal
  /** Devolve a resposta crua (downloads) */
  raw?: boolean
}

async function send(method: string, path: string, body: unknown, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (MUTATIONS.has(method)) {
    const csrf = csrfFromCookie() ?? (await fetchCsrf())
    if (csrf) headers['X-CSRF-Token'] = csrf
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(options.keepalive ? { keepalive: true } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
}

async function toError(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    // Resposta sem JSON (proxy fora do ar): fica a mensagem genérica
  }
  const retry = Number(response.headers.get('Retry-After'))
  return new ApiError(response.status, body, Number.isFinite(retry) && retry > 0 ? retry : null)
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let response = await send(method, path, body, options)
  let error = response.ok ? null : await toError(response)

  // O token CSRF é ligado à sessão: depois de um login ou logout em outra aba, pega um novo e repete
  if (error?.code === 'CSRF_FAILED') {
    await fetchCsrf()
    response = await send(method, path, body, options)
    error = response.ok ? null : await toError(response)
  }
  // Ação sensível sem confirmação recente: abre o modal de step-up e repete o pedido
  if (error?.code === 'REAUTH_REQUIRED' && !options.silent && (await handlers.reauth())) {
    response = await send(method, path, body, options)
    error = response.ok ? null : await toError(response)
  }
  if (error) {
    if (error.code === 'UNAUTHENTICATED' && !options.silent) handlers.sessionLost()
    throw error
  }
  if (options.raw) return response as T
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  put: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),
  patch: <T>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('DELETE', path, body, options),
}

/** Mensagem para a tela a partir de qualquer erro. Nunca mostra stack trace. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfter) {
      const minutes = Math.max(1, Math.ceil(error.retryAfter / 60))
      return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
    }
    return error.detail
  }
  return navigator.onLine
    ? 'Something went wrong. Please try again.'
    : "You're offline. Please check your connection."
}

/** Baixa a resposta de um GET como arquivo (exportação .stendhal e ZIP dos dados). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const response = await request<Response>('GET', path, undefined, { raw: true })
  const name = /filename="([A-Za-z0-9._-]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name ?? fallbackName
  link.click()
  URL.revokeObjectURL(url)
}
