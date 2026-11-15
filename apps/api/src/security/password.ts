// Hash de senha: NFKC → Argon2id com pepper versionado (documento 02, §5.2).
import { normalizePassword } from '@quillframe/shared'
import argon2 from 'argon2'

/** Mínimo da OWASP para Argon2id. Nunca baixar; se o login ficar lento, aceitar a lentidão. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

/** Cada hash usa 19 MiB: no máximo 4 ao mesmo tempo, para uma enxurrada de logins não esgotar a memória. */
const MAX_CONCURRENT_HASHES = 4

export interface StoredPassword {
  passwordHash: string
  pepperVersion: number
}

export type VerifyResult =
  | { ok: false }
  /** `rehash` vem preenchido quando os parâmetros ou o pepper mudaram: gravar no lugar do antigo. */
  | { ok: true; rehash: StoredPassword | null }

export class PasswordHasher {
  private running = 0
  private readonly waiting: (() => void)[] = []
  private dummyHash: Promise<string> | null = null
  private readonly peppers: ReadonlyMap<number, Buffer>
  private readonly currentVersion: number

  constructor(peppers: ReadonlyMap<number, Buffer>, currentVersion: number) {
    if (!peppers.has(currentVersion)) throw new Error(`Pepper V${currentVersion} ausente`)
    this.peppers = peppers
    this.currentVersion = currentVersion
  }

  async hash(password: string): Promise<StoredPassword> {
    const passwordHash = await this.limit(() =>
      argon2.hash(normalizePassword(password), {
        ...ARGON2_OPTIONS,
        secret: this.pepper(this.currentVersion),
      }),
    )
    return { passwordHash, pepperVersion: this.currentVersion }
  }

  /**
   * `stored` nulo (usuário inexistente ou conta só com Google/Discord) verifica contra um hash falso
   * mesmo assim, para o tempo de resposta não revelar quais e-mails têm conta.
   */
  async verify(password: string, stored: StoredPassword | null): Promise<VerifyResult> {
    const pepper = stored ? this.peppers.get(stored.pepperVersion) : undefined
    if (!stored || !pepper) {
      await this.limit(async () =>
        argon2.verify(await this.getDummyHash(), normalizePassword(password), {
          secret: this.pepper(this.currentVersion),
        }),
      )
      return { ok: false }
    }

    let ok: boolean
    try {
      ok = await this.limit(() =>
        argon2.verify(stored.passwordHash, normalizePassword(password), { secret: pepper }),
      )
    } catch {
      return { ok: false } // hash corrompido: falhar fechado
    }
    if (!ok) return { ok: false }

    const outdated =
      stored.pepperVersion !== this.currentVersion || argon2.needsRehash(stored.passwordHash, ARGON2_OPTIONS)
    return { ok: true, rehash: outdated ? await this.hash(password) : null }
  }

  private pepper(version: number): Buffer {
    const pepper = this.peppers.get(version)
    if (!pepper) throw new Error(`Pepper V${version} ausente`)
    return pepper
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('quillframe dummy password', {
      ...ARGON2_OPTIONS,
      secret: this.pepper(this.currentVersion),
    })
    return this.dummyHash
  }

  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT_HASHES) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else {
      this.running++
    }
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running--
    }
  }
}
