// Rede social: comentários predefinidos, perfil, privacidade e paginação (documento 02, §3.7).
import { z } from 'zod'
import { sanitizeLine } from '../book/schemas.ts'

/** Comentários predefinidos (documento 03, §6, F8). O id é a posição na lista e nunca muda. */
export const COMMENT_PRESETS: readonly string[] = [
  'Amazing!',
  'Beautiful art!',
  'Great animation!',
  'Love the story!',
  'Made me smile',
  'Made me cry',
  'So creative!',
  'Spooky!',
  "Can't stop watching",
  'More, please!',
  'Inspiring',
  'Masterpiece!',
]

export const presetIdSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(COMMENT_PRESETS.length - 1)

/** Avatares pré-definidos (não há upload, documento 02, B10). */
export const AVATAR_COUNT = 12
export const BIO_MAX = 160

export const profileSchema = z
  .object({
    bio: z
      .string()
      .max(BIO_MAX * 4)
      .transform(sanitizeLine)
      .refine((value) => value.length <= BIO_MAX, `Bios can have at most ${BIO_MAX} characters.`)
      .optional(),
    avatarId: z
      .number()
      .int()
      .min(0)
      .max(AVATAR_COUNT - 1)
      .optional(),
  })
  .strict()

export const FRIEND_REQUEST_POLICIES = ['EVERYONE', 'FRIENDS_OF_FRIENDS', 'NOBODY'] as const
export type FriendRequestPolicy = (typeof FRIEND_REQUEST_POLICIES)[number]

export const privacySchema = z
  .object({
    searchable: z.boolean().optional(),
    showFavorites: z.boolean().optional(),
    friendRequestPolicy: z.enum(FRIEND_REQUEST_POLICIES).optional(),
  })
  .strict()

export const PAGE_LIMIT_MAX = 50
export const pageQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(20),
  })
  .strict()

export const FEED_TABS = ['new', 'trending', 'friends'] as const
export type FeedTab = (typeof FEED_TABS)[number]
export const feedQuerySchema = pageQuerySchema.extend({ tab: z.enum(FEED_TABS).default('new') }).strict()

export const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(64) }).strict()

export const friendRequestSchema = z.object({ username: z.string().min(1).max(16) }).strict()

export const notificationsReadSchema = z.object({ ids: z.array(z.uuid()).max(100).optional() }).strict()

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
