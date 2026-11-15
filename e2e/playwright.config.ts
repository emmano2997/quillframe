// Testes de ponta a ponta (documento 03, §15). Rodam um de cada vez: os fluxos dividem o mesmo banco
// e o 2FA não aceita o mesmo código duas vezes.
import { defineConfig, devices } from '@playwright/test'
import { API_ENV, BASE_URL, PORT, ROOT } from './support/env.ts'

const CI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node apps/api/src/server.ts',
    cwd: ROOT,
    env: API_ENV,
    // A página inicial vem do disco: responde antes de o banco estar pronto
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
