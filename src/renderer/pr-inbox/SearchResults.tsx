// The results of the PR search in the left pane of the Pull requests view, in place of the inbox's groups
// (worfy-pr-review ticket 05; spec, the user's walk A, steps 1–2, implementation decisions 9 and 10;
// the prototype of ticket 01, state `search`): «Search · N results», the saved search it is, «Searched 3 min ago ·
// Refresh» — a snapshot no timer searches again — the notices of the search above the rows, the rows of the inbox's
// list (each with its approvals chip), and «Load more» while GitHub has another page. A search that finds nothing says
// so and offers All of GitHub.
import type { MouseEvent, ReactNode } from 'react'
import type { PrSearchNotice, PrSearchRow, SavedSearch } from '../../shared/ipc/pr-search'
import { invoke } from '../ipc'
import { openHealthCheck } from '../settings/settings-window'
import { Button } from '../theme/Button'
import { searchedText, type PrSearch } from './usePrInbox'

/** The notices that say why the results are missing: no «No pull requests match» beside them. */
const BLOCKING: ReadonlySet<PrSearchNotice['kind']> = new Set(['sso', 'not-visible', 'sign-in', 'failed', 'rate-limit', 'invalid'])

function openLink(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}

/** One notice above the results: its words, and the way out it offers — the authorization of single sign-on, Health check. */
function Notice({ notice }: { notice: PrSearchNotice }) {
  return (
    <p className="w-pr-search-results__notice" data-testid="pr-search-notice" data-kind={notice.kind} role={BLOCKING.has(notice.kind) ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {notice.url !== null ? (
        <>
          {' '}
          <a href={notice.url} className="w-pr-inbox-link" title={notice.url} onClick={(event) => openLink(event, notice.url!)}>
            Authorize
          </a>
        </>
      ) : null}
      {notice.kind === 'sign-in' ? (
        <>
          {' '}
          <Button variant="link" onClick={openHealthCheck}>
            Open Health check
          </Button>
        </>
      ) : null}
    </p>
  )
}

export interface SearchResultsProps {
  search: PrSearch
  /** The results to list, the rows Load more added included. */
  rows: readonly PrSearchRow[]
  /** The saved search the shown search is, if any: its name stands in the heading. */
  savedHit: SavedSearch | null
  /** The notices of reading the selected result (`prSearch.pull`), after the search's own. */
  pullNotices: readonly PrSearchNotice[]
  /** One row of the list: the inbox's row (PrListItem), so a result looks like a PR of the inbox. */
  renderRow: (row: PrSearchRow) => ReactNode
  /** The view's clock (useNow): «Searched 3 min ago». */
  now: number
}

const resultsText = (count: number): string => `${count.toLocaleString('en-US')} result${count === 1 ? '' : 's'}`

export function SearchResults({ search, rows, savedHit, pullNotices, renderRow, now }: SearchResultsProps) {
  const { result, running, failure } = search
  // GitHub's 422 is said under the field, not here.
  const notices = [...(result?.notices ?? []), ...pullNotices].filter((notice) => notice.kind !== 'invalid')
  const blocked = failure !== null || (result?.notices ?? []).some((notice) => BLOCKING.has(notice.kind))
  return (
    <nav className="w-pr-inbox-list w-pr-search-results" aria-label="Search results" data-testid="pr-search-results" aria-busy={running}>
      <h3 className="w-pr-inbox-group__title w-pr-search-results__title" data-testid="pr-search-heading">
        Search{' '}
        <span className="w-pr-inbox-group__count w-mono">· {result === null ? (running ? 'searching…' : 'no answer') : resultsText(result.issueCount)}</span>
        {savedHit !== null ? <span className="w-pr-search-results__saved"> · ★ {savedHit.name}</span> : null}
      </h3>
      {result !== null ? (
        <p className="w-pr-search-results__meta">
          {/* The age moves with the view's clock; nothing searches again by itself: the results are a snapshot (spec, implementation decisions 9). */}
          <span data-testid="pr-search-searched" title={new Date(result.searchedAt).toLocaleString()}>
            {searchedText(result.searchedAt, now)}
          </span>
          <span aria-hidden="true">·</span>
          <Button variant="link" data-testid="pr-search-refresh" disabled={running} title="Search again" onClick={search.refresh}>
            Refresh
          </Button>
        </p>
      ) : null}
      {failure !== null ? <Notice notice={{ kind: 'failed', text: failure, url: null }} /> : null}
      {notices.map((notice) => (
        <Notice key={`${notice.kind}:${notice.text}`} notice={notice} />
      ))}
      {rows.length > 0 ? <ul className="w-pr-inbox-group__rows">{rows.map(renderRow)}</ul> : null}
      {result !== null && rows.length === 0 && !blocked ? (
        <div className="w-pr-search-results__empty" data-testid="pr-search-empty">
          <b>No pull requests match</b>
          {search.scope !== 'github' ? (
            <span>
              Try another scope:{' '}
              <Button variant="link" onClick={() => search.setScope('github')}>
                Search All of GitHub
              </Button>
            </span>
          ) : (
            <span>Change the words or the filters.</span>
          )}
        </div>
      ) : null}
      {result !== null && result.cursor !== null ? (
        <div className="w-pr-search-results__more">
          <Button data-testid="pr-search-load-more" className="w-pr-search__button" disabled={running} onClick={search.loadMore}>
            {running ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </nav>
  )
}
