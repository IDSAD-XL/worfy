// Review mode (worfy-pr-review ticket 09; spec, implementation decisions, 5): the review of one pull request in place of
// the PR pane of the Pull requests view. Start review (StartReviewMenu.tsx) opens it; the list folds into a column of
// 48 px beside it (PrInboxView.tsx), which `← Results` / `← Inbox` and a second Escape give back. The draft stays.
//
// - The head: base ← head, the head commit, the files with their lines added and deleted, the approvals chip, Viewed
//   N/M, Refresh and Close. Under it the diff of Changes with the subject `pr` (ticket 06): its tree and its diff, the
//   review threads of GitHub on their lines, and on each file of the tree its threads and comments counted.
// - The draft (ticket 07) is created on the PR's head at Start review (`prReview.start`), with the files the account
//   marked Viewed on github.com, read once (Q3 (a)). Viewed is a mark at the blob of the file's new side: a new blob in a
//   later head shows the file not Viewed again, by itself.
// - The comments of the draft stand on their lines while the diff shown is the commit they are numbered on (`anchoredOn`,
//   else `startedOn`: draftCommitOf). The head moved past it — «N new commits since you started · Show new commits»;
//   the comments are then listed above the diff with their lines, and Show new commits shows the diff since that commit
//   (Since my review). Submit sends that same commit (ticket 11), so a comment's line and the commit it goes on agree.
// - Read again on entering, by Refresh, at the window's focus when the last read is older than REVIEW_STALE_MS, and
//   every REVIEW_REFRESH_MS while Review mode is shown and the window has the focus (`onRefresh` reads the PR).
// - Agent review (ticket 08): Start review → Agent review starts the Session at once (`prReview.agentReview`); its
//   comments come as it writes them (`prReview.changed`). The bar at the bottom: «Agent is writing the review… · Stop»
//   with Take over while it writes, Take over on the agent's draft after it, Ask the agent to add comments on the
//   person's (`fill: 'add'`). Stop and Take over both stop the Session (`prReview.stopAgent`).
// - Keys: j / k and ↓ / ↑ — the next and the previous file, n / p — hunks, v — Viewed of the file; Escape closes a menu
//   first (the kit marks it handled), then Review mode.
// - A Linked machine (read-only access or not): the draft lives on the Machine of the Project, so Review mode shows the
//   diff and the threads only — no Viewed, no draft, no bar.
// - Which PR, its file and Show new commits live in the store of the view (useReviewMode): another tab and back keeps them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChangesPrRef, ChangesScope, DiffLine } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
// The channels must be declared in this window too: a `project` channel goes to the Machine of the Project (ipc.ts).
import '../../shared/ipc/changes'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import '../../shared/ipc/pr-review'
import { REVIEW_FILES_MAX, type ReviewComment, type ReviewDraft } from '../../shared/ipc/pr-review'
import { DiffPane, type DiffPaneHandle, type LineSide } from '../changes/DiffPane'
import { orderedFiles, type DiffLayout, type FileEntry, type RepoFiles } from '../changes/diff-window'
import { FileTree } from '../changes/FileTree'
import '../changes/changes.css'
import { invoke, subscribe } from '../ipc'
import { ApprovalsChip } from '../pr-inbox/ApprovalsChip'
import { CommentBody } from '../pr-inbox/CommentBody'
import { layerOf } from '../theme/open-layers'
import { ToggleGroup, ToggleGroupItem } from '../theme/kit/ToggleGroup'
import { closeReviewMode, draftCommitOf, isViewed, plural, REVIEW_REFRESH_MS, REVIEW_STALE_MS, reviewOpenOn, sameCommit, short, useReviewMode, viewedBlobOf } from './review-store'
import './pr-review.css'

/** The comment stands under this line: its last line, on its side. Inline draws a context line once, on the new side. */
function commentOnLine(comment: ReviewComment, line: DiffLine, side: LineSide, layout: DiffLayout): boolean {
  if (comment.side === 'RIGHT') return side === 'new' && line.kind !== 'del' && line.newLine === comment.line
  return line.kind !== 'add' && line.oldLine === comment.line && (side === 'old' || (layout === 'inline' && line.kind === 'context'))
}

/** Input types that take no text: a key pressed on one (Viewed, Wrap, Hide whitespace) is Review mode's. */
const NO_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Whether the keys belong to a field the person types in. */
function typingIn(target: HTMLElement): boolean {
  if (target.isContentEditable || target.closest('textarea, select') !== null) return true
  const input = target.closest('input')
  return input !== null && !NO_TEXT.has(input.type)
}

