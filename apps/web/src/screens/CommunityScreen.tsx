// Community (documento 03, §7.3): New, Trending, Friends e a busca de livros e usuários.
import { type FeedTab } from '@quillframe/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../api/client.ts'
import type { BookSummary, Paged, UserCard } from '../api/types.ts'
import { Screen } from '../app/Screen.tsx'
import { useMe } from '../app/session.ts'
import { en } from '../strings/en.ts'
import { Button } from '../ui/Button.tsx'
import { Avatar, Field, Panel, QueryState, Tabs, ui } from '../ui/kit.tsx'
import { BookList } from './BookList.tsx'

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'new', label: en.community.new },
  { id: 'trending', label: en.community.trending },
  { id: 'friends', label: en.community.friends },
]

export function UserList({ users }: { users: UserCard[] }) {
  return (
    <ul className={ui.list}>
      {users.map((user) => (
        <li key={user.username}>
          <Link className={ui.item} to={`/u/${user.username}`}>
            <Avatar id={user.avatarId} name={user.username} />
            <div className={ui.itemBody}>
              <p className={ui.itemTitle}>{user.username}</p>
              {user.bio && <p className={ui.itemMeta}>{user.bio}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** O valor só muda depois de a pessoa parar de digitar. */
function useDebounced(value: string, delay = 350): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function CommunityScreen() {
  const { data: me } = useMe()
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((item) => item.id === params.get('tab'))?.id ?? 'new'
  const [search, setSearch] = useState('')
  const term = useDebounced(search.trim())
  const searching = term.length >= 2

  const feed = useInfiniteQuery({
    queryKey: ['feed', tab],
    enabled: !searching && (tab !== 'friends' || Boolean(me)),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<Paged<BookSummary>>(
        `/api/feed?tab=${tab}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const results = useQuery({
    queryKey: ['search', term],
    enabled: searching,
    queryFn: () =>
      api.get<{ books: BookSummary[]; users: UserCard[] }>(`/api/search?q=${encodeURIComponent(term)}`),
  })
  const books = feed.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Screen title={en.title.community} back="/" wide>
      <Field
        label={en.community.search}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        hint={search.trim().length === 1 ? en.community.searchHint : undefined}
      />
      {searching ? (
        <QueryState loading={results.isLoading} error={results.error} onRetry={() => void results.refetch()}>
          <Panel title={en.community.books}>
            {results.data?.books.length ? (
              <BookList books={results.data.books} />
            ) : (
              <p className={ui.muted}>{en.community.noBooks}</p>
            )}
          </Panel>
          <Panel title={en.community.users}>
            {results.data?.users.length ? (
              <UserList users={results.data.users} />
            ) : (
              <p className={ui.muted}>{en.community.noUsers}</p>
            )}
          </Panel>
        </QueryState>
      ) : (
        <>
          <Tabs
            label={en.title.community}
            tabs={TABS}
            value={tab}
            onChange={(next) => setParams({ tab: next }, { replace: true })}
          />
          {tab === 'friends' && !me ? (
            <p className={ui.muted}>
              <Link to="/login?returnTo=%2Fcommunity%3Ftab%3Dfriends">{en.community.signInForFriends}</Link>
            </p>
          ) : (
            <QueryState
              loading={feed.isLoading}
              error={feed.error}
              onRetry={() => void feed.refetch()}
              empty={books.length === 0}
              emptyText={tab === 'friends' ? en.community.emptyFriends : en.community.empty}
            >
              <BookList books={books} />
              {/* "Load more" em vez de rolagem infinita: melhor para teclado, e o rodapé fica alcançável */}
              {feed.hasNextPage && (
                <Button onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                  {en.common.loadMore}
                </Button>
              )}
            </QueryState>
          )}
        </>
      )}
    </Screen>
  )
}
