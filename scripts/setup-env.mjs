// Prepara o .env local (documento 02, §8.3): copia o .env.example se o .env não existir e gera os
// segredos que estiverem vazios. Nunca troca um valor que já existe.
//
//   pnpm setup:env
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')

/** Variáveis que recebem 32 bytes aleatórios em base64url quando estão vazias. */
const SECRETS = ['CSRF_SECRET', 'PASSWORD_PEPPER_V1', 'MFA_ENC_KEY_V1']

const example = fs.readFileSync(examplePath, 'utf8')
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : example
const changed = []

// Linhas do exemplo que ainda não existem no .env (um .env antigo ganha as variáveis novas)
const present = new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]))
for (const line of example.split(/\r?\n/)) {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line)
  if (match && !present.has(match[1])) {
    text += `${text.endsWith('\n') ? '' : '\n'}${line}\n`
    changed.push(`${match[1]} (adicionada)`)
  }
}

for (const name of SECRETS) {
  const pattern = new RegExp(`^${name}=\\s*$`, 'm')
  if (pattern.test(text)) {
    text = text.replace(pattern, `${name}=${randomBytes(32).toString('base64url')}`)
    changed.push(`${name} (gerado)`)
  }
}

if (changed.length > 0 || !fs.existsSync(envPath)) fs.writeFileSync(envPath, text)
console.log(changed.length > 0 ? `.env atualizado: ${changed.join(', ')}` : '.env já estava completo.')
