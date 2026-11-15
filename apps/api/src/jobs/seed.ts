// Dados de desenvolvimento (documento 02, §8.3): um usuário de cada papel e os livros do autor,
// importados pelo parser real. Só roda fora de produção.
//
//   pnpm db:seed
//
// As contas da equipe já vêm com 2FA (sem ele o painel /mod não abre). O segredo TOTP abaixo é fixo
// e público: serve só para o banco local.
import {
  parseStendhal,
  sanitizeLine,
  sanitizePageContent,
  TERMS_VERSION,
  truncateUtf16,
} from '@quillframe/shared'
import fs from 'node:fs'
import path from 'node:path'
import { createDb } from '../app.ts'
import { loadConfig } from '../config.ts'
import { PasswordHasher } from '../security/password.ts'
import { base32Encode, encryptSecret, otpauthUri } from '../security/totp.ts'

const config = loadConfig()
if (config.NODE_ENV === 'production') {
  console.error('O seed não roda em produção.')
  process.exit(1)
}

/** Senha de todas as contas do seed. Só existe no banco local de desenvolvimento. */
const DEV_PASSWORD = 'quillframe local development only'
const DEV_TOTP_SECRET = Buffer.from('quillframe-dev-totp!')

const USERS = [
  { username: 'quill_admin', role: 'ADMIN', staff: true },
  { username: 'quill_mod', role: 'MODERATOR', staff: true },
  { username: 'quill_writer', role: 'USER', staff: false },
  { username: 'quill_reader', role: 'USER', staff: false },
] as const

const db = createDb(config)
const hasher = new PasswordHasher(config.passwordPeppers, config.passwordPepperCurrent)
const now = new Date()
// Contas "antigas": aparecem em "New" e contam como confiáveis nas denúncias
const createdAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
const key = config.mfaKeys.get(config.mfaKeyCurrent)
if (!key) throw new Error('Chave do 2FA ausente')

const ids = new Map<string, string>()
for (const account of USERS) {
  const email = `${account.username}@quillframe.test`
  const stored = await hasher.hash(DEV_PASSWORD)
  const user = await db.user.upsert({
    where: { email },
    update: { role: account.role, status: 'ACTIVE', ...stored },
    create: {
      username: account.username,
      usernameLower: account.username,
      email,
      emailVerifiedAt: now,
      birthDate: new Date('1995-06-15T00:00:00Z'),
      role: account.role,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: now,
      createdAt,
      ...stored,
    },
  })
  ids.set(account.username, user.id)
  if (account.staff) {
    const data = {
      secretEnc: new Uint8Array(encryptSecret(DEV_TOTP_SECRET, key)),
      keyVersion: config.mfaKeyCurrent,
      enabledAt: now,
    }
    await db.totpCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    })
  }
}

// Os livros do autor (casos de teste do packages/shared), como livros públicos do quill_writer
const booksDir = path.resolve(import.meta.dirname, '../../../../packages/shared/test/fixtures/books')
const writerId = ids.get('quill_writer') as string
let imported = 0
for (const file of fs.readdirSync(booksDir).filter((name) => name.endsWith('.stendhal'))) {
  const parsed = parseStendhal(fs.readFileSync(path.join(booksDir, file), 'utf8'))
  const title = truncateUtf16(sanitizeLine(parsed.title), 64) || file.replace('.stendhal', '')
  if (await db.book.count({ where: { ownerId: writerId, title } })) continue
  const pages = (parsed.pages.length === 0 ? [''] : parsed.pages).map(sanitizePageContent)
  // As páginas entram com o livro ainda em rascunho; a assinatura vem depois (o banco trava livro assinado)
  const book = await db.book.create({
    data: {
      ownerId: writerId,
      title,
      pageCount: pages.length,
      pages: { create: pages.map((content, index) => ({ index, content })) },
    },
  })
  await db.book.update({
    where: { id: book.id },
    data: { status: 'SIGNED', visibility: 'PUBLIC', signedAt: now, publishedAt: now, version: 1 },
  })
  imported++
}

// Um rascunho para abrir no editor
if (!(await db.book.count({ where: { ownerId: writerId, status: 'DRAFT' } }))) {
  await db.book.create({
    data: {
      ownerId: writerId,
      title: 'My first draft',
      pages: { create: { index: 0, content: '§lHello!§r\nThis is a §cdraft§r.\n\nEvery page is a frame.' } },
    },
  })
}

await db.$disconnect()
console.log(`Seed pronto: ${USERS.length} contas, ${imported} livros importados.`)
console.log(`  Contas: ${USERS.map((account) => `${account.username}@quillframe.test`).join(', ')}`)
console.log(`  Senha (só neste banco local): ${DEV_PASSWORD}`)
console.log(`  2FA de quill_admin e quill_mod: segredo ${base32Encode(DEV_TOTP_SECRET)}`)
console.log(`  ${otpauthUri(DEV_TOTP_SECRET, 'dev')}`)
