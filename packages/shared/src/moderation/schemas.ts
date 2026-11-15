// Denúncias, ações de moderação e recursos (documento 02, §6).
import { z } from 'zod'
import { emailSchema } from '../account/schemas.ts'
import { sanitizeLine } from '../book/schemas.ts'

export const REPORT_TARGETS = ['BOOK', 'USER'] as const
export type ReportTarget = (typeof REPORT_TARGETS)[number]

export interface ReportReasonInfo {
  /** Texto na interface */
  label: string
  /** 1 é a mais urgente (documento 02, §6.3) */
  priority: number
  /** Denúncias de contas confiáveis que ocultam o livro até a revisão (§6.4) */
  autoHideAt: number
  targets: readonly ReportTarget[]
}

export const REPORT_REASONS = {
  SEXUAL_CONTENT: { label: 'Sexual content', priority: 2, autoHideAt: 2, targets: ['BOOK', 'USER'] },
  MINOR_SAFETY: { label: 'Child safety', priority: 1, autoHideAt: 1, targets: ['BOOK', 'USER'] },
  HATE: { label: 'Hate speech', priority: 3, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  HARASSMENT: { label: 'Harassment or bullying', priority: 3, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  VIOLENCE: { label: 'Violence or threats', priority: 3, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  SELF_HARM: { label: 'Self-harm or suicide', priority: 2, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  PERSONAL_INFO: { label: 'Personal information', priority: 3, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  SPAM: { label: 'Spam or scam', priority: 4, autoHideAt: 3, targets: ['BOOK', 'USER'] },
  COPYRIGHT: { label: 'Stolen work', priority: 4, autoHideAt: 3, targets: ['BOOK'] },
  IMPERSONATION: { label: 'Impersonation', priority: 4, autoHideAt: 3, targets: ['USER'] },
  UNDERAGE_USER: { label: 'User under 16', priority: 3, autoHideAt: 3, targets: ['USER'] },
  OTHER: { label: 'Something else', priority: 4, autoHideAt: 3, targets: ['BOOK', 'USER'] },
} as const satisfies Record<string, ReportReasonInfo>

export type ReportReason = keyof typeof REPORT_REASONS
export const REPORT_REASON_KEYS = Object.keys(REPORT_REASONS) as [ReportReason, ...ReportReason[]]

/** Regras das Community Guidelines (documento 03, §9), citadas em toda decisão. */
export const GUIDELINES = {
  '1-sexual-content': 'No sexual content',
  '2-minor-safety': 'Zero tolerance for anything that sexualizes minors',
  '3-respect': 'Be respectful',
  '4-safety': 'Keep it safe',
  '5-privacy': 'Protect privacy',
  '6-honesty': 'Be honest',
  '7-creators': 'Respect creators',
  '8-not-minecraft': 'quillframe is not Minecraft',
  'age-requirement': 'You must be 16 or older',
} as const

export type GuidelineId = keyof typeof GUIDELINES
export const GUIDELINE_IDS = Object.keys(GUIDELINES) as [GuidelineId, ...GuidelineId[]]

export const MOD_ACTION_TYPES = [
  'DISMISS',
  'HIDE',
  'RESTORE',
  'REMOVE',
  'WARN',
  'STRIKE',
  'SUSPEND',
  'BAN',
  'UNBAN',
] as const
export type ModActionType = (typeof MOD_ACTION_TYPES)[number]

export const MODERATION = {
  DETAILS_MAX: 500,
  REASON_MAX: 1000,
  STRIKE_DAYS: 90,
  APPEAL_DAYS: 30,
  /** Conta "confiável" para a ocultação automática: e-mail verificado e esta idade mínima */
  TRUSTED_ACCOUNT_DAYS: 7,
  /** Contas novas ficam fora de "New" e "Trending" (documento 02, §3.4) */
  NEW_ACCOUNT_HOURS: 72,
  BAD_FAITH_WARNING: 5,
  BAD_FAITH_BLOCK: 10,
} as const

const longText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((value) => value.normalize('NFC').trim())
    .refine((value) => value.length <= max, `Use at most ${max} characters.`)

export const reportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    reason: z.enum(REPORT_REASON_KEYS),
    pageIndex: z.number().int().min(0).max(999).optional(),
    details: longText(MODERATION.DETAILS_MAX).optional(),
  })
  .strict()
  .refine((value) => (REPORT_REASONS[value.reason].targets as readonly string[]).includes(value.targetType), {
    path: ['reason'],
    message: "This reason doesn't apply here.",
  })

export const modActionSchema = z
  .object({
    targetType: z.enum(REPORT_TARGETS),
    targetId: z.uuid(),
    type: z.enum(MOD_ACTION_TYPES),
    guideline: z.enum(GUIDELINE_IDS).optional(),
    reason: longText(MODERATION.REASON_MAX).refine((value) => value.length >= 3, 'Enter a reason.'),
    reportIds: z.array(z.uuid()).max(200).optional(),
    /** Só em SUSPEND */
    days: z.number().int().min(1).max(365).optional(),
    /** Só em DISMISS: as denúncias foram de má-fé (documento 02, §6.8) */
    badFaith: z.boolean().optional(),
  })
  .strict()
  .refine((value) => ['DISMISS', 'RESTORE', 'UNBAN'].includes(value.type) || value.guideline !== undefined, {
    path: ['guideline'],
    message: 'Choose the rule that was broken.',
  })
  .refine((value) => value.type !== 'SUSPEND' || value.days !== undefined, {
    path: ['days'],
    message: 'Enter how many days.',
  })

export const appealSchema = z
  .object({
    actionId: z.uuid(),
    message: longText(MODERATION.REASON_MAX).refine((value) => value.length >= 10, 'Tell us a bit more.'),
  })
  .strict()

export const appealDecisionSchema = z
  .object({
    status: z.enum(['UPHELD', 'REVERSED']),
    reason: longText(MODERATION.REASON_MAX).refine((value) => value.length >= 3, 'Enter a reason.'),
  })
  .strict()

export const CONCERN_RELATIONS = {
  victim: 'Victim',
  guardian: 'Parent or guardian',
  prosecutor: 'Public prosecutor',
  organization: 'Child protection organization',
  other: 'Other',
} as const
export type ConcernRelation = keyof typeof CONCERN_RELATIONS

export const concernSchema = z
  .object({
    name: z
      .string()
      .max(480)
      .transform(sanitizeLine)
      .refine((value) => value.length >= 2 && value.length <= 120, 'Enter your name.'),
    email: emailSchema,
    relation: z.enum(Object.keys(CONCERN_RELATIONS) as [ConcernRelation, ...ConcernRelation[]]),
    contentUrl: z.string().trim().min(1, 'Enter a link to the content.').max(300, 'This link is too long.'),
    description: longText(2000).refine((value) => value.length >= 10, 'Tell us what happened.'),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict()

export const roleSchema = z.object({ role: z.enum(['USER', 'MODERATOR', 'ADMIN']) }).strict()

export const filterTermSchema = z
  .object({ term: z.string().trim().min(2).max(64), severity: z.enum(['HIGH', 'MEDIUM']) })
  .strict()
