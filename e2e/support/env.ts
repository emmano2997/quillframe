// Ambiente dos testes E2E: a API servindo o site compilado (apps/web/dist) na mesma origem, como em
// produção, com um banco só dela (quillframe_e2e), sem Redis (rate limit na memória, zerado a cada
// execução) e com os e-mails no Mailpit.
import { createHash } from 'node:crypto'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const PORT = Number(process.env['E2E_PORT'] ?? 3100)
export const BASE_URL = `http://localhost:${PORT}`
export const MAILPIT_URL = process.env['E2E_MAILPIT_URL'] ?? 'http://127.0.0.1:8025'
export const DATABASE_URL =
  process.env['E2E_DATABASE_URL'] ??
  'postgresql://quillframe:quillframe_dev_only@127.0.0.1:5432/quillframe_e2e'

/** Segredos derivados de um rótulo público: só servem para este banco de teste. */
const testSecret = (label: string): string =>
  createHash('sha256').update(`quillframe-e2e:${label}`).digest('base64url')

/** Variáveis da API nos testes. Valores vazios desligam o que viria do ambiente de quem roda. */
export const API_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: String(PORT),
  APP_ORIGIN: BASE_URL,
  DATABASE_URL,
  DATABASE_MIGRATION_URL: DATABASE_URL,
  REDIS_URL: '',
  CSRF_SECRET: testSecret('csrf'),
  PASSWORD_PEPPER_V1: testSecret('pepper'),
  PASSWORD_PEPPER_CURRENT: '1',
  MFA_ENC_KEY_V1: testSecret('mfa'),
  MFA_ENC_KEY_CURRENT: '1',
  MAILPIT_URL,
  RESEND_API_KEY: '',
  TURNSTILE_SITE_KEY: '',
  TURNSTILE_SECRET_KEY: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  DISCORD_CLIENT_ID: '',
  DISCORD_CLIENT_SECRET: '',
  WEB_DIST: path.join(ROOT, 'apps/web/dist'),
}
