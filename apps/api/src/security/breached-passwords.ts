// Senhas vazadas pela API Pwned Passwords, com k-anonimato (documento 02, §5.2): só os 5 primeiros
// caracteres do SHA-1 saem do servidor; a comparação é local.
import { normalizePassword } from '@quillframe/shared'
import { createHash } from 'node:crypto'

const RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const TIMEOUT_MS = 3_000

/** `unknown`: a API não respondeu. O cadastro segue e o caso fica no log (proposta do documento 02). */
export type BreachStatus = 'breached' | 'clean' | 'unknown'

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export async function checkBreachedPassword(password: string, fetchFn: Fetch = fetch): Promise<BreachStatus> {
  const sha1 = createHash('sha1').update(normalizePassword(password)).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)

  let body: string
  try {
    const response = await fetchFn(RANGE_URL + prefix, {
      // Add-Padding esconde o tamanho real da resposta de quem observa a rede
      headers: { 'Add-Padding': 'true', 'User-Agent': 'quillframe' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
    if (!response.ok) return 'unknown'
    body = await response.text()
  } catch {
    return 'unknown'
  }

  for (const line of body.split('\n')) {
    const [candidate, count] = line.trim().split(':')
    // As linhas de padding vêm com contagem 0
    if (candidate === suffix && Number(count) > 0) return 'breached'
  }
  return 'clean'
}

/** Palavras do contexto que não podem formar a senha (documento 02, §5.2). */
export function containsContextWord(
  password: string,
  context: { username?: string; email?: string },
): boolean {
  const normalized = normalizePassword(password).toLowerCase()
  const words = ['quillframe', 'minecraft']
  if (context.username) words.push(context.username.toLowerCase())
  const local = context.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4) words.push(local)
  // A senha é recusada só se for basicamente a palavra (com poucos caracteres a mais), não se a contiver numa frase
  return words.some((word) => normalized.includes(word) && normalized.length - word.length < 8)
}
