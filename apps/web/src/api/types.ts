// Formas devolvidas pela API (documento 02, §4).
import type { FriendRequestPolicy, Visibility } from '@quillframe/shared'

export type Role = 'USER' | 'MODERATOR' | 'ADMIN'
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'PENDING_DELETION'
export type ReviewState = 'NONE' | 'PENDING_REVIEW' | 'HIDDEN' | 'REMOVED'

export interface Privacy {
  searchable: boolean
  showFavorites: boolean
  friendRequestPolicy: FriendRequestPolicy
  locked: boolean
}

export interface Me {
  id: string
  username: string
  email: string
  emailVerified: boolean
  role: Role
  status: AccountStatus
  suspendedUntil: string | null
  deletionRequestedAt: string | null
  avatarId: number
  bio: string
  hasPassword: boolean
  mfaEnabled: boolean
  minor: boolean
  privacy: Privacy
  createdAt: string
}

export interface AppConfig {
  turnstileSiteKey: string | null
  oauth: { google: boolean; discord: boolean }
  termsVersion: string
}

export interface Author {
  username: string
  avatarId: number
}

export interface BookSummary {
  id: string
  title: string
  author: Author
  status: 'DRAFT' | 'SIGNED'
  visibility: Visibility
  reviewState: ReviewState
  pageCount: number
  likeCount: number
  favoriteCount: number
  allowCopies: boolean
  signedAt: string | null
  publishedAt: string | null
  updatedAt: string
  createdAt: string
}

export interface BookModeration {
  actionId: string
  type: string
  guideline: string | null
  reason: string
  automated: boolean
  createdAt: string
  appealStatus: 'OPEN' | 'UPHELD' | 'REVERSED' | null
}

export interface BookDetail extends BookSummary {
  allowComments: boolean
  version?: number
  pages: string[]
  viewer: {
    isOwner: boolean
    liked: boolean
    favorited: boolean
    copies: { id: string; generation: number }[]
  }
  moderation: BookModeration | null
}

export interface Paged<T> {
  items: T[]
  nextCursor: string | null
}

export interface CopyItem {
  id: string
  generation: number
  createdAt: string
  book: BookSummary | null
}

export interface CommentPreset {
  presetId: number
  label: string
  count: number
  users: string[]
  mine: string | null
  ids?: { id: string; username: string }[]
}

export interface Profile {
  id: string
  username: string
  avatarId: number
  bio: string
  memberSince: string
  bookCount: number
  relation: 'self' | 'none' | 'friends' | 'request_sent' | 'request_received'
  showsFavorites: boolean
}

export interface UserCard {
  username: string
  avatarId: number
  since?: string | null
  bio?: string
}

export interface FriendRequestCard {
  userId: string
  username: string
  avatarId: number
  createdAt: string
}

export interface NotificationItem {
  id: string
  type: string
  payload: Record<string, string | number | boolean | null>
  read: boolean
  createdAt: string
}

export interface SessionItem {
  id: string
  current: boolean
  device: string
  ip: string | null
  createdAt: string
  lastSeenAt: string
}

export interface SecurityEvent {
  id: string
  event: string
  device: string
  ip: string | null
  createdAt: string
}

export interface ModerationItem {
  id: string
  type: string
  targetType: 'BOOK' | 'USER'
  bookId: string | null
  title: string | null
  guideline: string | null
  reason: string
  automated: boolean
  createdAt: string
  strikeExpiresAt: string | null
  canAppeal: boolean
  appeal: {
    status: 'OPEN' | 'UPHELD' | 'REVERSED'
    message: string
    decisionReason: string | null
    createdAt: string
    decidedAt: string | null
  } | null
}

export interface QueueEntry {
  targetType: 'BOOK' | 'USER'
  targetId: string
  priority: number
  reasons: string[]
  reportCount: number
  oldest: string
  label: string
  owner: string | null
  reviewState: string | null
}

export interface TargetDetail extends Omit<QueueEntry, 'priority' | 'reasons' | 'reportCount' | 'oldest'> {
  subject: {
    id: string
    username: string
    status: AccountStatus
    role: Role
    suspendedUntil: string | null
    memberSince: string
    activeStrikes: number
  }
  reports: {
    id: string
    reason: string
    pageIndex: number | null
    details: string | null
    status: string
    reporter: string
    createdAt: string
  }[]
  history: {
    id: string
    type: string
    targetType: string
    guideline: string | null
    reason: string
    automated: boolean
    createdAt: string
  }[]
}

export interface AppealItem {
  id: string
  status: 'OPEN' | 'UPHELD' | 'REVERSED'
  message: string
  username: string
  createdAt: string
  decidedAt: string | null
  decisionReason: string | null
  action: {
    id: string
    type: string
    targetType: 'BOOK' | 'USER'
    targetId: string
    guideline: string | null
    reason: string
    automated: boolean
    createdAt: string
    decidedByMe: boolean
  }
}

export interface ConcernItem {
  id: string
  name: string
  email: string
  relation: string
  contentUrl: string
  description: string
  status: 'OPEN' | 'ACTIONED' | 'DISMISSED'
  confirmedAt: string
}
