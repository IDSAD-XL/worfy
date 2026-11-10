// The Pull requests view (worfy-pr-inbox ticket 03, two panes since worfy-polish 96): the PR inbox of the active
// Project — the user's open PRs and the review requests to the user in the Project's repositories — grouped by whose
// move it is, as main computes them (src/main/github/inbox-groups.ts). On the left a compact list of the PRs by group;
// on the right the selected PR in full: what to do next, CI, review, merge state and size, then its review threads with
// their last comments and links to the code lines on GitHub. ↑ and ↓ move the selection. Selecting a PR (a click, a
// key, an entry that names it) and "Mark seen" tell main the user has seen it (`prInbox.markSeen`); the PR the view
// selects by itself does not. Links open in the system's browser (`shell.openExternal`).
//
// The selected PR also has "Draft replies" (a Session with skill pr-reply, `actions.prReply`) and, under each thread,
// its draft reply (DraftThread.tsx, worfy-pr-inbox ticket 05): the only way to GitHub from this view is Send on a
// draft, on the user's click (ADR-0105). Drafts are read for the selected PR only.
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { PR_INBOX_GROUP_TITLES, type PrInboxComment, type PrInboxGroup, type PrInboxRow, type PrInboxSnapshot, type PrInboxThread } from '../../shared/ipc/pr-inbox'
import type { PrReplyItem } from '../../shared/ipc/pr-inbox'
import type { ProjectView } from '../../shared/ipc/projects'
import type { Ticket } from '../../shared/workflow/types'
import { ticketTitle } from '../canvas/epic-layout'
import { invoke, readableReason } from '../ipc'
import { useNow } from '../limits/useLimits'
import { ticketRef } from '../pipeline/board'
import { activeProject, useProjects, useReadOnly } from '../projects/useProjects'
import { StatusChip } from '../theme/primitives'
import { useWorkflow } from '../workflow/useWorkflow'
import { CommentBody } from './CommentBody'
import { DraftRepliesButton, PrDrafts } from './DraftThread'
import {
  ageHeat,
  ageOf,
  ageText,
  avatarTone,
  findRow,
  initialsOf,
  listedGroups,
  listOrder,
  markPullSeen,
  mergeText,
  newText,
  nextStep,
  reviewText,
  rowKey,
  shownKey,
  sizeOf,
  statusLines,
  threadsText,
  ticketOfRow,
  usePrInbox,
  usePrInboxFocus,
  type FactTone,
  type NextTone,
  type PrInboxFocus,
  type PullRef,
} from './usePrInbox'
import './pr-inbox.css'

function openLink(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}

/** A link that opens in the system's browser, never in the window. */
function ExternalLink({ url, className, testId, children }: { url: string; className?: string; testId?: string; children: ReactNode }) {
  return (
    <a href={url} className={className} data-testid={testId} title={url} onClick={(event) => openLink(event, url)}>
      {children}
    </a>
  )
}

// ── small parts ──────────────────────────────────────────────────────────────

const ICON_PATHS = {
  eye: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  reply: (
    <>
      <path d="M6 4 2 8l4 4" />
      <path d="M2.5 8H10a4 4 0 0 1 4 4v1" />
    </>
  ),
  wrench: <path d="M10.5 2.5a3 3 0 0 0-3.4 4L2.5 11.1l2.4 2.4 4.6-4.6a3 3 0 0 0 4-3.4l-1.8 1.8-2-.4-.4-2z" />,
  check: <path d="m3 8.5 3 3 7-7" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  chat: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />,
} as const

/** A 16-unit line icon in the colour of its text; decoration only. */
function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="w-pr-inbox-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}

const NEXT_ICON: Readonly<Record<NextTone, keyof typeof ICON_PATHS>> = {
  review: 'eye',
  answer: 'reply',
  fix: 'wrench',
  ready: 'check',
  waiting: 'clock',
}

/** The colours an avatar may get, each a token of both themes; `--span-label` is the text on them. */
const AVATAR_TONES = ['--kind-session', '--kind-orchestrator', '--kind-epic', '--span-ticket', '--span-gate', '--span-script', '--span-wait', '--span-verifier'] as const

