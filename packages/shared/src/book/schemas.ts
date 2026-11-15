// Limpeza e validação de páginas e títulos, iguais no editor e no servidor (documento 02, §3.3 e §3.4).
import { z } from 'zod'
import { LIMITS } from '../constants.ts'

// Caracteres de direção de texto, usados para disfarçar conteúdo (U+202A–U+202E, U+2066–U+2069)
const BIDI = /[‪-‮⁦-⁩]/g
// Controles C0 e C1, menos o "\n"
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g

/**
 * Limpa o texto de uma página: "\r\n" vira "\n"; somem os caracteres de controle (menos "\n") e os
 * de direção de texto. Todos os códigos "§" ficam como estão, inclusive os inválidos.
 */
export function sanitizePageContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '').replace(BIDI, '')
}

/** Títulos, bios e outros textos de uma linha: NFC, sem controles nem direção de texto, com trim. */
export function sanitizeLine(text: string): string {
  return text.normalize('NFC').replace(CONTROL, '').replace(BIDI, '').trim()
}

/** Corta sem partir um par substituto (emoji) ao meio. */
export function truncateUtf16(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.charCodeAt(max - 1)
  return text.slice(0, cut >= 0xd800 && cut <= 0xdbff ? max - 1 : max)
}

/** Página já limpa, com até 1024 unidades UTF-16 (como o Java conta). */
export const pageContentSchema = z
  .string()
  .max(LIMITS.pageChars * 4)
  .transform(sanitizePageContent)
  .refine(
    (value) => value.length <= LIMITS.pageChars,
    `A page can have at most ${LIMITS.pageChars} characters.`,
  )

/** Título de rascunho: pode ficar vazio. */
export const draftTitleSchema = z
  .string()
  .max(LIMITS.titleChars * 4)
  .transform(sanitizeLine)
  .refine(
    (value) => value.length <= LIMITS.titleChars,
    `Titles can have at most ${LIMITS.titleChars} characters.`,
  )

/** Título de livro assinado: de 1 a 64. */
export const signedTitleSchema = draftTitleSchema.refine((value) => value.length >= 1, 'Enter a title.')

export const VISIBILITIES = ['PRIVATE', 'FRIENDS', 'PUBLIC'] as const
export type Visibility = (typeof VISIBILITIES)[number]
export const visibilitySchema = z.enum(VISIBILITIES)

const baseVersion = z.number().int().min(0)
const pageIndex = z
  .number()
  .int()
  .min(0)
  .max(LIMITS.sitePages - 1)

export const savePageSchema = z.object({ content: pageContentSchema, baseVersion }).strict()
export const insertPageSchema = z
  .object({ index: pageIndex, baseVersion, content: pageContentSchema.optional() })
  .strict()
export const removePageSchema = z.object({ baseVersion }).strict()

/** Substitui todas as páginas de um rascunho ("Paste Book", "Clear Book", importar por cima). */
export const replacePagesSchema = z
  .object({ pages: z.array(pageContentSchema).min(1).max(LIMITS.sitePages), baseVersion })
  .strict()

export const updateBookSchema = z
  .object({
    title: draftTitleSchema.optional(),
    allowCopies: z.boolean().optional(),
    allowComments: z.boolean().optional(),
  })
  .strict()

export const signBookSchema = z
  .object({
    title: signedTitleSchema,
    visibility: visibilitySchema,
    acceptGuidelines: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.visibility === 'PRIVATE' || value.acceptGuidelines === true, {
    path: ['acceptGuidelines'],
    message: 'You must agree to the Community Guidelines to share a book.',
  })

export const changeVisibilitySchema = z
  .object({ visibility: visibilitySchema, acceptGuidelines: z.boolean().optional() })
  .strict()
  .refine((value) => value.visibility === 'PRIVATE' || value.acceptGuidelines === true, {
    path: ['acceptGuidelines'],
    message: 'You must agree to the Community Guidelines to share a book.',
  })

/** Importação: o texto do arquivo .stendhal, até 2 MB. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const importBookSchema = z.object({ content: z.string().min(1).max(IMPORT_MAX_BYTES) }).strict()

export const copyBookSchema = z.object({ fromCopyId: z.uuid().optional() }).strict()

/** Nome de arquivo seguro para o Content-Disposition: só [a-z0-9_-]. */
export function exportFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return `${slug || 'book'}.stendhal`
}
