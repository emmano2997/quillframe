// Acessibilidade (documento 03, §15): as telas principais sem violações sérias ou críticas no axe-core.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, signInAs, test } from '../support/app.ts'

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n    ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join('\n    ')}`,
    )
}

/** Abre um dos livros públicos do seed. */
async function openPublicBook(page: Page): Promise<void> {
  const response = await page.request.get('/api/users/quill_writer/books?limit=1')
  const { items } = (await response.json()) as { items: { id: string }[] }
  await page.goto(`/book/${items[0]?.id}`)
}

const PUBLIC_PAGES = [
  ['Title Screen', '/'],
  ['Sign In', '/login'],
  ['Create Account', '/register'],
  ['Community', '/community'],
  ['Community Guidelines', '/guidelines'],
  ['Report a Concern', '/report-concern'],
] as const

test('leitor sem violações sérias', async ({ page }) => {
  await openPublicBook(page)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})

for (const [name, path] of PUBLIC_PAGES) {
  test(`${name} sem violações sérias`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await seriousViolations(page)).toEqual([])
  })
}

test('telas da conta sem violações sérias', async ({ page }) => {
  await signInAs(page, 'quill_writer')
  const checks: [string, () => Promise<void>][] = [
    ['My Books', () => page.goto('/library').then(() => undefined)],
    [
      'Editor',
      async () => {
        await page.getByText('My first draft').dblclick()
        await page.waitForURL(/\/editor\//)
      },
    ],
    ['Reader', () => openPublicBook(page)],
    ['Options', () => page.goto('/settings').then(() => undefined)],
    ['Notifications', () => page.goto('/notifications').then(() => undefined)],
  ]
  const found: string[] = []
  for (const [name, open] of checks) {
    await open()
    await expect(page.locator('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    found.push(...(await seriousViolations(page)).map((line) => `${name}: ${line}`))
  }
  expect(found).toEqual([])
})
