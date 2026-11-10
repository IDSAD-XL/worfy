// The Pull requests view (worfy-pr-inbox ticket 03): the PR inbox of the active Project — the user's open
// PRs and the review requests to the user in the Project's repositories — in five groups by whose move it
// is, as main computes them (src/main/github/inbox-groups.ts). A row opens to the review threads with their
// last comments and a link to the code line on GitHub. Opening a row and "Mark seen" tell main the user has
// seen the PR (`prInbox.markSeen`); nothing here writes to GitHub (ADR-0105). Links open in the system's
// browser (`shell.openExternal`).
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { PR_INBOX_GROUP_TITLES, type PrInboxComment, type PrInboxGroup, type PrInboxRow, type PrInboxSnapshot, type PrInboxThread } from '../../shared/ipc/pr-inbox'
import type { ProjectView } from '../../shared/ipc/projects'
import type { Ticket } from '../../shared/workflow/types'
import { invoke, readableReason } from '../ipc'
import { useNow } from '../limits/useLimits'
import { ticketRef } from '../pipeline/board'
import { activeProject, useProjects, useReadOnly } from '../projects/useProjects'
import { StatusChip } from '../theme/primitives'
import { useWorkflow } from '../workflow/useWorkflow'
import {
  ageOf,
  ageText,
  findRow,
  markPullSeen,
  newText,
  orderedGroups,
  reviewText,
  rowKey,
  statusLines,
  threadsText,
  ticketOfRow,
  usePrInbox,
  usePrInboxFocus,
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

const CI_TEXT = { passing: 'CI passing', failing: 'CI failing', running: 'CI running' } as const

function CiDot({ ci }: { ci: PrInboxRow['ci'] }) {
  const text = ci === null ? 'No CI' : CI_TEXT[ci]
  return <span className="w-pr-inbox-ci" data-testid="pr-inbox-ci" data-ci={ci ?? 'none'} role="img" aria-label={text} title={text} />
}

function Comment({ comment, now }: { comment: PrInboxComment; now: number }) {
  return (
    <li className="w-pr-inbox-comment" data-testid="pr-inbox-comment">
      <span className="w-pr-inbox-comment__meta">
        <span className="w-pr-inbox-comment__author">{comment.author ?? 'ghost'}</span>
        <span title={new Date(comment.createdAt).toLocaleString()}>{ageText(comment.createdAt, now)}</span>
      </span>
      <p className="w-pr-inbox-comment__body">{comment.body}</p>
    </li>
  )
}

function Thread({ thread, now }: { thread: PrInboxThread; now: number }) {
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
          <Comment key={comment.id} comment={comment} now={now} />
        ))}
      </ul>
    </li>
  )
}

export interface PrRowProps {
  group: PrInboxGroup
  row: PrInboxRow
  ticket: Ticket | undefined
  now: number
  expanded: boolean
  /** The read-only hint of a Linked machine's screen: "Mark seen" is off with it. */
  readOnly: string | null
  onToggle: () => void
  onMarkSeen: () => void
}

