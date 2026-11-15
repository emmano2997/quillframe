import { describe, expect, it } from 'vitest'
import {
  ageOn,
  birthDateSchema,
  emailSchema,
  isReservedUsername,
  loginSchema,
  passwordLength,
  passwordSchema,
  registerSchema,
  usernameSchema,
} from '../src/index.ts'

const today = () => new Date('2026-10-17T12:00:00Z')

describe('usernameSchema', () => {
  it.each(['Notch_fan', 'abc', 'a_b_c_d_e_f_g_h1'])('aceita %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(true)
  })

  it.each(['ab', 'a'.repeat(17), 'com espaço', 'аdmin_x', 'josé', 'a-b'])('recusa %s', (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(false)
  })

  it('recusa nomes reservados e variações', () => {
    for (const name of ['admin', 'ADMIN', 'Admin_1', 'moderator99', 'quillframe', 'jeb_', 'Minecraft_']) {
      expect(isReservedUsername(name), name).toBe(true)
    }
    expect(isReservedUsername('model')).toBe(false)
    expect(isReservedUsername('helper')).toBe(false)
  })
})

describe('emailSchema', () => {
  it('normaliza para minúsculas e tira espaços', () => {
    expect(emailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com')
  })

  it('recusa endereços inválidos', () => {
    expect(emailSchema.safeParse('alice').success).toBe(false)
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@x.com`).success).toBe(false)
  })
})

describe('passwordSchema', () => {
  it('exige 15 a 128 code points depois do NFKC', () => {
    expect(passwordSchema.safeParse('a'.repeat(14)).success).toBe(false)
    expect(passwordSchema.safeParse('a'.repeat(15)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false)
  })

  it('aceita frases com espaço, acento e emoji, sem regra de composição', () => {
    expect(passwordSchema.safeParse('my cat writes books at night').success).toBe(true)
    expect(passwordSchema.safeParse('minha senha é 💔💔💔💔').success).toBe(true)
  })

  it('conta emoji como um caractere e normaliza acentos compostos', () => {
    expect(passwordLength('💔')).toBe(1)
    expect(passwordLength('é')).toBe(1)
  })
})

describe('data de nascimento', () => {
  const schema = birthDateSchema(today)

  it('calcula a idade pelo aniversário', () => {
    expect(ageOn(new Date('2010-10-18T00:00:00Z'), today())).toBe(15)
    expect(ageOn(new Date('2010-10-17T00:00:00Z'), today())).toBe(16)
  })

  it('exige 16 anos completos', () => {
    expect(schema.safeParse('2010-10-17').success).toBe(true)
    expect(schema.safeParse('2010-10-18').success).toBe(false)
  })

  it('recusa datas inexistentes e no futuro', () => {
    expect(schema.safeParse('2000-02-30').success).toBe(false)
    expect(schema.safeParse('17/10/2000').success).toBe(false)
    expect(schema.safeParse('2027-01-01').success).toBe(false)
  })
})

describe('registerSchema', () => {
  const valid = {
    username: 'Steve_writes',
    email: 'steve@example.com',
    password: 'my cat writes books at night',
    birthDate: '2000-01-01',
    acceptTerms: true,
    turnstileToken: 'token',
  }

  it('aceita um cadastro válido', () => {
    expect(registerSchema(today).safeParse(valid).success).toBe(true)
  })

  it('recusa campos desconhecidos (mass assignment)', () => {
    expect(registerSchema(today).safeParse({ ...valid, role: 'ADMIN' }).success).toBe(false)
  })

  it('exige aceitar os termos', () => {
    expect(registerSchema(today).safeParse({ ...valid, acceptTerms: false }).success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('não aplica a política de senha no login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'curta' }).success).toBe(true)
  })
})
