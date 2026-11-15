// Notifications (documento 03, §7.4): pedidos de amizade, likes e comentários agrupados, decisões
// de moderação e alertas de segurança.
import { GUIDELINES, type GuidelineId } from '@quillframe/shared'
import { Link } from 'react-router'
import { api, errorMessage } from '../api/client.ts'
import type { NotificationItem } from '../api/types.ts'
import { Screen, useNotifications } from '../app/Screen.tsx'
import { queryClient } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { cx, formatRelative, QueryState, ui } from '../ui/kit.tsx'

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Texto e destino de cada tipo de notificação. O conteúdo é sempre texto: nada vira HTML. */
function describe(item: NotificationItem): { message: string; to: string | null; detail?: string } {
  const p = item.payload
  const count = typeof p['count'] === 'number' ? p['count'] : 1
  const book = typeof p['bookId'] === 'string' ? `/book/${p['bookId']}` : null
  const user = text(p['username'])
  const title = text(p['title'])
  switch (item.type) {
    case 'FRIEND_REQUEST':
      return { message: format(en.notifications.friendRequest, { username: user }), to: '/friends' }
    case 'FRIEND_ACCEPTED':
      return { message: format(en.notifications.friendAccepted, { username: user }), to: `/u/${user}` }
    case 'BOOK_LIKED':
      return {
        message:
          count > 1
            ? format(en.notifications.likedMany, { count, title })
            : format(en.notifications.liked, { username: user, title }),
        to: book,
      }
    case 'BOOK_COMMENTED':
      return {
        message:
          count > 1
            ? format(en.notifications.commentedMany, { count, title })
            : format(en.notifications.commented, { username: user, title }),
        to: book,
      }
    case 'MOD_DECISION': {
      const what = title ? format(en.notifications.modBook, { title }) : en.notifications.modAccount
      const action =
        en.notifications.modActions[text(p['type']) as keyof typeof en.notifications.modActions] ?? ''
      const rule = text(p['guideline'])
      return {
        message: `${what} ${action}`.trim(),
        to: '/settings/moderation',
        detail: [
          rule ? format(en.moderation.rule, { rule: GUIDELINES[rule as GuidelineId] ?? rule }) : '',
          format(en.moderation.reason, { reason: text(p['reason']) }),
          p['automated'] ? en.moderation.automated : en.moderation.byModerator,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    case 'APPEAL_DECIDED':
      return {
        message: p['status'] === 'REVERSED' ? en.notifications.appealReversed : en.notifications.appealUpheld,
        to: '/settings/moderation',
        detail: text(p['reason']),
      }
    case 'REPORT_RESOLVED':
      return {
        message:
          p['outcome'] === 'actioned' ? en.notifications.reportActioned : en.notifications.reportDismissed,
        to: null,
      }
    case 'REPORT_ABUSE_WARNING':
      return { message: en.notifications.reportAbuse, to: '/guidelines' }
    case 'SECURITY_ALERT':
      return {
        message: format(en.notifications.newSignIn, { device: text(p['device']) }),
        to: '/settings/security',
      }
    case 'PROTECTIONS_LIFTED':
      return { message: en.notifications.protectionsLifted, to: '/settings/privacy' }
    default:
      return { message: en.notifications.generic, to: null }
  }
}

export default function NotificationsScreen() {
  const query = useNotifications(true)
  const items = query.data?.items ?? []

  const markRead = (ids?: string[]) =>
    api
      .post('/api/me/notifications/read', ids ? { ids } : {})
      .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
      .catch((cause: unknown) => toast(errorMessage(cause), 'error'))

  return (
    <Screen title={en.nav.notifications} back="/" wide>
      <div className={ui.row}>
        <Button disabled={(query.data?.unread ?? 0) === 0} onClick={() => void markRead()}>
          {en.notifications.markAll}
        </Button>
      </div>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={items.length === 0}
        emptyText={en.notifications.empty}
      >
        <ul className={ui.list}>
          {items.map((item) => {
            const { message, to, detail } = describe(item)
            const body = (
              <div className={ui.itemBody}>
                <p className={cx(ui.text, item.read && ui.muted)}>
                  {!item.read && <span className={ui.badgeAlert}>● </span>}
                  {message}
                </p>
                {detail && <p className={ui.itemMeta}>{detail}</p>}
                <p className={ui.itemMeta}>{formatRelative(item.createdAt)}</p>
              </div>
            )
            return (
              <li key={item.id}>
                {to ? (
                  <Link className={ui.item} to={to} onClick={() => !item.read && void markRead([item.id])}>
                    {body}
                  </Link>
                ) : (
                  <div className={ui.item}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      </QueryState>
    </Screen>
  )
}
