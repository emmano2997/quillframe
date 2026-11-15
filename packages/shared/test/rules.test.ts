// Regras compartilhadas das fases 2 a 4: limpeza de páginas, schemas e filtro de conteúdo.
import { describe, expect, it } from 'vitest'
import {
  ContentFilter,
  exportFileName,
  modActionSchema,
  normalizeForFilter,
  pageContentSchema,
  reportSchema,
  safeReturnTo,
  sanitizeLine,
  sanitizePageContent,
  signBookSchema,
  signedTitleSchema,
  truncateUtf16,
} from '../src/index.ts'

describe('sanitizePageContent (documento 02, §3.3)', () => {
  it('normaliza quebras de linha e tira controles e caracteres de direção de texto', () => {
    expect(sanitizePageContent('a\r\nb\rc\u0000\u0007‮d⁦e')).toBe('a\nb\ncde')
  })

  it('mantém todos os códigos §, inclusive os inválidos', () => {
    const art = '§c§lred§r§ §§x§\n§'
    expect(sanitizePageContent(art)).toBe(art)
  })

  it('conta unidades UTF-16, como o Java', () => {
    expect(pageContentSchema.safeParse('a'.repeat(1024)).success).toBe(true)
    expect(pageContentSchema.safeParse('a'.repeat(1025)).success).toBe(false)
    expect(pageContentSchema.safeParse('💔'.repeat(512)).success).toBe(true)
    expect(pageContentSchema.safeParse('💔'.repeat(513)).success).toBe(false)
  })
})

describe('títulos', () => {
  it('passam por trim e NFC e não aceitam controles', () => {
    expect(sanitizeLine('  Café\n ')).toBe('Café')
    expect(signedTitleSchema.safeParse('   ').success).toBe(false)
    expect(signedTitleSchema.parse(' Two Birds ')).toBe('Two Birds')
  })

  it('corta sem partir um emoji ao meio', () => {
    expect(truncateUtf16('ab💔', 3)).toBe('ab')
    expect(truncateUtf16('ab💔', 4)).toBe('ab💔')
  })

  it('compartilhar exige aceitar as diretrizes', () => {
    expect(signBookSchema.safeParse({ title: 'T', visibility: 'PRIVATE' }).success).toBe(true)
    expect(signBookSchema.safeParse({ title: 'T', visibility: 'PUBLIC' }).success).toBe(false)
    expect(
      signBookSchema.safeParse({ title: 'T', visibility: 'PUBLIC', acceptGuidelines: true }).success,
    ).toBe(true)
    expect(signBookSchema.safeParse({ title: 'T', visibility: 'PRIVATE', ownerId: 'x' }).success).toBe(false)
  })

  it('o nome do arquivo exportado só tem [a-z0-9_]', () => {
    expect(exportFileName('Olá, Mundo! "x"')).toBe('ola_mundo_x.stendhal')
    expect(exportFileName('💔')).toBe('book.stendhal')
    expect(exportFileName('../../etc/passwd')).toBe('etc_passwd.stendhal')
  })
})

describe('safeReturnTo (documento 02, §5.10)', () => {
  it.each(['/library', '/book/123?page=2'])('aceita o caminho interno %s', (path) => {
    expect(safeReturnTo(path)).toBe(path)
  })

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '', null])(
    'recusa %s',
    (path) => {
      expect(safeReturnTo(path)).toBe('/')
    },
  )
})

describe('denúncias e ações', () => {
  const id = '2f0c1c3a-7f1e-4d2a-9a55-0d1f1f6f0a11'

  it('cada motivo vale para livros, usuários ou os dois', () => {
    expect(reportSchema.safeParse({ targetType: 'BOOK', targetId: id, reason: 'COPYRIGHT' }).success).toBe(
      true,
    )
    expect(reportSchema.safeParse({ targetType: 'USER', targetId: id, reason: 'COPYRIGHT' }).success).toBe(
      false,
    )
    expect(
      reportSchema.safeParse({ targetType: 'USER', targetId: id, reason: 'UNDERAGE_USER' }).success,
    ).toBe(true)
    expect(reportSchema.safeParse({ targetType: 'BOOK', targetId: 'x', reason: 'SPAM' }).success).toBe(false)
  })

  it('toda sanção exige a regra violada', () => {
    const base = { targetType: 'BOOK', targetId: id, reason: 'Because.' }
    expect(modActionSchema.safeParse({ ...base, type: 'REMOVE' }).success).toBe(false)
    expect(modActionSchema.safeParse({ ...base, type: 'REMOVE', guideline: '3-respect' }).success).toBe(true)
    expect(modActionSchema.safeParse({ ...base, type: 'DISMISS' }).success).toBe(true)
    expect(modActionSchema.safeParse({ ...base, type: 'SUSPEND', guideline: '3-respect' }).success).toBe(
      false,
    )
    expect(
      modActionSchema.safeParse({ ...base, type: 'SUSPEND', guideline: '3-respect', days: 3 }).success,
    ).toBe(true)
  })
})

describe('filtro de conteúdo (documento 02, §6.2)', () => {
  const filter = new ContentFilter([
    { term: 'badword', severity: 'HIGH' },
    { term: 'mild', severity: 'MEDIUM' },
    { term: 'two words', severity: 'MEDIUM' },
  ])

  it('normaliza: códigos §, acentos, leetspeak, letras soltas e repetidas', () => {
    expect(normalizeForFilter('§cB§l4d')).toBe(' bad ')
    expect(normalizeForFilter('Olá, MUNDO!')).toBe(' ola mundo ')
    expect(normalizeForFilter('b a d w o r d')).toBe(' badword ')
    expect(normalizeForFilter('baaadwooord')).toBe(' badword ')
    expect(normalizeForFilter('b​ad')).toBe(' bad ')
  })

  it.each(['badword', 'B4DW0RD', '§cbad§lword', 'b.a.d.w.o.r.d', 'baaadword', 'bádwörd', 'a badword here'])(
    'encontra "%s"',
    (text) => {
      expect(filter.worst([text])).toBe('HIGH')
    },
  )

  it('só casa palavras inteiras: nada de falso positivo dentro de outra palavra', () => {
    expect(filter.worst(['notbadwordish'])).toBeNull()
    expect(filter.worst(['mildew is a fungus'])).toBeNull()
    expect(filter.worst(['a mild day'])).toBe('MEDIUM')
  })

  it('encontra frases e devolve a gravidade mais alta', () => {
    expect(filter.scan('these TWO   words').map((hit) => hit.term)).toEqual(['two words'])
    expect(filter.worst(['mild', 'badword'])).toBe('HIGH')
    expect(filter.worst(['a clean page of ASCII art ░▒▓'])).toBeNull()
  })

  it('roda em tempo linear mesmo com entrada adversária', () => {
    const started = performance.now()
    filter.scan('b'.repeat(200_000) + 'a d w o r '.repeat(20_000))
    expect(performance.now() - started).toBeLessThan(2_000)
  })
})