type Read<T> ={ of: string; value: T; error: null } | { of: string; value: null; error: string }

/** A comment of the draft as Review mode shows it; Ticket 10 gives it Edit and Delete. */
function DraftComment({ comment, by, repo, where }: { comment: ReviewComment; by: 'person' | 'agent'; repo: string; where?: string }) {
  return (
    <div className={`w-pr-review-comment${by === 'agent' ? ' is-agent' : ''}`} data-testid="pr-review-comment" data-by={by} data-path={comment.path} data-line={comment.line}>
      <div className="w-pr-review-comment__head">
        {by === 'agent' ? <span className="w-pr-review-flag w-pr-review-flag--agent">Written by the agent</span> : <span className="w-pr-review-flag">Pending</span>}
        {where !== undefined ? <span className="w-mono">{where}</span> : comment.start_line !== undefined ? <span className="w-mono w-changes__muted">lines {comment.start_line}–{comment.line}</span> : null}
        <span className="w-changes__spacer" />
        <span className="w-changes__muted">not on GitHub yet</span>
      </div>
      <CommentBody body={comment.body} repo={repo} />
    </div>
  )
}

export interface ReviewModeProps {
  projectId: string
  row: PrInboxRow
  /** Non-null in a window of a Linked machine (reviewAway): the draft is out of reach, Review mode only reads. */
  readOnly: string | null
  /** Reads the PR again (its head, threads, approvals). */
  onRefresh: () => void
}

