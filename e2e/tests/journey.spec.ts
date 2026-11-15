// O caminho completo do documento 03, §15: cadastro → verificação (e-mail no Mailpit) → escrever →
// autosave → recarregar → assinar → publicar → like → denunciar → moderador remove → notificação →
// recurso → moderador reverte. Também cobre o login com 2FA (o moderador).
import { expect, signIn, signInAs, test, uniqueAccount } from '../support/app.ts'
import { linkFromEmail } from '../support/mailpit.ts'

test('do cadastro ao recurso aceito', async ({ page, newPage }) => {
  test.setTimeout(120_000)
  const writer = uniqueAccount('author')
  const title = `E2E ${writer.username.slice(-6)}`
  const text = 'Hello from the browser test.'
  let bookPath = ''

  await test.step('cadastro', async () => {
    await page.goto('/register')
    await page.getByLabel('Username').fill(writer.username)
    await page.getByLabel('Email').fill(writer.email)
    await page.getByLabel('Password', { exact: true }).fill(writer.password)
    await page.getByLabel('Date of birth').fill('1998-03-20')
    await page.getByLabel('I agree to the').check()
    await page.getByLabel('I agree to follow the').check()
    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByText('Check your email to continue.')).toBeVisible()
  })

  await test.step('verificação pelo link do e-mail', async () => {
    await page.goto(await linkFromEmail(writer.email, '/verify-email'))
    await expect(page.getByText('Your email is verified. You can now share books.')).toBeVisible()
    // O token sai da barra de endereço assim que é lido
    expect(page.url()).not.toContain('token=')
    await signIn(page, writer.email, writer.password)
  })

  await test.step('escrever, autosave e recarregar', async () => {
    await page.goto('/library')
    await page.getByRole('button', { name: 'Create New' }).click()
    await expect(page).toHaveURL(/\/editor\//)
    const input = page.getByLabel('Text of page 1')
    await input.focus()
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/books/') && response.request().method() !== 'GET' && response.ok(),
    )
    await page.keyboard.type(text)
    await saved
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Text of page 1')).toHaveValue(text)
  })

  await test.step('assinar e publicar', async () => {
    await page.getByRole('button', { name: 'Sign', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title', { exact: true }).fill(title)
    await dialog.getByLabel('Publish to Community').check()
    await dialog.getByLabel('This book follows the').check()
    await dialog.getByRole('button', { name: 'Sign and Close' }).click()
    await expect(page).toHaveURL(/\/book\//)
    await expect(page.getByText('Book signed!')).toBeVisible()
    bookPath = new URL(page.url()).pathname
  })

  await test.step('outra pessoa curte e denuncia', async () => {
    const reader = await newPage()
    await signInAs(reader, 'quill_reader')
    await reader.goto(bookPath)
    await reader.getByRole('button', { name: 'Like 0' }).click()
    await expect(reader.getByRole('button', { name: 'Like 1' })).toBeVisible()
    await reader.getByRole('button', { name: 'Report', exact: true }).click()
    const dialog = reader.getByRole('dialog')
    await dialog.getByLabel('Spam or scam').check()
    await dialog.getByLabel('Details (optional)').fill('Test report from the browser test.')
    await dialog.getByRole('button', { name: 'Send Report' }).click()
    await expect(reader.getByText('Thanks for your report. Our moderators will review it.')).toBeVisible()
  })

  const moderator = await newPage()
  await test.step('o moderador entra com 2FA e remove o livro', async () => {
    await signInAs(moderator, 'quill_mod')
    await moderator.goto('/mod')
    // Cada linha da fila é um link para o caso
    await moderator.getByRole('link', { name: new RegExp(title) }).click()
    await moderator.getByLabel('Action', { exact: true }).selectOption({ label: 'Remove' })
    await moderator.getByLabel('Rule broken').selectOption({ index: 1 })
    await moderator.getByLabel('Reason', { exact: true }).fill('Removed by the browser test.')
    await moderator.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(moderator.getByText('Decision recorded.')).toBeVisible()
  })

  await test.step('o autor é avisado e recorre', async () => {
    await page.goto('/notifications')
    await expect(page.getByText(`Your book "${title}" was removed.`)).toBeVisible()
    await page.goto(bookPath)
    await expect(page.getByText('Your book was removed by the moderation team.')).toBeVisible()
    await page.getByRole('button', { name: 'Appeal', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Why should we change this decision?').fill('This was only a test book.')
    await dialog.getByRole('button', { name: 'Send Appeal' }).click()
    await expect(page.getByText('Appeal sent.')).toBeVisible()
    await expect(page.getByText('Appeal pending')).toBeVisible()
  })

  await test.step('o moderador reverte e o autor fica sabendo', async () => {
    await moderator.goto('/mod')
    await moderator.getByRole('tab', { name: 'Appeals' }).click()
    const appeal = moderator.locator('section').filter({ hasText: `${writer.username} · Appeal pending` })
    await appeal.getByLabel('Reason', { exact: true }).fill('Reversed by the browser test.')
    await appeal.getByRole('button', { name: 'Reverse Decision' }).click()
    await expect(moderator.getByText('Decision recorded.')).toBeVisible()

    await page.goto('/notifications')
    await expect(page.getByText('Your appeal was accepted: the decision was reversed.')).toBeVisible()
    await page.goto(bookPath)
    await expect(page.getByText('Your book was removed by the moderation team.')).toBeHidden()
  })
})
