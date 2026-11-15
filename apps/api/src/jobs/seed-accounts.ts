// Contas do seed de desenvolvimento (documento 02, §8.3). Ficam num arquivo à parte para os testes
// E2E entrarem com elas sem rodar o seed ao importar. Senha e segredo TOTP fixos e públicos: valem
// só nos bancos locais e de teste.

/** Senha de todas as contas do seed. */
export const DEV_PASSWORD = 'quillframe local development only'
/** Segredo TOTP das contas da equipe (o painel /mod exige 2FA). */
export const DEV_TOTP_SECRET = Buffer.from('quillframe-dev-totp!')

export const DEV_USERS = [
  { username: 'quill_admin', role: 'ADMIN', staff: true },
  { username: 'quill_mod', role: 'MODERATOR', staff: true },
  { username: 'quill_writer', role: 'USER', staff: false },
  { username: 'quill_reader', role: 'USER', staff: false },
] as const

export const devEmail = (username: string): string => `${username}@quillframe.test`