export function ReviewMode({ projectId, row, readOnly, onRefresh }: ReviewModeProps) {
  const open = useReviewMode((store) => store.open)
  const chosen = useReviewMode((store) => store.file)
  const since = useReviewMode((store) => store.since)
  const local = readOnly === null && open?.readOnly !== true
  const { repo, number } = row
  const subject = useMemo<ChangesPrRef | null>(
    () => (row.headRefOid !== null && row.baseRefOid !== undefined ? { kind: 'pr', repo, number, headOid: row.headRefOid, baseOid: row.baseRefOid } : null),
    [repo, number, row.headRefOid, row.baseRefOid],
  )

  // ── the draft ──
  const [draftRead, setDraftRead] = useState<{ draft: ReviewDraft | null; problem: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const readDraft = useCallback(() => {
    void invoke('prReview.draft', { projectId, repo, number }).then((answer) => {
      if (answer.ok) setDraftRead({ draft: answer.value.draft, problem: answer.value.problem })
      else setDraftRead({ draft: null, problem: failureReason('prReview.draft', answer.error) })
    })
  }, [projectId, repo, number])
  useEffect(() => {
    if (!local) return
    readDraft()
    // An Agent review writes the draft: each change of the file comes as `prReview.changed`.
    return subscribe('prReview.changed', (payload) => {
      if (payload.projectId === projectId && payload.repo.toLowerCase() === repo.toLowerCase() && payload.number === number) readDraft()
    })
  }, [local, readDraft, projectId, repo, number])
  const draft = local ? (draftRead?.draft ?? null) : null
  const draftCommit = draft === null ? null : draftCommitOf(draft)
  const moved = draftCommit !== null && subject !== null && !sameCommit(draftCommit, subject.headOid)
  const scope: ChangesScope = since && moved && draftCommit !== null ? { kind: 'compare', repo, ref: draftCommit } : { kind: 'all' }

  // ── the files ──
  const [layout, setLayout] = useState<DiffLayout>('inline')
  const [wrap, setWrap] = useState(false)
  const [hideWhitespace, setHideWhitespace] = useState(false)
  const [filter, setFilter] = useState('')
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [generation, setGeneration] = useState(0)
  const listFor = JSON.stringify([projectId, subject, scope, hideWhitespace, generation])
  const [listRead, setListRead] = useState<Read<{ repos: RepoFiles[]; truncatedAt: number | null; additions: number; deletions: number }> | null>(null)
  useEffect(() => {
    if (subject === null) return
    const of = listFor
    let current = true
    void invoke('changes.list', { projectId, subject, scope, hideWhitespace }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setListRead({ of, value: null, error: failureReason('changes.list', result.error) })
        return
      }
      const repos = result.value.repos.map((each) => ({ repo: each.repo, files: each.files, error: each.error }))
      const first = result.value.repos[0]
      setListRead({ of, value: { repos, truncatedAt: first?.truncatedAt ?? null, additions: first?.additions ?? 0, deletions: first?.deletions ?? 0 }, error: null })
    })
    return () => {
      current = false
    }
    // `scope` and `subject` are in `listFor`; the read starts again only when the key does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFor])
  const list = listRead?.of === listFor ? listRead : null
  const repos = useMemo(() => list?.value?.repos ?? [], [list])
  const entries = useMemo(() => orderedFiles(repos, filter, workflowOpen), [repos, filter, workflowOpen])
  const allEntries = useMemo(() => orderedFiles(repos, '', true), [repos])

  // ── Start review: the draft on the head, the marks of github.com; then the Session of an Agent review ──
  const started = useRef(false)
  // The files of the head, read without an error: a failed read (5xx, rate limit) would start the draft without the
  // marks of github.com, and a draft that exists is never started again. Refresh reads the files again.
  const filesRead = list !== null && list.value !== null && scope.kind === 'all' && list.value.repos.every((each) => each.error === null)
  useEffect(() => {
    if (!local || subject === null || !filesRead || started.current) return
    started.current = true
    // A draft keeps marks for at most REVIEW_FILES_MAX files (GitHub lists no more; local git may).
    const files = allEntries.slice(0, REVIEW_FILES_MAX).map((entry) => ({ path: entry.file.path, blob: viewedBlobOf(entry) }))
    void invoke('prReview.start', { projectId, repo, number, head: subject.headOid, files }).then((answer) => {
      if (!answer.ok) {
        setNotice(failureReason('prReview.start', answer.error))
        return
      }
      setDraftRead({ draft: answer.value.draft, problem: answer.value.problem })
      const asked = useReviewMode.getState().open
      if (asked === null || !asked.agentAsked || !reviewOpenOn(asked, projectId, row)) return
      useReviewMode.setState({ open: { ...asked, agentAsked: false } })
      void invoke('prReview.agentReview', { projectId, repo, number, head: subject.headOid, fill: 'new' }).then((agent) => {
        if (!agent.ok) setNotice(failureReason('prReview.agentReview', agent.error))
        readDraft()
      })
    })
  }, [local, subject, filesRead, allEntries, projectId, repo, number, row, readDraft])

  // ── the commits since the draft's ──
  const [newCommits, setNewCommits] = useState<{ of: string; count: number | null } | null>(null)
  const commitsFor = moved && subject !== null && draftCommit !== null ? JSON.stringify([projectId, subject, draftCommit, generation]) : null
  useEffect(() => {
    if (commitsFor === null || subject === null || draftCommit === null) return
    let current = true
    void invoke('changes.commits', { projectId, subject, repo }).then((result) => {
      if (!current) return
      const commits = result.ok ? result.value.commits : []
      const at = commits.findIndex((commit) => sameCommit(commit.sha, draftCommit))
      setNewCommits({ of: commitsFor, count: at < 0 ? null : commits.length - 1 - at })
    })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitsFor])
  const newCount = newCommits?.of === commitsFor ? newCommits.count : null

  // ── the file, the keys ──
  const pane = useRef<DiffPaneHandle>(null)
  const root = useRef<HTMLElement>(null)
  const select = useCallback((key: string) => {
    useReviewMode.setState({ file: key })
    pane.current?.scrollToFile(key)
  }, [])
  // Back from another tab or PR: the file chosen before, once its files are read.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || entries.length === 0) return
    placed.current = true
    if (chosen !== null && entries.some((entry) => entry.key === chosen)) pane.current?.scrollToFile(chosen)
  }, [entries, chosen])

  const toggleViewed = useCallback(
    (entry: FileEntry) => {
      // Before Start review created the draft a mark would create it, and Start review would then skip the marks of github.com.
      if (!local || subject === null || draft === null) return
      const blob = isViewed(draft, entry) ? null : viewedBlobOf(entry)
      void invoke('prReview.setViewed', { projectId, repo, number, head: subject.headOid, path: entry.file.path, blob }).then((answer) => {
        if (!answer.ok) setNotice(failureReason('prReview.setViewed', answer.error))
        else if (answer.value.draft !== null) setDraftRead({ draft: answer.value.draft, problem: answer.value.problem })
      })
    },
    [local, subject, draft, projectId, repo, number],
  )

  const latest = useRef({ entries, chosen, select, toggleViewed })
  useEffect(() => {
    latest.current = { entries, chosen, select, toggleViewed }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const frame = root.current
      // The views of the shell stay mounted and hidden: only the shown one takes keys.
      if (frame === null || frame.closest('[hidden]') !== null) return
      const target = event.target
      if (target instanceof HTMLElement && (typingIn(target) || layerOf(target) !== null)) return
      const { entries: files, chosen: at, select: go, toggleViewed: mark } = latest.current
      if (event.key === 'Escape') {
        event.preventDefault()
        closeReviewMode()
        return
      }
      if (event.shiftKey) return
      if (event.key === 'n' || event.key === 'p') {
        event.preventDefault()
        pane.current?.moveHunk(event.key === 'n' ? 1 : -1)
        return
      }
      const index = files.findIndex((entry) => entry.key === at)
      if (event.key === 'v') {
        const entry = files[index < 0 ? 0 : index]
        if (entry === undefined) return
        event.preventDefault()
        mark(entry)
        return
      }
      const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0
      if (step === 0 || files.length === 0) return
      event.preventDefault()
      const next = step === 1 ? Math.min(files.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1)
      go(files[next]!.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── reading the PR again ──
  const lastRead = useRef(0)
  const refreshNow = useCallback(() => {
    lastRead.current = Date.now()
    onRefresh()
  }, [onRefresh])
  const refreshLatest = useRef(refreshNow)
  useEffect(() => {
    refreshLatest.current = refreshNow
  })
  useEffect(() => {
    refreshLatest.current()
    const shown = (): boolean => root.current !== null && root.current.closest('[hidden]') === null
    const onFocus = (): void => {
      if (shown() && Date.now() - lastRead.current > REVIEW_STALE_MS) refreshLatest.current()
    }
    const timer = setInterval(() => {
      if (shown() && document.hasFocus()) refreshLatest.current()
    }, REVIEW_REFRESH_MS)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  const refresh = (): void => {
    refreshNow()
    setGeneration((value) => value + 1)
    if (local) readDraft()
  }

  // ── what the draft puts on the screen ──
  const comments = useMemo(() => (draft === null ? [] : draft.payload.comments.map((comment, index) => ({ comment, by: draft.anchors[index]?.by ?? 'person' }))), [draft])
  const onLines = scope.kind === 'all' && !moved
  const renderBelow = (line: DiffLine, side: LineSide, entry: FileEntry): ReactNode => {
    if (!onLines) return null
    const here = comments.filter(({ comment }) => comment.path === entry.file.path && commentOnLine(comment, line, side, layout))
    if (here.length === 0) return null
    return here.map(({ comment, by }, index) => <DraftComment key={`${comment.path}:${comment.line}:${index}`} comment={comment} by={by} repo={repo} />)
  }
  const threadsOf = (path: string): number => row.threads.filter((thread) => !thread.isResolved && thread.path === path).length
  const renderRowEnd = (entry: FileEntry): ReactNode => {
    const counted = threadsOf(entry.file.path) + comments.filter(({ comment }) => comment.path === entry.file.path).length
    const viewed = isViewed(draft, entry)
    return (
      <>
        {counted > 0 ? (
          <span className="w-pr-review-count w-mono" data-testid="pr-review-tree-count" aria-label={plural(counted, 'thread or comment', 'threads and comments')}>
            {counted}
          </span>
        ) : null}
        <span className="w-pr-review-viewed-mark" data-testid="pr-review-tree-viewed" data-viewed={String(viewed)} aria-label={viewed ? 'Viewed' : undefined}>
          {viewed ? '✓' : ''}
        </span>
      </>
    )
  }
  const renderHeadEnd = (entry: FileEntry): ReactNode =>
    local && draft !== null ? (
      <label className="w-changes__check nodrag">
        <input type="checkbox" checked={isViewed(draft, entry)} data-testid="pr-review-viewed" data-path={entry.file.path} onChange={() => toggleViewed(entry)} />
        Viewed
      </label>
    ) : null

  const viewedCount = allEntries.filter((entry) => isViewed(draft, entry)).length
  const agentComments = comments.filter(({ by }) => by === 'agent').length
  const writing = draft?.agent?.state === 'writing'
  const agentDraft = draft?.agent !== undefined && draft.agent.state !== 'stopped'

  const callAgent = (channel: 'stop' | 'add'): void => {
    if (subject === null) return
    setNotice(null)
    const done = (answer: { ok: boolean; error?: string }, name: string): void => {
      if (!answer.ok) setNotice(failureReason(name, answer.error ?? ''))
      readDraft()
    }
    if (channel === 'stop') void invoke('prReview.stopAgent', { projectId, repo, number }).then((answer) => done(answer, 'prReview.stopAgent'))
    else void invoke('prReview.agentReview', { projectId, repo, number, head: subject.headOid, fill: 'add' }).then((answer) => done(answer, 'prReview.agentReview'))
  }

  let bar: ReactNode = null
  if (local && draft !== null) {
    bar = writing ? (
      <footer className="w-pr-review-bar is-writing" role="status" data-testid="pr-review-bar" data-state="writing">
        <span className="w-pr-review-bar__spin" aria-hidden="true" />
        <span className="w-pr-review-bar__what">
          <b>Agent is writing the review…</b>
          <span className="w-changes__muted">{plural(agentComments, 'comment')} so far · you can read and write your own comments; the agent does not touch them.</span>
        </span>
        <span className="w-changes__spacer" />
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-take-over" title="Stop the agent and keep what it wrote as your draft" onClick={() => callAgent('stop')}>
          Take over
        </button>
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-stop" onClick={() => callAgent('stop')}>
          Stop
        </button>
      </footer>
    ) : (
      <footer className="w-pr-review-bar" role="status" data-testid="pr-review-bar" data-state={agentDraft ? 'agent' : 'person'}>
        <span className="w-pr-review-bar__what">
          <b>Your review</b>
          <span className="w-changes__muted" data-testid="pr-review-bar-count">
            {comments.length === 0
              ? 'No comments yet'
              : agentComments > 0
                ? `${plural(comments.length, 'comment')} (${agentComments} by the agent)`
                : plural(comments.length, 'pending comment')}
          </span>
          {draft.agent?.state === 'stopped' ? <span className="w-pr-review-flag">Agent stopped</span> : null}
          {draft.suggestedEvent !== undefined ? (
            <span data-testid="pr-review-suggests">
              · The agent suggests: <b>{{ APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes', COMMENT: 'Comment' }[draft.suggestedEvent]}</b>
            </span>
          ) : null}
        </span>
        <span className="w-changes__spacer" />
        {agentDraft ? (
          <button type="button" className="w-pr-inbox-button" data-testid="pr-review-take-over" title="Make the draft yours: the agent stops and its comments stay" onClick={() => callAgent('stop')}>
            Take over
          </button>
        ) : (
          <button type="button" className="w-pr-inbox-button" data-testid="pr-review-ask-agent" title="The agent adds its comments; yours and your summary stay as they are" onClick={() => callAgent('add')}>
            Ask the agent to add comments
          </button>
        )}
      </footer>
    )
  }

  const value = list?.value
  const files = allEntries.length
  let body: ReactNode
  if (subject === null) body = <p className="w-changes__message w-changes__muted">Reading the commits of {repo}#{number}…</p>
  else if (list === null) body = <p className="w-changes__message w-changes__muted">Reading the changes of {repo}#{number}…</p>
  else if (list.error !== null) body = <p className="w-changes__message">{list.error}</p>
  else
    body = (
      <div className="w-changes__main">
        <FileTree
          repos={repos}
          filter={filter}
          onFilter={setFilter}
          selected={chosen}
          onSelect={select}
          workflowOpen={workflowOpen}
          onWorkflowOpen={setWorkflowOpen}
          toggled={toggled}
          onToggle={(key) =>
            setToggled((set) => {
              const next = new Set(set)
              if (!next.delete(key)) next.add(key)
              return next
            })
          }
          truncatedAt={value?.truncatedAt ?? null}
          renderRowEnd={renderRowEnd}
        />
        <div className="w-pr-review__diff">
          {!onLines && comments.length > 0 && draftCommit !== null ? (
            <section className="w-pr-review-off" data-testid="pr-review-off-lines" aria-label={`Your comments on ${short(draftCommit)}`}>
              <p className="w-changes__muted">
                {plural(comments.length, 'comment')} on the lines of <span className="w-mono">{short(draftCommit)}</span>, not of this diff
              </p>
              {comments.map(({ comment, by }, index) => (
                <DraftComment key={index} comment={comment} by={by} repo={repo} where={`${comment.path}:${comment.start_line === undefined ? comment.line : `${comment.start_line}–${comment.line}`}`} />
              ))}
            </section>
          ) : null}
          <DiffPane
            ref={pane}
            projectId={projectId}
            subject={subject}
            scope={scope}
            hideWhitespace={hideWhitespace}
            layout={layout}
            wrap={wrap}
            entries={entries}
            several={false}
            selected={chosen}
            generation={generation}
            threads={row.threads}
            renderBelow={renderBelow}
            renderHeadEnd={renderHeadEnd}
          />
        </div>
      </div>
    )

  return (
    <section ref={root} className="w-pr-review w-changes" aria-label="Review mode" data-testid="pr-review-mode" data-repo={repo} data-number={number} data-read-only={String(!local)}>
      <header className="w-pr-review__head">
        <span className="w-pr-review__title">
          <span className="w-mono">
            {repo}#{number}
          </span>{' '}
          {row.title}
        </span>
        <span className="w-pr-review__meta">
          <span className="w-mono" data-testid="pr-review-branches">
            {row.baseRefName ?? 'base'} ← {row.headRefName}
          </span>
          {row.headRefOid !== null ? (
            <span className="w-mono" data-testid="pr-review-head" title={row.headRefOid}>
              {short(row.headRefOid)}
            </span>
          ) : null}
          {value != null ? (
            <span className="w-mono" data-testid="pr-review-size">
              {plural(files, 'file')} · <span className="w-changes__add-n">+{value.additions}</span> <span className="w-changes__del-n">−{value.deletions}</span>
            </span>
          ) : null}
        </span>
        <ApprovalsChip approvals={row.approvals} word />
        <span className="w-changes__spacer" />
        {!local ? (
          <span className="w-changes__chip" data-testid="pr-review-read-only" title={readOnly ?? 'The review draft lives on the machine of the Project'}>
            Read only
          </span>
        ) : (
          <span className="w-pr-review__meta" data-testid="pr-review-viewed-count">
            Viewed{' '}
            <span className="w-mono">
              {viewedCount}/{files}
            </span>
          </span>
        )}
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-refresh" title="Read the pull request again" onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-close" title="Close Review mode (Escape). The draft stays." onClick={closeReviewMode}>
          Close
        </button>
      </header>
      {moved && draftCommit !== null && subject !== null ? (
        <div className="w-pr-review-moved" role="status" data-testid="pr-review-new-commits">
          <span>
            <b>{newCount === null ? 'The head moved since you started' : `${plural(newCount, 'new commit')} since you started`}</b> · you started on{' '}
            <span className="w-mono">{short(draftCommit)}</span>, the head is <span className="w-mono">{short(subject.headOid)}</span>. Your comments stay on the lines of{' '}
            <span className="w-mono">{short(draftCommit)}</span>.
          </span>
          <span className="w-changes__spacer" />
          <button type="button" className="w-pr-inbox-button" data-testid="pr-review-show-new" aria-pressed={since} onClick={() => useReviewMode.setState({ since: !since })}>
            {since ? 'Show all changes' : 'Show new commits'}
          </button>
        </div>
      ) : null}
      <div className="w-changes__bar">
        <ToggleGroup aria-label="Diff view" className="w-segmented" value={layout} onValueChange={(next: DiffLayout | null) => setLayout(next ?? layout)}>
          <ToggleGroupItem value="inline" className="w-segmented__item" data-testid="pr-review-inline">
            Inline
          </ToggleGroupItem>
          <ToggleGroupItem value="side-by-side" className="w-segmented__item" data-testid="pr-review-side-by-side">
            Side by side
          </ToggleGroupItem>
        </ToggleGroup>
        <label className="w-changes__check">
          <input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />
          Wrap
        </label>
        <label className="w-changes__check">
          <input type="checkbox" checked={hideWhitespace} onChange={(event) => setHideWhitespace(event.target.checked)} />
          Hide whitespace
        </label>
        <span className="w-changes__spacer" />
        <span className="w-changes__muted w-pr-review__keys">j / k file · n / p hunk{local ? ' · v Viewed' : ''} · Esc close</span>
      </div>
      {notice !== null || draftRead?.problem != null ? (
        <p className="w-pr-review__notice" role="alert" data-testid="pr-review-notice">
          {notice ?? draftRead?.problem}
        </p>
      ) : null}
      {body}
      {bar}
    </section>
  )
}
