// Antes dos testes da API: aplica as migrations no banco de teste e o esvazia.
// O banco é o `quillframe_test` (docker compose up -d postgres); nunca o de desenvolvimento.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createDb } from '../src/app.ts'
import { TEST_ENV, testConfig } from './helpers.ts'

export default async function setup(): Promise<void> {
  const url = new URL(TEST_ENV.DATABASE_URL)
  if (!url.pathname.endsWith('_test')) {
    throw new Error(`Os testes só rodam num banco terminado em "_test" (recebido: ${url.pathname})`)
  }
  const cwd = path.resolve(import.meta.dirname, '..')
  try {
    execFileSync(
      process.execPath,
      [path.join(cwd, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd,
        env: {
          ...process.env,
          DATABASE_URL: TEST_ENV.DATABASE_URL,
          DATABASE_MIGRATION_URL: TEST_ENV.DATABASE_URL,
        },
        stdio: 'pipe',
      },
    )
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error)
    throw new Error(
      `Não foi possível preparar o banco de teste (${url.host}${url.pathname}).\n` +
        'Suba o Postgres com `docker compose up -d postgres` e crie o banco `quillframe_test` (pnpm db:test:create).\n' +
        output,
      { cause: error },
    )
  }

  const db = createDb(testConfig())
  // Apagar os usuários leva junto, em cascata, quase todo o resto
  await db.$executeRaw`TRUNCATE TABLE "User", "AuditLog", "ConcernNotice", "FilterTerm", "ReservedUsername", "PendingOAuth", "ModerationAction" CASCADE`
  await db.$disconnect()
}
