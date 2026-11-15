// Roda os jobs diários: `node src/jobs/run.ts` (todos) ou `node src/jobs/run.ts cleanup retention`.
// Só precisa de DATABASE_URL: os jobs não usam os segredos da aplicação.
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { JOBS, type JobName } from './jobs.ts'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('DATABASE_URL não definido')
  process.exit(1)
}

const names = process.argv.slice(2)
const unknown = names.filter((name) => !(name in JOBS))
if (unknown.length > 0) {
  console.error(`Job desconhecido: ${unknown.join(', ')}. Disponíveis: ${Object.keys(JOBS).join(', ')}`)
  process.exit(1)
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
const now = new Date()
let failed = false
for (const name of (names.length > 0 ? names : Object.keys(JOBS)) as JobName[]) {
  try {
    console.log(JSON.stringify({ job: name, ...(await JOBS[name](db, now)) }))
  } catch (error) {
    failed = true
    console.error(
      JSON.stringify({ job: name, error: error instanceof Error ? error.message : String(error) }),
    )
  }
}
await db.$disconnect()
process.exit(failed ? 1 : 0)