/** The initials of a login on a colour of its own; the login is the tooltip. The user's own has a ring. */
function Avatar({ login, viewer, small = false }: { login: string | null; viewer: string | null; small?: boolean }) {
  const tone = AVATAR_TONES[avatarTone(login, AVATAR_TONES.length)] ?? AVATAR_TONES[0]
  const me = login !== null && viewer !== null && login.toLowerCase() === viewer.toLowerCase()
  return (
    <span
      className={`w-pr-inbox-avatar${small ? ' w-pr-inbox-avatar--small' : ''}`}
      style={{ '--avatar': `var(${tone})` } as CSSProperties}
      data-me={me ? 'true' : undefined}
      title={login ?? 'ghost'}
      aria-hidden="true"
    >
      {initialsOf(login)}
    </span>
  )
}

const CI_TEXT = {
  passing: 'CI passing',
  failing: 'CI failing',
  running: 'CI running',
} as const

/** The CI of the PR: a dot, its text the tooltip and the accessible name; with `label`, the text beside it too. */
function CiDot({ ci, label = false }: { ci: PrInboxRow['ci']; label?: boolean }) {
  const text = ci === null ? 'No CI' : CI_TEXT[ci]
  const dot = <span className="w-pr-inbox-ci" data-testid="pr-inbox-ci" data-ci={ci ?? 'none'} role="img" aria-label={text} title={text} />
  if (!label) return dot
  return (
    <span className="w-pr-inbox-ci-text" data-ci={ci ?? 'none'}>
      {dot}
      <span aria-hidden="true">{text}</span>
    </span>
  )
}

/** `<epic> <NN>`; a long Epic name is cut by the stylesheet, the number stays whole, the whole `<epic> <NN> — title` is the tooltip. */
function TicketChip({ ticket }: { ticket: Ticket | undefined }) {
  if (ticket === undefined) return null
  const ref = ticketRef(ticket)
  return (
    <span className="w-chip w-chip--open w-mono w-pr-inbox-ticket" data-testid="pr-inbox-ticket" title={`${ref} — ${ticketTitle(ticket)}`}>
      <span className="w-pr-inbox-ticket__epic" data-testid="pr-inbox-ticket-epic">
        {ticket.epic}
      </span>
      <span className="w-pr-inbox-ticket__number">{ref.slice(ticket.epic.length)}</span>
    </span>
  )
}

function FactChip({ label, tone }: { label: string; tone: FactTone }) {
  if (tone === 'ready' || tone === 'blocked') return <StatusChip status={tone} label={label} />
  return <span className={tone === 'open' ? 'w-chip w-chip--open' : 'w-chip w-pr-inbox-chip--problem'}>{label}</span>
}

function Comment({ comment, repo, now }: { comment: PrInboxComment; repo: string; now: number }) {
  return (
    <li className="w-pr-inbox-comment" data-testid="pr-inbox-comment">
      <span className="w-pr-inbox-comment__meta">
        <span className="w-pr-inbox-comment__author">{comment.author ?? 'ghost'}</span>
        <span title={new Date(comment.createdAt).toLocaleString()}>{ageText(comment.createdAt, now)}</span>
      </span>
      <CommentBody body={comment.body} repo={repo} />
    </li>
  )
}

function Thread({ thread, repo, now, draft }: { thread: PrInboxThread; repo: string; now: number; draft?: ReactNode }) {
  const first = thread.comments[0]
  const place = thread.path === null ? 'Conversation' : thread.line === null ? thread.path : `${thread.path}:${thread.line}`
  return (
    <li className="w-pr-inbox-thread" data-testid="pr-inbox-thread" data-resolved={thread.isResolved ? 'true' : undefined}>
      <div className="w-pr-inbox-thread__head">
        {/* The first comment's page on GitHub shows the code line the thread is about. */}
        {first === undefined ? (
          <span className="w-mono">{place}</span>
        ) : (
          <ExternalLink url={first.url} className="w-pr-inbox-link w-mono" testId="pr-inbox-thread-link">
            {place}
          </ExternalLink>
        )}
        {thread.isResolved ? <span className="w-pr-inbox-flag">Resolved</span> : null}
        {thread.isOutdated ? <span className="w-pr-inbox-flag">Outdated</span> : null}
      </div>
      <ul className="w-pr-inbox-comments">
        {thread.comments.map((comment) => (
          <Comment key={comment.id} comment={comment} repo={repo} now={now} />
        ))}
      </ul>
      <div className="w-pr-inbox-thread__draft">{draft}</div>
    </li>
  )
}

