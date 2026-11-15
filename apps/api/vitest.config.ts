import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    // Migrations e limpeza do banco de teste, uma vez por execução
    globalSetup: ['test/global-setup.ts'],
    // Os jobs agem no banco inteiro, então os arquivos da API rodam um de cada vez
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
