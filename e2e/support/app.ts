// Contas, login e os cuidados que valem para todo teste.
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { DEV_PASSWORD, DEV_TOTP_SECRET, devEmail } from '../../apps/api/src/jobs/seed-accounts.ts'
import { totpCode, totpStep } from '../../apps/api/src/security/totp.ts'

export { expect }
export { DEV_PASSWORD, devEmail }

function watchConsole(page: Page, errors: string[]): void {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.startsWith('Failed to load resource')) return
    errors.push(`${page.url()}: ${text}`)
  })
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`))
}

/**
 * Todo teste falha se o console mostrar um erro de verdade, e em especial uma violação da CSP
 * (documento 03, §15: "nenhuma violação de CSP no console"). Respostas 4xx esperadas, como o 401 de
 * quem ainda não entrou, aparecem como "Failed to load resource" e não contam.
 *
 * `newPage` abre outra pessoa (outro contexto, com cookies próprios) sob a mesma vigilância.
 */
export const test = base.extend<{ consoleErrors: string[]; newPage: () => Promise<Page> }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      watchConsole(page, errors)
      await use(errors)
      expect(errors, 'erros no console').toEqual([])
    },
    { auto: true },
  ],
  newPage: async ({ browser, consoleErrors }, use) => {
    const contexts: BrowserContext[] = []
    await use(async () => {
      const context = await browser.newContext()
      contexts.push(context)
      const page = await context.newPage()
      watchConsole(page, consoleErrors)
      return page
    })
    for (const context of contexts) await context.close()
  },
})

let lastStep = 0

/** Código do 2FA das contas da equipe do seed. Nunca repete o passo de 30 s (o servidor recusaria). */
async function nextTotp(): Promise<string> {
  while (totpStep(new Date()) <= lastStep) await new Promise((resolve) => setTimeout(resolve, 500))
  lastStep = totpStep(new Date())
  return totpCode(DEV_TOTP_SECRET, lastStep)
}

export async function signIn(
  page: Page,
  email: string,
  password: string,
  { mfa = false } = {},
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  if (mfa) {
    await page.getByLabel('Enter the 6-digit code from your authenticator app').fill(await nextTotp())
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Log Out' })).toBeVisible()
}

/** Entra com uma conta do seed (quill_writer, quill_reader, quill_mod, quill_admin). */
export async function signInAs(page: Page, username: string): Promise<void> {
  const staff = username === 'quill_mod' || username === 'quill_admin'
  await signIn(page, devEmail(username), DEV_PASSWORD, { mfa: staff })
}

/** Um nome e um e-mail que não se repetem entre execuções. */
export function uniqueAccount(prefix: string): { username: string; email: string; password: string } {
  const id = Date.now().toString(36).slice(-6)
  return {
    username: `${prefix}_${id}`,
    email: `${prefix}.${id}@e2e.quillframe.test`,
    password: `a long sentence about ${prefix} writing books ${id}`,
  }
}
