// Segurança vista do navegador (documento 03, §15): cookies fora do alcance do JavaScript, nada
// sensível no storage e "sair" apagando os dados locais. A ausência de violações da CSP é conferida
// em todo teste (support/app.ts).
import { DEV_PASSWORD, expect, signInAs, test } from '../support/app.ts'

test('a sessão fica em cookies HttpOnly e nada sensível vai para o storage', async ({ page, context }) => {
  await signInAs(page, 'quill_writer')
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: 'My Books' })).toBeVisible()

  const cookies = await context.cookies()
  const session = cookies.find((cookie) => cookie.name === '__Host-qf_session')
  expect(session, 'cookie de sessão').toBeDefined()
  expect(session).toMatchObject({ httpOnly: true, secure: true, path: '/' })
  expect(['Lax', 'Strict']).toContain(session?.sameSite)
  expect(session?.domain).not.toMatch(/^\./)

  // O JavaScript da página não enxerga a sessão
  const visible = await page.evaluate(() => document.cookie)
  expect(visible).not.toContain('qf_session')
  expect(visible).not.toContain(session?.value)

  const storage = await page.evaluate(() => {
    const dump = (store: Storage) =>
      Array.from({ length: store.length }, (_, index) => {
        const key = store.key(index) ?? ''
        return `${key}=${store.getItem(key) ?? ''}`
      })
    return [...dump(localStorage), ...dump(sessionStorage)].join('\n')
  })
  for (const secret of [session?.value ?? '', DEV_PASSWORD, 'quill_writer@quillframe.test']) {
    expect(storage).not.toContain(secret)
  }
})

test('sair encerra a sessão e apaga os dados locais', async ({ page, context }) => {
  await signInAs(page, 'quill_writer')
  // Um rascunho aberto deixa dados da conta no cache e no IndexedDB
  await page.goto('/library')
  await page.getByText('My first draft').dblclick()
  await expect(page).toHaveURL(/\/editor\//)
  await page.goto('/')
  await page.getByRole('button', { name: 'Log Out' }).click()
  await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible()

  const cookies = await context.cookies()
  expect(cookies.find((cookie) => cookie.name === '__Host-qf_session')).toBeUndefined()
  const pending = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('quillframe')
        open.onerror = () => reject(open.error)
        open.onupgradeneeded = () => open.result.createObjectStore('pending-pages')
        open.onsuccess = () => {
          const count = open.result.transaction('pending-pages').objectStore('pending-pages').count()
          count.onsuccess = () => resolve(count.result)
          count.onerror = () => reject(count.error)
        }
      }),
  )
  expect(pending).toBe(0)

  // As telas da conta voltam a pedir login
  await page.goto('/library')
  await expect(page).toHaveURL(/\/login\?returnTo=/)
})
