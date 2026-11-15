import { afterAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { TEST_ENV, testApp } from './helpers.ts'

const app = await testApp()
afterAll(() => app.close())

describe('GET /api/health', () => {
  it('responde ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok' })
  })
})

describe('headers de segurança (documento 02, §5.11)', () => {
  it('envia CSP estrita, HSTS e no-store na API', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    const csp = String(response.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(response.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(response.headers['permissions-policy']).toContain('camera=()')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('erros RFC 9457 (documento 02, §4.1)', () => {
  it('rota inexistente vira problem+json com code', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nada' })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/problem+json')
    expect(response.json()).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('loadConfig', () => {
  it('aceita a configuração de teste', () => {
    const config = loadConfig(TEST_ENV)
    expect(config.passwordPepperCurrent).toBe(1)
    expect(config.passwordPeppers.get(1)).toHaveLength(32)
  })

  it('recusa configuração sem APP_ORIGIN', () => {
    expect(() => loadConfig({ ...TEST_ENV, APP_ORIGIN: undefined })).toThrow(/APP_ORIGIN/)
  })

  it('recusa porta inválida', () => {
    expect(() => loadConfig({ ...TEST_ENV, API_PORT: '99999' })).toThrow(/API_PORT/)
  })

  it('recusa segredos com menos de 32 bytes', () => {
    const short = Buffer.alloc(31).toString('base64url')
    expect(() => loadConfig({ ...TEST_ENV, CSRF_SECRET: short })).toThrow(/CSRF_SECRET/)
    expect(() => loadConfig({ ...TEST_ENV, PASSWORD_PEPPER_V1: short })).toThrow(/PASSWORD_PEPPER_V1/)
  })

  it('exige o pepper da versão atual', () => {
    expect(() => loadConfig({ ...TEST_ENV, PASSWORD_PEPPER_CURRENT: '2' })).toThrow(/PASSWORD_PEPPER_V2/)
  })
})

describe('páginas com token no fragmento', () => {
  it('não enviam Referer para fora', async () => {
    const response = await app.inject({ method: 'GET', url: '/reset-password' })
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    const other = await app.inject({ method: 'GET', url: '/api/health' })
    expect(other.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })
})
