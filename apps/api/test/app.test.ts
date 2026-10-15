import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const app = buildApp(loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' }))
afterAll(() => app.close())

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok' })
  })
})

describe('loadConfig', () => {
  it('recusa configuração sem APP_ORIGIN', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/APP_ORIGIN/)
  })

  it('recusa porta inválida', () => {
    expect(() => loadConfig({ APP_ORIGIN: 'http://localhost:5173', API_PORT: '99999' })).toThrow(/API_PORT/)
  })
})