/** The threads and the conversation of a PR; with `render`, each draft reply under its thread or the conversation, and the drafts of threads it does not list below them. */
function RowThreads({ row, now, render, drafts = [] }: { row: PrInboxRow; now: number; render?: (item: PrReplyItem) => ReactNode; drafts?: readonly PrReplyItem[] }) {
  // Open threads first, each kind in GitHub's order.
  const threadList = [...row.threads.filter((thread) => !thread.isResolved), ...row.threads.filter((thread) => thread.isResolved)]
  const draftsOf = (threadId: string | null): ReactNode =>
    render === undefined ? null : drafts.filter((item) => item.threadId === threadId && (threadId !== null || item.kind === 'conversation')).map(render)
  const listed = new Set(row.threads.map((thread) => thread.id))
  const elsewhere = drafts.filter((item) => item.kind === 'thread' && (item.threadId === null || !listed.has(item.threadId)))
  const conversationDrafts = draftsOf(null)
  const hasConversationDrafts = drafts.some((item) => item.kind === 'conversation')
  return (
    <>
      {threadList.length > 0 ? (
        <ul className="w-pr-inbox-threads" aria-label="Review threads">
          {threadList.map((thread) => (
            <Thread key={thread.id} thread={thread} repo={row.repo} now={now} draft={draftsOf(thread.id)} />
          ))}
        </ul>
      ) : (
        <p className="w-pr-inbox__message">No review threads.</p>
      )}
      {row.comments.length > 0 || hasConversationDrafts ? (
        <section className="w-pr-inbox-conversation" aria-label="Conversation">
          <h4 className="w-pr-inbox-conversation__title">Conversation</h4>
          <ul className="w-pr-inbox-comments">
            {row.comments.map((comment) => (
              <Comment key={comment.id} comment={comment} repo={row.repo} now={now} />
            ))}
          </ul>
          {conversationDrafts}
        </section>
      ) : null}
      {render !== undefined && elsewhere.length > 0 ? (
        <section className="w-pr-inbox-conversation" aria-label="Other draft replies">
          <h4 className="w-pr-inbox-conversation__title">Replies to threads not shown here</h4>
          {elsewhere.map(render)}
        </section>
      ) : null}
    </>
  )
}

// ── the list ─────────────────────────────────────────────────────────────────

export interface PrListItemProps {
  group: PrInboxGroup
  row: PrInboxRow
  ticket: Ticket | undefined
  viewer: string | null
  now: number
  selected: boolean
  onSelect: () => void
}