/** One PR: a line to open it, and, open, its threads, the conversation's last comments and the links. */
export function PrRow({ group, row, ticket, now, expanded, readOnly, onToggle, onMarkSeen }: PrRowProps) {
  const review = reviewText(row.reviewDecision)
  const threads = threadsText(row.unresolvedThreads)
  const fresh = newText(row.newSinceSeen)
  const age = ageOf(group, row)
  const bodyId = `pr-inbox-body-${rowKey(row)}`
  // Open threads first, each kind in GitHub's order.
  const threadList = [...row.threads.filter((thread) => !thread.isResolved), ...row.threads.filter((thread) => thread.isResolved)]
  return (
    <li className="w-pr-inbox-row" data-testid="pr-inbox-row" data-repo={row.repo} data-number={row.number} data-expanded={expanded ? 'true' : undefined}>
      <button type="button" className="w-pr-inbox-row__head" aria-expanded={expanded} aria-controls={expanded ? bodyId : undefined} onClick={onToggle}>
        <span className="w-pr-inbox-row__line">
          <CiDot ci={row.ci} />
          <span className="w-pr-inbox-row__title" data-testid="pr-inbox-title">
            {row.title}
          </span>
          {row.isDraft ? <span className="w-pr-inbox-flag">Draft</span> : null}
          <span className="w-pr-inbox-row__age" data-testid="pr-inbox-age" title={new Date(age).toLocaleString()}>
            {ageText(age, now)}
          </span>
        </span>
        <span className="w-pr-inbox-row__line w-pr-inbox-row__facts">
          <span className="w-pr-inbox-row__ref w-mono" data-testid="pr-inbox-ref">
            {row.repo}#{row.number}
          </span>
          {ticket !== undefined ? (
            <span className="w-chip w-chip--open w-mono" data-testid="pr-inbox-ticket" title={ticket.title}>
              {ticketRef(ticket)}
            </span>
          ) : null}
          {review !== null ? (
            <span data-testid="pr-inbox-review" data-value={row.reviewDecision ?? undefined}>
              {review.status === null ? <span className="w-chip w-chip--open">{review.label}</span> : <StatusChip status={review.status} label={review.label} />}
            </span>
          ) : null}
          {threads !== null ? (
            <span className="w-pr-inbox-row__count" data-testid="pr-inbox-threads">
              {threads}
            </span>
          ) : null}
          {fresh !== null ? (
            <span className="w-pr-inbox-flag w-pr-inbox-flag--new" data-testid="pr-inbox-new">
              {fresh}
            </span>
          ) : null}
          {row.viaTeam ? (
            <span className="w-pr-inbox-flag" data-testid="pr-inbox-via-team" title="The review is asked of a team you are in">
              via team
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className="w-pr-inbox-row__body" id={bodyId} data-testid="pr-inbox-body">
          <div className="w-pr-inbox-row__actions">
            <ExternalLink url={row.url} className="w-pr-inbox-link" testId="pr-inbox-open-github">
              Open on GitHub
            </ExternalLink>
            <span className="w-pr-inbox-row__branch w-mono" title={row.headRefName}>
              {row.headRefName}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="w-pr-inbox-button" disabled={row.newSinceSeen === 0 || readOnly !== null} title={readOnly ?? undefined} onClick={onMarkSeen}>
              Mark seen
            </button>
          </div>
          {threadList.length > 0 ? (
            <ul className="w-pr-inbox-threads" aria-label="Review threads">
              {threadList.map((thread) => (
                <Thread key={thread.id} thread={thread} now={now} />
              ))}
            </ul>
          ) : (
            <p className="w-pr-inbox__message">No review threads.</p>
          )}
          {row.comments.length > 0 ? (
            <section className="w-pr-inbox-conversation" aria-label="Conversation">
              <h4 className="w-pr-inbox-conversation__title">Conversation</h4>
              <ul className="w-pr-inbox-comments">
                {row.comments.map((comment) => (
                  <Comment key={comment.id} comment={comment} now={now} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export interface PrInboxBodyProps {
  name: string
  snapshot: PrInboxSnapshot
  tickets: readonly Ticket[]
  now: number
  expanded: ReadonlySet<string>
  /** The group a sidebar row asked for: marked and scrolled into sight. */
  focusedGroup: PrInboxGroup | null
  /** A PR an entry asked for that the inbox does not hold. */
  missing: PullRef | null
  /** Why "Mark seen" failed, shown in the status line. */
  failure: string | null
  readOnly: string | null
  onToggle: (row: PrInboxRow) => void
  onMarkSeen: (row: PrInboxRow) => void
}

/** The view over one snapshot, without IPC. */
export function PrInboxBody({ name, snapshot, tickets, now, expanded, focusedGroup, missing, failure, readOnly, onToggle, onMarkSeen }: PrInboxBodyProps) {
  const status = statusLines(snapshot, now)
  const groups = orderedGroups(snapshot)
  const empty = snapshot.readAt !== null && groups.every(({ rows }) => rows.length === 0)
  return (
    <div className="w-pr-inbox" data-testid="pr-inbox-view" data-project={snapshot.projectId}>
      <h2 className="w-pr-inbox__heading">{name}</h2>
      <p role="status" className="w-pr-inbox__status" data-testid="pr-inbox-status">
        {!snapshot.enabled ? (
          <span data-testid="pr-inbox-off">Pull requests are not read for this Project: reading is off in Project settings, or none of its repositories is on GitHub.</span>
        ) : snapshot.readAt === null && status.error === null ? (
          <span>Reading pull requests…</span>
        ) : null}
        {status.next !== null ? (
          <span data-testid="pr-inbox-next" title={snapshot.nextSearchAt === null ? undefined : new Date(snapshot.nextSearchAt).toLocaleString()}>
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
      {missing !== null ? (
        <p role="alert" className="w-pr-inbox__missing" data-testid="pr-inbox-missing">
          This pull request is not in the inbox: {missing.repo}#{missing.number}
        </p>
      ) : null}
      {snapshot.enabled ? (
        <div className="w-pr-inbox__groups">
          {empty ? <p className="w-pr-inbox__message">No open pull requests and no review requests.</p> : null}
          {groups.map(({ group, rows }) => (
            <section key={group} className="w-pr-inbox-group" data-testid="pr-inbox-group" data-group={group} data-focused={focusedGroup === group ? 'true' : undefined} aria-label={PR_INBOX_GROUP_TITLES[group]}>
              <header className="w-pr-inbox-group__header">
                <h3 className="w-pr-inbox-group__title" data-testid="pr-inbox-group-title">
                  {PR_INBOX_GROUP_TITLES[group]}
                </h3>
                <span className="w-pr-inbox-group__count w-mono" data-testid="pr-inbox-group-count">
                  {rows.length}
                </span>
              </header>
              {rows.length > 0 ? (
                <ul className="w-pr-inbox-group__rows">
                  {rows.map((row) => (
                    <PrRow
                      key={rowKey(row)}
                      group={group}
                      row={row}
                      ticket={ticketOfRow(row, tickets)}
                      now={now}
                      expanded={expanded.has(rowKey(row))}
                      readOnly={readOnly}
                      onToggle={() => onToggle(row)}
                      onMarkSeen={() => onMarkSeen(row)}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
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
  // Keyed by the Project: another one starts with its rows closed.
  return <ProjectPrInbox key={project.id} project={project} />
}

function ProjectPrInbox({ project }: { project: Pick<ProjectView, 'id' | 'name' | 'path'> }) {
  const { snapshot, error } = usePrInbox(project.id)
  const { model } = useWorkflow(project.path)
  const now = useNow()
  const readOnly = useReadOnly()
  const focus = usePrInboxFocus((store) => store.focus)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // The last ask of an entry (open.ts) this view took: a PR to open, or a group to show.
  const [taken, setTaken] = useState<PrInboxFocus | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const markSeen = (row: PrInboxRow): void => {
    if (readOnly !== null) return
    void markPullSeen(project.id, row.repo, row.number).then((refused) => setFailure(refused === undefined ? null : `Mark seen failed: ${readableReason(refused)}`))
  }

  const toggle = (row: PrInboxRow): void => {
    const key = rowKey(row)
    const opening = !expanded.has(key)
    setExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(key)
      else next.delete(key)
      return next
    })
    if (opening) markSeen(row)
  }

  // An ask for this Project is taken once its snapshot is there: the asked PR's row opens.
  if (focus !== null && focus.projectId === project.id && snapshot !== undefined && focus.seq !== taken?.seq) {
    setTaken(focus)
    const found = focus.pr === null ? null : findRow(snapshot, focus.pr)
    if (found !== null) setExpanded(new Set(expanded).add(rowKey(found.row)))
  }
  const takenRow = taken?.pr == null || snapshot === undefined ? null : findRow(snapshot, taken.pr)
  const missing = taken?.pr != null && snapshot !== undefined && takenRow === null ? taken.pr : null
  const focusedGroup = taken !== null && taken.pr === null ? taken.group : null

  // After an ask is taken: it is cleared, so the view coming back does not take it again; the PR is marked
  // seen, as a click on its row does, and what was asked for is scrolled into sight.
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
        expanded={expanded}
        focusedGroup={focusedGroup}
        missing={missing}
        failure={failure}
        readOnly={readOnly}
        onToggle={toggle}
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
