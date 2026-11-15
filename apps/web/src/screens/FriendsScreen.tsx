// Friends (documento 03, §7.2): amigos, pedidos e bloqueados. Não há indicador de "online".
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, errorMessage } from '../api/client.ts'
import type { FriendRequestCard, UserCard } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { queryClient } from '../app/session.ts'
import { en } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Avatar, Field, formatDate, Panel, QueryState, Tabs, ui } from '../ui/kit.tsx'

type Tab = 'friends' | 'requests' | 'blocked'
const TABS: { id: Tab; label: string }[] = [
  { id: 'friends', label: en.title.friends },
  { id: 'requests', label: en.friends.requests },
  { id: 'blocked', label: en.friends.blocked },
]

function PersonRow({ user, meta, actions }: { user: { username: string; avatarId: number }; meta?: string; actions: React.ReactNode }) {
  return (
    <li className={ui.item}>
      <Avatar id={user.avatarId} name={user.username} />
      <div className={ui.itemBody}>
        <p className={ui.itemTitle}>
          <Link to={`/u/${user.username}`}>{user.username}</Link>
        </p>
        {meta && <p className={ui.itemMeta}>{meta}</p>}
      </div>
      {actions}
    </li>
  )
}

export default function FriendsScreen() {
  const [tab, setTab] = useState<Tab>('friends')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const friends = useQuery({ queryKey: ['friends', 'list'], queryFn: () => api.get<{ items: UserCard[] }>('/api/me/friends') })
  const requests = useQuery({
    queryKey: ['friends', 'requests'],
    queryFn: () => api.get<{ received: FriendRequestCard[]; sent: FriendRequestCard[] }>('/api/me/friend-requests'),
  })
  const blocks = useQuery({
    queryKey: ['friends', 'blocks'],
    enabled: tab === 'blocked',
    queryFn: () => api.get<{ items: UserCard[] }>('/api/me/blocks'),
  })

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['friends'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      if (done) toast(done)
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setBusy(false)
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    void act(() => api.post('/api/friend-requests', { username: username.trim() }), en.profile.requestSent).then(() => setUsername(''))
  }

  const received = requests.data?.received ?? []
  const sent = requests.data?.sent ?? []
  const requestsLabel = received.length > 0 ? `${en.friends.requests} (${received.length})` : en.friends.requests

  return (
    <Screen title={en.title.friends} back="/" wide>
      <Panel>
        <form className={ui.form} onSubmit={add}>
          <Field
            label={en.friends.addByUsername}
            value={username}
            maxLength={16}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
            after={
              <Button type="submit" disabled={busy || username.trim().length < 3}>
                {en.profile.addFriend}
              </Button>
            }
          />
        </form>
      </Panel>
      <Tabs
        label={en.title.friends}
        tabs={TABS.map((item) => (item.id === 'requests' ? { ...item, label: requestsLabel } : item))}
        value={tab}
        onChange={setTab}
      />

      {tab === 'friends' && (
        <QueryState
          loading={friends.isLoading}
          error={friends.error}
          onRetry={() => void friends.refetch()}
          empty={friends.data?.items.length === 0}
          emptyText={en.friends.empty}
        >
          <ul className={ui.list}>
            {friends.data?.items.map((user) => (
              <PersonRow
                key={user.username}
                user={user}
                {...(user.since ? { meta: `${en.friends.since} ${formatDate(user.since)}` } : {})}
                actions={
                  <Button className={ui.small} disabled={busy} onClick={() => void act(() => api.delete(`/api/friends/${user.username}`))}>
                    {en.profile.removeFriend}
                  </Button>
                }
              />
            ))}
          </ul>
        </QueryState>
      )}

      {tab === 'requests' && (
        <QueryState loading={requests.isLoading} error={requests.error} onRetry={() => void requests.refetch()}>
          <Panel title={en.friends.received}>
            {received.length === 0 ? (
              <p className={ui.muted}>{en.friends.noRequests}</p>
            ) : (
              <ul className={ui.list}>
                {received.map((request) => (
                  <PersonRow
                    key={request.userId}
                    user={request}
                    actions={
                      <>
                        <Button
                          className={ui.small}
                          disabled={busy}
                          onClick={() => void act(() => api.post(`/api/friend-requests/${request.userId}/accept`), en.profile.nowFriends)}
                        >
                          {en.friends.accept}
                        </Button>
                        <Button
                          className={ui.small}
                          disabled={busy}
                          onClick={() => void act(() => api.post(`/api/friend-requests/${request.userId}/decline`))}
                        >
                          {en.friends.decline}
                        </Button>
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={en.friends.sent}>
            {sent.length === 0 ? (
              <p className={ui.muted}>{en.friends.noRequests}</p>
            ) : (
              <ul className={ui.list}>
                {sent.map((request) => (
                  <PersonRow
                    key={request.userId}
                    user={request}
                    actions={
                      <Button className={ui.small} disabled={busy} onClick={() => void act(() => api.delete(`/api/friends/${request.username}`))}>
                        {en.common.cancel}
                      </Button>
                    }
                  />
                ))}
              </ul>
            )}
          </Panel>
        </QueryState>
      )}

      {tab === 'blocked' && (
        <QueryState
          loading={blocks.isLoading}
          error={blocks.error}
          onRetry={() => void blocks.refetch()}
          empty={blocks.data?.items.length === 0}
          emptyText={en.friends.noBlocked}
        >
          <ul className={ui.list}>
            {blocks.data?.items.map((user) => (
              <li key={user.username} className={ui.item}>
                <Avatar id={user.avatarId} name={user.username} />
                <div className={ui.itemBody}>
                  <p className={ui.itemTitle}>{user.username}</p>
                </div>
                <Button className={ui.small} disabled={busy} onClick={() => void act(() => api.delete(`/api/blocks/${user.username}`))}>
                  {en.friends.unblock}
                </Button>
              </li>
            ))}
          </ul>
        </QueryState>
      )}
    </Screen>
  )
}