/** One PR of the list: the author, the title, `name#N`, the Ticket chip and CI, the age, open threads and a new mark. */
export function PrListItem({ group, row, ticket, viewer, now, selected, onSelect }: PrListItemProps) {
  const threads = threadsText(row.unresolvedThreads)
  const fresh = newText(row.newSinceSeen)
  const age = ageOf(group, row)
  const name = row.repo.slice(row.repo.indexOf('/') + 1)
  return (
    <li className="w-pr-inbox-row" data-testid="pr-inbox-row" data-repo={row.repo} data-number={row.number} data-selected={selected ? 'true' : undefined}>
      <button type="button" className="w-pr-inbox-item" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <Avatar login={row.author} viewer={viewer} small />
        <span className="w-pr-inbox-item__main">
          <span className="w-pr-inbox-item__title" data-testid="pr-inbox-title" title={row.title}>
            {row.title}
          </span>
          <span className="w-pr-inbox-item__sub">
            {/* A long repository name is cut with an ellipsis; #N stays whole. */}
            <span className="w-mono w-pr-inbox-item__ref" data-testid="pr-inbox-ref" title={`${row.repo}#${row.number}`}>
              <span className="w-pr-inbox-item__repo" data-testid="pr-inbox-ref-repo">
                {name}
              </span>
              <span className="w-pr-inbox-item__number">#{row.number}</span>
            </span>
            <TicketChip ticket={ticket} />
            <CiDot ci={row.ci} label={row.ci !== 'passing'} />
          </span>
        </span>
        <span className="w-pr-inbox-item__side">
          <span className="w-pr-inbox-age w-mono" data-testid="pr-inbox-age" data-heat={ageHeat(age, now)} title={new Date(age).toLocaleString()}>
            {ageText(age, now)}
          </span>
          {threads !== null || fresh !== null ? (
            <span className="w-pr-inbox-item__marks">
              {threads !== null ? (
                <span
                  className="w-pr-inbox-bubble"
                  data-testid="pr-inbox-threads"
                  data-mine={row.author !== null && viewer !== null && row.author.toLowerCase() === viewer.toLowerCase() ? 'true' : undefined}
                  title={threads}
                  aria-label={threads}
                >
                  <Icon name="chat" />
                  {row.unresolvedThreads}
                </span>
              ) : null}
              {fresh !== null ? <span className="w-pr-inbox-newdot" data-testid="pr-inbox-new" role="img" title={fresh} aria-label={fresh} /> : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

// ── the selected PR ──────────────────────────────────────────────────────────

export interface PrPaneProps {
  /** The Project the PR is of: its drafts of replies are read by it. */
  projectId: string
  group: PrInboxGroup
  row: PrInboxRow
  ticket: Ticket | undefined
  viewer: string | null
  now: number
  /** The read-only hint of a Linked machine's screen: "Mark seen" is off with it. */
  readOnly: string | null
  /** The list holds this PR alone: no ↑ ↓ hint. */
  single: boolean
  onMarkSeen: () => void
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="w-pr-inbox-fact" data-testid="pr-inbox-fact" data-fact={name.toLowerCase()}>
      <div className="w-pr-inbox-fact__name">{name}</div>
      <div className="w-pr-inbox-fact__value">{children}</div>
    </div>
  )
}

function Size({ row }: { row: PrInboxRow }) {
  const size = sizeOf(row)
  if (size === null)
    return (
      <span className="w-pr-inbox-muted" data-testid="pr-inbox-size" title="GitHub gave no size for this pull request">
        —
      </span>
    )
  return (
    <span className="w-pr-inbox-size w-mono" data-testid="pr-inbox-size" title={`${size.additions} lines added, ${size.deletions} removed`}>
      <span className="w-pr-inbox-size__plus">+{size.additions}</span>
      <span className="w-pr-inbox-size__minus">−{size.deletions}</span>
      <span className="w-pr-inbox-size__bar" aria-hidden="true">
        <span className="w-pr-inbox-size__add" style={{ width: `${size.addedShare}%` }} />
        <span className="w-pr-inbox-size__del" style={{ width: `${100 - size.addedShare}%` }} />
      </span>
    </span>
  )
}

/** The selected PR in full: its title and facts, what to do next, the links and buttons, its threads with their drafts. */
export function PrPane({ projectId, group, row, ticket, viewer, now, readOnly, single, onMarkSeen }: PrPaneProps) {
  const review = reviewText(row.reviewDecision)
  const merge = mergeText(row.mergeStateStatus)
  const fresh = newText(row.newSinceSeen)
  const resolved = row.threads.filter((thread) => thread.isResolved).length
  const open = row.threads.length - resolved
  return (
    <article className="w-pr-inbox-pane" data-testid="pr-inbox-pane" data-repo={row.repo} data-number={row.number} aria-label={`${row.repo}#${row.number}`}>
      <div className="w-pr-inbox-pane__inner">
        <header className="w-pr-inbox-pane__head">
          <Avatar login={row.author} viewer={viewer} />
          <div className="w-pr-inbox-pane__heading">
            <h3 className="w-pr-inbox-pane__title" data-testid="pr-inbox-pane-title">
              {row.title}
            </h3>
            <div className="w-pr-inbox-pane__meta">
              <span className="w-mono" data-testid="pr-inbox-pane-ref">
                {row.repo}#{row.number}
              </span>
              <TicketChip ticket={ticket} />
              {row.isDraft ? <span className="w-pr-inbox-flag">Draft</span> : null}
              {row.viaTeam ? (
                <span className="w-pr-inbox-flag" data-testid="pr-inbox-via-team" title="The review is asked of a team you are in">
                  via team
                </span>
              ) : null}
              <span>by {row.author ?? 'ghost'}</span>
              <span className="w-mono w-pr-inbox-pane__branch" title={row.headRefName}>
                {row.headRefName}
              </span>
              {fresh !== null ? (
                <span className="w-pr-inbox-flag w-pr-inbox-flag--new" data-testid="pr-inbox-pane-new">
                  {fresh}
                </span>
              ) : null}
            </div>
          </div>
        </header>
        <PrDrafts projectId={projectId} repo={row.repo} number={row.number} readOnly={readOnly} threads={row.threads}>
          {(render, drafts, sendAll) => {
            const step = nextStep(group, row, now, drafts.filter((item) => item.state === 'draft').length, render !== null)
            const action = step.action
            return (
              <>
                <div className="w-pr-inbox-next" data-testid="pr-inbox-next-step" data-tone={step.tone}>
                  <span className="w-pr-inbox-next__icon">
                    <Icon name={NEXT_ICON[step.tone]} />
                  </span>
                  <span className="w-pr-inbox-next__text">
                    <b data-testid="pr-inbox-next-step-title">{step.title}</b>
                    <span>{step.text}</span>
                  </span>
                  {action?.kind === 'link' ? (
                    <ExternalLink url={action.url} className="w-pr-inbox-button w-pr-inbox-button--primary w-pr-inbox-button--link" testId="pr-inbox-next-step-action">
                      {action.label}
                    </ExternalLink>
                  ) : action?.kind === 'send-all' && sendAll !== null ? (
                    // The dialog of Send all with every text first: nothing is posted without its own Send all (ADR-0105).
                    <button
                      type="button"
                      className="w-pr-inbox-button w-pr-inbox-button--primary"
                      data-testid="pr-inbox-next-step-action"
                      disabled={sendAll.off !== null}
                      title={sendAll.off ?? undefined}
                      onClick={sendAll.open}
                    >
                      Send all ({sendAll.count})
                    </button>
                  ) : action?.kind === 'draft-replies' ? (
                    <DraftRepliesButton projectId={projectId} repo={row.repo} number={row.number} readOnly={readOnly} primary />
                  ) : null}
                </div>
                <div className="w-pr-inbox-facts">
                  <Fact name="CI">
                    <CiDot ci={row.ci} label />
                  </Fact>
                  <Fact name="Review">
                    {review !== null ? (
                      <span data-testid="pr-inbox-review" data-value={row.reviewDecision ?? undefined}>
                        <FactChip label={review.label} tone={review.status ?? 'open'} />
                      </span>
                    ) : (
                      <span className="w-pr-inbox-muted">None yet</span>
                    )}
                  </Fact>
                  <Fact name="Merge">
                    {merge !== null ? (
                      <span data-testid="pr-inbox-merge" data-value={row.mergeStateStatus ?? undefined}>
                        <FactChip label={merge.label} tone={merge.tone} />
                      </span>
                    ) : (
                      <span className="w-pr-inbox-muted">Unknown</span>
                    )}
                  </Fact>
                  <Fact name="Size">
                    <Size row={row} />
                  </Fact>
                </div>
                <div className="w-pr-inbox-row__actions">
                  <ExternalLink url={row.url} className="w-pr-inbox-button w-pr-inbox-button--link" testId="pr-inbox-open-github">
                    Open on GitHub
                  </ExternalLink>
                  <span style={{ flex: 1 }} />
                  {action?.kind === 'draft-replies' ? null : <DraftRepliesButton projectId={projectId} repo={row.repo} number={row.number} readOnly={readOnly} />}
                  <button type="button" className="w-pr-inbox-button" disabled={row.newSinceSeen === 0 || readOnly !== null} title={readOnly ?? undefined} onClick={onMarkSeen}>
                    Mark seen
                  </button>
                </div>
                <h4 className="w-pr-inbox-threads-head">
                  Threads
                  <span className="w-pr-inbox-threads-head__count w-mono" data-testid="pr-inbox-thread-count">
                    {open} open · {resolved} resolved
                  </span>
                  <span style={{ flex: 1 }} />
                  {single ? null : (
                    <span className="w-pr-inbox-threads-head__keys" data-testid="pr-inbox-keys-hint" aria-hidden="true">
                      <kbd>↑</kbd>
                      <kbd>↓</kbd> next PR
                    </span>
                  )}
                </h4>
                <RowThreads row={row} now={now} render={render ?? undefined} drafts={drafts} />
              </>
            )
          }}
        </PrDrafts>
      </div>
    </article>
  )
}

// ── the view ─────────────────────────────────────────────────────────────────

export interface PrInboxBodyProps {
  name: string
  snapshot: PrInboxSnapshot
  tickets: readonly Ticket[]
  now: number
  /** The key (`rowKey`) of the PR the user selected; null or a PR the snapshot no longer holds — the view picks one. */
  selected: string | null
  /** The group a sidebar row asked for: marked and scrolled into sight. */
  focusedGroup: PrInboxGroup | null
  /** A PR an entry asked for that the inbox does not hold. */
  missing: PullRef | null
  /** Why "Mark seen" failed, shown in the status line. */
  failure: string | null
  readOnly: string | null
  onSelect: (row: PrInboxRow) => void
  onMarkSeen: (row: PrInboxRow) => void
}

/** The view over one snapshot, without IPC. */
export function PrInboxBody({ name, snapshot, tickets, now, selected, focusedGroup, missing, failure, readOnly, onSelect, onMarkSeen }: PrInboxBodyProps) {
  const status = statusLines(snapshot, now)
  const groups = listedGroups(snapshot)
  const empty = snapshot.readAt !== null && groups.length === 0
  const shown = shownKey(snapshot, selected)
  const order = listOrder(snapshot)
  const current = shown === null ? undefined : order.find(({ row }) => rowKey(row) === shown)
  return (
    <div className="w-pr-inbox" data-testid="pr-inbox-view" data-project={snapshot.projectId}>
      <header className="w-pr-inbox__head">
        <h2 className="w-pr-inbox__heading">{name}</h2>
        <p role="status" className="w-pr-inbox__status" data-testid="pr-inbox-status">
          {!snapshot.enabled ? (
            <span data-testid="pr-inbox-off">Pull requests are not read for this Project: reading is off in Project settings, or none of its repositories is on GitHub.</span>
          ) : snapshot.readAt === null && status.error === null ? (
            <span>Reading pull requests…</span>
          ) : null}
          {status.next !== null ? (
            <span className="w-pr-inbox__next" data-testid="pr-inbox-next" title={snapshot.nextSearchAt === null ? undefined : new Date(snapshot.nextSearchAt).toLocaleString()}>
              {status.next}
            </span>
          ) : null}
          {status.error !== null ? (
            <span className="w-pr-inbox__status-error" data-testid="pr-inbox-error">
              {status.error}
            </span>
          ) : null}
          {status.notice !== null ? <span data-testid="pr-inbox-notice">{status.notice}</span> : null}
          {failure !== null ? (
            <span className="w-pr-inbox__status-error" data-testid="pr-inbox-seen-failure">
              {failure}
            </span>
          ) : null}
        </p>
      </header>
      {missing !== null ? (
        <p role="alert" className="w-pr-inbox__missing" data-testid="pr-inbox-missing">
          This pull request is not in the inbox: {missing.repo}#{missing.number}
        </p>
      ) : null}
      {snapshot.enabled && empty ? (
        <div className="w-pr-inbox-empty" data-testid="pr-inbox-empty">
          <span className="w-pr-inbox-empty__icon">
            <Icon name="check" />
          </span>
          <p className="w-pr-inbox-empty__title">No open pull requests and no review requests.</p>
          <p className="w-pr-inbox-empty__text">Your open pull requests and the reviews asked of you in this Project&apos;s repositories show here after a search.</p>
        </div>
      ) : null}
      {snapshot.enabled && groups.length > 0 ? (
        <div className="w-pr-inbox__panes">
          <nav className="w-pr-inbox-list" aria-label="Pull requests of the Project" data-testid="pr-inbox-list">
            {groups.map(({ group, rows }) => (
              <section
                key={group}
                className="w-pr-inbox-group"
                data-testid="pr-inbox-group"
                data-group={group}
                data-focused={focusedGroup === group ? 'true' : undefined}
                aria-label={PR_INBOX_GROUP_TITLES[group]}
              >
                <h3 className="w-pr-inbox-group__title">
                  <span className="w-pr-inbox-group__dot" aria-hidden="true" />
                  <span data-testid="pr-inbox-group-title">{PR_INBOX_GROUP_TITLES[group]}</span>
                  <span className="w-pr-inbox-group__count w-mono" data-testid="pr-inbox-group-count">
                    {rows.length}
                  </span>
                </h3>
                <ul className="w-pr-inbox-group__rows">
                  {rows.map((row) => (
                    <PrListItem
                      key={rowKey(row)}
                      group={group}
                      row={row}
                      ticket={ticketOfRow(row, tickets)}
                      viewer={snapshot.viewer}
                      now={now}
                      selected={shown === rowKey(row)}
                      onSelect={() => onSelect(row)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          {current !== undefined ? (
            // Keyed by the PR: another one starts with its own drafts, typed texts and scroll.
            <PrPane
              key={rowKey(current.row)}
              projectId={snapshot.projectId}
              group={current.group}
              row={current.row}
              ticket={ticketOfRow(current.row, tickets)}
              viewer={snapshot.viewer}
              now={now}
              readOnly={readOnly}
              single={order.length === 1}
              onMarkSeen={() => onMarkSeen(current.row)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const EMPTY_TICKETS: readonly Ticket[] = []

export interface PrInboxViewProps {
  /** The active Project; undefined while there is none. */
  project: Pick<ProjectView, 'id' | 'name' | 'path'> | undefined
}

/** The Pull requests view of one Project, kept current by main. */
export function PrInboxView({ project }: PrInboxViewProps) {
  if (project === undefined) return <p className="w-pr-inbox__message w-pr-inbox__message--padded">No project</p>
  // Keyed by the Project: another one starts with its own selection.
  return <ProjectPrInbox key={project.id} project={project} />
}

/** Whether ↑ or ↓ of this event is the view's: the view is shown, no field, menu or dialog has the key, no modifier. */
function listKey(event: KeyboardEvent, frame: HTMLElement | null): 1 | -1 | null {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return null
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  // The views of the shell stay mounted and hidden: only the shown one takes keys.
  if (frame === null || frame.closest('[hidden]') !== null) return null
  const target = event.target
  if (target instanceof Element && target !== document.body && target !== document.documentElement && !frame.contains(target)) return null
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, input, select, [role="dialog"], [role="menu"], [role="listbox"]') !== null)) return null
  return event.key === 'ArrowDown' ? 1 : -1
}

function ProjectPrInbox({ project }: { project: Pick<ProjectView, 'id' | 'name' | 'path'> }) {
  const { snapshot, error } = usePrInbox(project.id)
  const { model } = useWorkflow(project.path)
  const now = useNow()
  const readOnly = useReadOnly()
  const focus = usePrInboxFocus((store) => store.focus)
  const [selected, setSelected] = useState<string | null>(null)
  // The last ask of an entry (open.ts) this view took: a PR to select, or a group to show.
  const [taken, setTaken] = useState<PrInboxFocus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  /** A key moved the selection: the list follows it, and the focus too when it was on the list. */
  const moved = useRef(false)

  const markSeen = (row: PrInboxRow): void => {
    if (readOnly !== null) return
    void markPullSeen(project.id, row.repo, row.number).then((refused) => setFailure(refused === undefined ? null : `Mark seen failed: ${readableReason(refused)}`))
  }

  /** The user chose this PR: the pane shows it, and main hears it was seen. */
  const select = (row: PrInboxRow): void => {
    setSelected(rowKey(row))
    markSeen(row)
  }

  // An ask for this Project is taken once its snapshot is there: the asked PR is selected; an asked group gets its first PR.
  let pick = selected
  if (focus !== null && focus.projectId === project.id && snapshot !== undefined && focus.seq !== taken?.seq) {
    setTaken(focus)
    const found = focus.pr === null ? null : findRow(snapshot, focus.pr)
    const first = focus.pr === null && focus.group !== null ? listedGroups(snapshot).find(({ group }) => group === focus.group)?.rows[0] : undefined
    if (found !== null) pick = rowKey(found.row)
    else if (first !== undefined) pick = rowKey(first)
  }
  // The view's own pick is made once — on the first snapshot with PRs, or when the selected PR leaves it — and then
  // kept: a later snapshot that reorders the groups does not move the pane off a PR whose draft is being typed.
  // It does not mark the PR seen; only the user's click, key or entry does.
  if (snapshot !== undefined && snapshot.enabled) pick = shownKey(snapshot, pick)
  if (pick !== selected) setSelected(pick)
  const takenRow = taken?.pr == null || snapshot === undefined ? null : findRow(snapshot, taken.pr)
  const missing = taken?.pr != null && snapshot !== undefined && takenRow === null ? taken.pr : null
  const focusedGroup = taken !== null && taken.pr === null ? taken.group : null

  // After an ask is taken: it is cleared, so the view coming back does not take it again; the PR is marked
  // seen, as a click on it does, and what was asked for is scrolled into sight.
  const takenSeq = taken?.seq
  useEffect(() => {
    if (taken === null) return
    if (usePrInboxFocus.getState().focus?.seq === taken.seq) usePrInboxFocus.setState({ focus: null })
    if (takenRow !== null) markSeen(takenRow.row)
    const selector =
      takenRow !== null
        ? `[data-testid="pr-inbox-row"][data-repo="${CSS.escape(takenRow.row.repo)}"][data-number="${takenRow.row.number}"]`
        : taken.pr === null && taken.group !== null
          ? `[data-testid="pr-inbox-group"][data-group="${taken.group}"]`
          : null
    // jsdom has no scrollIntoView.
    if (selector !== null) root.current?.querySelector(selector)?.scrollIntoView?.({ block: 'nearest' })
    // Once per ask: the row and the read-only hint are those of the render that took it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takenSeq])

  // ↑ and ↓ move the selection along the list, from anywhere in the shown view but a field.
  // The handler is bound once; it moves along the order of the last render.
  const move = useRef<(step: 1 | -1) => void>(() => undefined)
  useEffect(() => {
    move.current = (step) => {
      if (snapshot === undefined || !snapshot.enabled) return
      const order = listOrder(snapshot)
      const shown = shownKey(snapshot, selected)
      const at = order.findIndex(({ row }) => rowKey(row) === shown)
      const next = order[Math.max(0, Math.min(order.length - 1, at + step))]
      if (next === undefined || rowKey(next.row) === shown) return
      moved.current = true
      select(next.row)
    }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const step = listKey(event, root.current)
      if (step === null) return
      event.preventDefault()
      move.current(step)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!moved.current || selected === null) return
    moved.current = false
    const item = root.current?.querySelector<HTMLElement>(`[data-testid="pr-inbox-row"][data-selected="true"]`)
    item?.scrollIntoView?.({ block: 'nearest' })
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-testid="pr-inbox-list"]') !== null) item?.querySelector('button')?.focus()
  }, [selected])

  let content: ReactNode
  if (error !== undefined && snapshot === undefined)
    content = (
      <p role="alert" className="w-pr-inbox__message w-pr-inbox__message--padded">
        Pull requests could not be read: {readableReason(error)}
      </p>
    )
  else if (snapshot === undefined) content = <p className="w-pr-inbox__message w-pr-inbox__message--padded">Reading pull requests…</p>
  else
    content = (
      <PrInboxBody
        name={project.name}
        snapshot={snapshot}
        tickets={model?.tickets ?? EMPTY_TICKETS}
        now={now}
        selected={selected}
        focusedGroup={focusedGroup}
        missing={missing}
        failure={failure}
        readOnly={readOnly}
        onSelect={select}
        onMarkSeen={markSeen}
      />
    )
  return (
    <div ref={root} className="w-pr-inbox__frame">
      {content}
    </div>
  )
}

/** The view of the window: the Pull requests of the active Project. */
export function PullRequestsView() {
  return <PrInboxView project={activeProject(useProjects())} />
}
