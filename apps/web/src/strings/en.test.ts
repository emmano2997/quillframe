import { describe, expect, it } from 'vitest'
import { en, format } from './en.ts'

describe('format', () => {
  it('troca os marcadores pelos valores', () => {
    expect(format(en.viewer.pageIndicator, { page: 3, total: 50 })).toBe('Page 3 of 50')
  })

  it('mantém marcadores sem valor', () => {
    expect(format('Hello {name}', {})).toBe('Hello {name}')
  })
})
