// Perfil (documento 03, §7.1): avatar, bio, livros visíveis para quem olha, favoritos e cópias.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError, errorMessage } from '../api/client.ts'
import type { BookSummary, CopyItem, Paged, Profile } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { queryClient, useMe } from '../app/session.ts'
import { en, format } from '../strings/en.ts'
import { toast } from '../stores/app.ts'
import { Button } from '../ui/Button.tsx'
import { Avatar, ButtonLink, Confirm, cx, formatDate, Panel, QueryState, Tabs, ui } from '../ui/kit.tsx'
import { BookList } from './BookList.tsx'
import { ReportDialog } from './ReportDialog.tsx'

type Tab = 'books' | 'favorites' | 'copies'

export default function ProfileScreen() {
  const { username = '' } = useParams()
  const { data: me } = useMe()
  const key = ['profile', username.toLowerCase()]
  const profile = useQuery({ queryKey: key, queryFn: () => api.get<Profile>(`/api/users/${encodeURIComponent(username)}`) })
  const [tab, setTab] = useState<Tab>('books')
  const [dialog, setDialog] = useState<'report' | 'block' | null>(null)
  const [busy, setBusy] = useState(false)
  const user = profile.data

  const books = useInfiniteQuery({
    queryKey: [...key, 'books'],
    enabled: Boolean(user) && tab === 'books',
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paged<BookSummary>>(`/api/users/${username}/books?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const favorites = useQuery({
    queryKey: [...key, 'favorites'],
    enabled: Boolean(user?.showsFavorites) && tab === 'favorites',
    queryFn: () => api.get<{ items: BookSummary[] }>(`/api/users/${username}/favorites`),
  })
  const copies = useQuery({
    queryKey: [...key, 'copies'],
    enabled: Boolean(user) && tab === 'copies',
    queryFn: () => api.get<{ items: CopyItem[] }>(`/api/users/${username}/copies`),
  })

  const act = async (action: () => Promise<unknown>, done?: string) => {
    if (!me) {
      toast(en.profile.signIn)
      return
    }
    setBusy(true)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: key })
      await queryClient.invalidateQueries({ queryKey: ['friends'] })
      if (done) toast(done)
    } catch (cause) {
      toast(errorMessage(cause), 'error')
    } finally {
      setBusy(false)
    }
  }

  const missing = profile.error instanceof ApiError && profile.error.status === 404
  const tabs: { id: Tab; label: string }[] = [
    { id: 'books', label: en.profile.books },
    ...(user?.showsFavorites ? [{ id: 'favorites' as const, label: en.library.favorites }] : []),
    { id: 'copies', label: en.library.copies },
  ]
  const bookItems = books.data?.pages.flatMap((page) => page.items) ?? []
  const listed =
    tab === 'books'
      ? bookItems
      : tab === 'favorites'
        ? (favorites.data?.items ?? [])
        : (copies.data?.items ?? []).flatMap((copy) => (copy.book ? [copy.book] : []))
  const active = tab === 'books' ? books : tab === 'favorites' ? favorites : copies

  return (
    <Screen title={user?.username ?? en.profile.title} wide>
      {missing ? (
        <Panel>
          <p className={cx(ui.text, ui.center)}>{en.profile.notFound}</p>
        </Panel>
      ) : (
        <QueryState loading={profile.isLoading} error={profile.error} onRetry={() => void profile.refetch()}>
          {user && (
            <>
              <Panel>
                <div className={cx(ui.row, ui.rowStart)}>
                  <Avatar id={user.avatarId} large name={user.username} />
                  <div className={ui.itemBody}>
                    <p className={ui.text}>{user.username}</p>
                    <p className={ui.muted}>
                      {format(en.profile.memberSince, { date: formatDate(user.memberSince) })} ·{' '}
                      {format(user.bookCount === 1 ? en.profile.oneBook : en.profile.bookCount, { count: user.bookCount })}
                    </p>
                  </div>
                </div>
                {user.bio && <p className={ui.text}>{user.bio}</p>}
                <div className={cx(ui.row, ui.rowStart)}>
                  {user.relation === 'self' && <ButtonLink to="/settings">{en.profile.edit}</ButtonLink>}
                  {user.relation === 'none' && (
                    <Button
                      disabled={busy}
                      onClick={() => void act(() => api.post('/api/friend-requests', { username: user.username }), en.profile.requestSent)}
                    >
                      {en.profile.addFriend}
                    </Button>
                  )}
                  {user.relation === 'request_sent' && (
                    <Button disabled={busy} onClick={() => void act(() => api.delete(`/api/friends/${user.username}`))}>
                      {en.profile.cancelRequest}
                    </Button>
                  )}
                  {user.relation === 'request_received' && (
                    <Button
                      disabled={busy}
                      onClick={() => void act(() => api.post(`/api/friend-requests/${user.id}/accept`), en.profile.nowFriends)}
                    >
                      {en.profile.acceptRequest}
                    </Button>
                  )}
                  {user.relation === 'friends' && (
                    <Button disabled={busy} onClick={() => void act(() => api.delete(`/api/friends/${user.username}`))}>
                      {en.profile.removeFriend}
                    </Button>
                  )}
                  {user.relation !== 'self' && me && (
                    <>
                      <Button onClick={() => setDialog('block')}>{en.profile.block}</Button>
                      <Button onClick={() => setDialog('report')}>{en.profile.report}</Button>
                    </>
                  )}
                </div>
              </Panel>

              <Tabs label={en.profile.title} tabs={tabs} value={tab} onChange={setTab} />
              <QueryState
                loading={active.isLoading}
                error={active.error}
                onRetry={() => void active.refetch()}
                empty={listed.length === 0}
                emptyText={en.profile.empty}
              >
                <BookList books={listed} own={user.relation === 'self' && tab === 'books'} />
                {tab === 'books' && books.hasNextPage && (
                  <Button onClick={() => void books.fetchNextPage()} disabled={books.isFetchingNextPage}>
                    {en.common.loadMore}
                  </Button>
                )}
              </QueryState>

              {dialog === 'report' && <ReportDialog targetType="USER" targetId={user.id} onClose={() => setDialog(null)} />}
              {dialog === 'block' && (
                <Confirm
                  title={format(en.profile.blockTitle, { username: user.username })}
                  message={en.profile.blockConfirm}
                  confirmLabel={en.profile.block}
                  danger
                  onConfirm={() => void act(() => api.put(`/api/blocks/${user.username}`), en.profile.blocked)}
                  onClose={() => setDialog(null)}
                />
              )}
            </>
          )}
        </QueryState>
      )}
    </Screen>
  )
}
