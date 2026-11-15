// Antes dos testes E2E: confere o site compilado, aplica as migrations no banco quillframe_e2e, o
// esvazia e roda o seed (contas de cada papel e os livros de exemplo).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { API_ENV, DATABASE_URL, ROOT } from './support/env.ts'

const API = path.join(ROOT, 'apps/api')
const PRISMA = path.join(API, 'node_modules/prisma/build/index.js')

function run(args: string[], input?: string): void {
  execFileSync(process.execPath, args, {
    cwd: API,
    env: { ...process.env, ...API_ENV },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
    ...(input === undefined ? {} : { input }),
  })
}

export default function setup(): void {
  if (!new URL(DATABASE_URL).pathname.endsWith('_e2e')) {
    throw new Error('Os testes E2E só rodam num banco terminado em "_e2e".')
  }
  if (!fs.existsSync(path.join(API_ENV['WEB_DIST'] as string, 'index.html'))) {
    throw new Error('Compile o site antes: pnpm build (os testes usam apps/web/dist).')
  }
  try {
    run([PRISMA, 'migrate', 'deploy'])
    // Apagar os usuários leva junto, em cascata, quase todo o resto
    run(
      [PRISMA, 'db', 'execute', '--stdin'],
      'TRUNCATE TABLE "User", "AuditLog", "ConcernNotice", "FilterTerm", "ReservedUsername", "PendingOAuth", "ModerationAction" CASCADE;',
    )
    run([path.join(API, 'src/jobs/seed.ts')])
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error)
    throw new Error(
      'Não foi possível preparar o banco dos testes E2E. Suba o Postgres e o Mailpit com `docker compose up -d`.\n' +
        output,
      { cause: error },
    )
  }
}
