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
//   person's (`fill: 'add'`). Stop and Take over both stop the Session (`prReview.stopAgent`). The bar itself is
//   ReviewBar.tsx: the count of comments, Discard, Finish review (ticket 10).
// - Comments on lines (ticket 10, review-comments.tsx): «+» in the gutter, `c` on the lines picked, the popover of the
//   Changes screen; they go into the draft, never to GitHub before Submit (ticket 11).
// - Finish review (ticket 11, FinishReviewDialog.tsx): the dialog of the texts as they go, and Submit review — one
//   POST on the person's click. GitHub took it: a toast, the PR read again (its approvals chip), Review mode closes.
//   Inactive while the agent writes, and on a draft already submitted (the bar offers Start a new review then).
// - Keys: j / k and ↓ / ↑ — the next and the previous file, n / p — hunks, v — Viewed of the file, c — a comment on the
//   lines picked, ⌘⇧↵ — Finish review; Escape closes a menu or a popover first (the kit marks it handled), then Review mode.
// - A Linked machine (read-only access or not): the draft lives on the Machine of the Project, so Review mode shows the
//   diff and the threads only — no Viewed, no draft, no bar.
// - Which PR, its file and Show new commits live in the store of the view (useReviewMode): another tab and back keeps them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChangesPrRef, ChangesScope } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
// The channels must be declared in this window too: a `project` channel goes to the Machine of the Project (ipc.ts).
import '../../shared/ipc/changes'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import '../../shared/ipc/pr-review'
import { REVIEW_FILES_MAX, submitPending, type PrReviewDraftAnswer, type PrReviewSubmitAnswer, type ReviewDraft, type ReviewEvent } from '../../shared/ipc/pr-review'
import { type DiffPaneHandle } from '../changes/DiffPane'
import { DiffScreen } from '../changes/DiffScreen'
import { orderedFiles, toggledWith, type DiffLayout, type FileEntry, type RepoFiles } from '../changes/diff-window'
import '../changes/changes.css'
import { invoke, subscribe } from '../ipc'
import { ApprovalsChip } from '../pr-inbox/ApprovalsChip'
import { layerOf } from '../theme/open-layers'
import { ToggleGroup, ToggleGroupItem } from '../theme/kit/ToggleGroup'
import { showToast } from '../toast/toasts'
import { FinishReviewDialog } from './FinishReviewDialog'
import { FINISH_WAITS, ReviewBar } from './ReviewBar'
import { useReviewComments } from './review-comments'
import { closeReviewMode, draftChanged, draftCommitOf, EVENT_WORDS, isViewed, plural, REVIEW_REFRESH_MS, REVIEW_STALE_MS, reviewOpenOn, sameCommit, short, useReviewMode, viewedBlobOf } from './review-store'
import './pr-review.css'

/** Input types that take no text: a key pressed on one (Viewed, Wrap, Hide whitespace) is Review mode's. */
const NO_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Whether the keys belong to a field the person types in. */
function typingIn(target: HTMLElement): boolean {
  if (target.isContentEditable || target.closest('textarea, select') !== null) return true
  const input = target.closest('input')
  return input !== null && !NO_TEXT.has(input.type)
}

type Read<T> ={ of: string; value: T; error: null } | { of: string; value: null; error: string }

export interface ReviewModeProps {
  projectId: string
  row: PrInboxRow
  /** Non-null in a window of a Linked machine (reviewAway): the draft is out of reach, Review mode only reads. */
  readOnly: string | null
  /** Reads the PR again (its head, threads, approvals). */
  onRefresh: () => void
  /** The login the PRs are read as: on the person's own PR Finish review offers no Approve and no Request changes. */
  viewer?: string | null
}

export function ReviewMode({ projectId, row, readOnly, onRefresh, viewer = null }: ReviewModeProps) {
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
  const takeAnswer = useCallback((answer: PrReviewDraftAnswer) => setDraftRead({ draft: answer.draft, problem: answer.problem }), [])
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
  // Kept here, not in DiffScreen: «Reading…» stands in its place while a read runs (Hide whitespace, Refresh, a new head).
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
      draftChanged()
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

  // ── the comments on lines (ticket 10) ──
  // They stand on their lines while the diff shown is All changes of the commit the draft is numbered on; new ones are
  // made only then, so each is numbered on that commit.
  const onLines = scope.kind === 'all' && !moved
  // A draft whose Submit GitHub did not confirm keeps the texts that went until the next Submit looks on GitHub.
  const canChange = local && subject !== null && draft !== null && draft.state === 'draft' && !submitPending(draft)
  const lineComments = useReviewComments({
    projectId,
    repo,
    number,
    subject,
    draft,
    canChange,
    onLines,
    canAdd: canChange && onLines,
    layout,
    entries: allEntries,
    filesRead,
    generation,
    diffView: listFor,
    body: root,
    onAnswer: takeAnswer,
    onNotice: setNotice,
  })
  const { comments } = lineComments
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

  // ── Finish review (ticket 11) ──
  /** The draft as Finish review found it: the dialog keeps its texts. Null while the dialog is closed. */
  const [finishing, setFinishing] = useState<ReviewDraft | null>(null)
  const finishWhy =
    draft === null || subject === null
      ? 'Reading the draft…'
      : draft.agent?.state === 'writing'
        ? FINISH_WAITS
        : draft.state === 'submitted'
          ? 'Submitted already'
          : null
  const finish = (): boolean => {
    if (finishWhy !== null || draft === null) return false
    setNotice(null)
    setFinishing(draft)
    return true
  }
  const submitted = (answer: PrReviewSubmitAnswer, event: ReviewEvent, posted: number): void => {
    setFinishing(null)
    if (answer.draft !== null) setDraftRead({ draft: answer.draft, problem: null })
    draftChanged()
    const text =
      answer.outcome === 'already-submitted'
        ? `GitHub had this review of ${repo}#${number} already: it is marked submitted, nothing was posted again`
        : `Review sent to ${repo}#${number} · ${EVENT_WORDS[event]} · ${plural(posted, 'comment')}`
    showToast({ kind: 'success', key: `pr-review-submitted:${repo}#${number}`, text })
    refreshNow()
    closeReviewMode()
  }
  /** Start a new review of a PR whose review is submitted: the submitted draft goes, Start review makes a new one. */
  const newReview = (): void => {
    void invoke('prReview.discard', { projectId, repo, number }).then((answer) => {
      if (!answer.ok) {
        setNotice(failureReason('prReview.discard', answer.error))
        return
      }
      takeAnswer(answer.value)
      draftChanged()
      started.current = false
      setGeneration((value) => value + 1)
    })
  }

  const latest = useRef({ entries, chosen, select, toggleViewed, commentKey: lineComments.commentKey, clearPick: lineComments.clearPick, finish })
  useEffect(() => {
    latest.current = { entries, chosen, select, toggleViewed, commentKey: lineComments.commentKey, clearPick: lineComments.clearPick, finish }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const finishKey = event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.shiftKey
      if (event.defaultPrevented || event.altKey || ((event.ctrlKey || event.metaKey) && !finishKey)) return
      const frame = root.current
      // The views of the shell stay mounted and hidden: only the shown one takes keys.
      if (frame === null || frame.closest('[hidden]') !== null) return
      const target = event.target
      if (target instanceof HTMLElement && (typingIn(target) || layerOf(target) !== null)) return
      if (finishKey) {
        if (latest.current.finish()) event.preventDefault()
        return
      }
      const { entries: files, chosen: at, select: go, toggleViewed: mark, commentKey, clearPick } = latest.current
      if (event.key === 'Escape') {
        event.preventDefault()
        // The lines picked go first (worfy-changes-view ticket 09), then Review mode.
        if (!clearPick()) closeReviewMode()
        return
      }
      if (event.shiftKey) return
      if (event.key === 'c') {
        if (commentKey()) event.preventDefault()
        return
      }
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
  const offIndexes = new Set(lineComments.offLines.map(({ index }) => index))
  const count = {
    all: comments.length,
    agent: comments.filter(({ by }) => by === 'agent').length,
    files: new Set(comments.filter(({ index }) => !offIndexes.has(index)).map(({ comment }) => comment.path)).size,
  }

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

  const discard = (): void => {
    // A draft whose Submit may be on GitHub is discarded too, after the bar's warning: the lookup can fail for good.
    if (!canChange && !(local && draft !== null && submitPending(draft))) return
    setNotice(null)
    void invoke('prReview.discard', { projectId, repo, number }).then((answer) => {
      if (!answer.ok) {
        setNotice(failureReason('prReview.discard', answer.error))
        return
      }
      takeAnswer(answer.value)
      draftChanged()
      showToast({ kind: 'success', key: `pr-review-discarded:${repo}#${number}`, text: 'Review draft discarded' })
      closeReviewMode()
    })
  }

  const bar: ReactNode =
    local && draft !== null ? (
      <ReviewBar
        draft={draft}
        count={count}
        canChange={canChange}
        finishWhy={finishWhy}
        onStop={() => callAgent('stop')}
        onAsk={() => callAgent('add')}
        onDiscard={discard}
        onFinish={() => void finish()}
        onNewReview={newReview}
      />
    ) : null
  const mine = row.author !== null && viewer !== null && row.author.toLowerCase() === viewer.toLowerCase()
  const dialog: ReactNode =
    finishing !== null && subject !== null ? (
      <FinishReviewDialog projectId={projectId} repo={repo} number={number} draft={finishing} head={subject.headOid} mine={mine} off={offIndexes} onClose={() => setFinishing(null)} onSubmitted={submitted} />
    ) : null

  const value = list?.value
  const files = allEntries.length
  let body: ReactNode
  if (subject === null) body = <p className="w-changes__message w-changes__muted">Reading the commits of {repo}#{number}…</p>
  else if (list === null) body = <p className="w-changes__message w-changes__muted">Reading the changes of {repo}#{number}…</p>
  else if (list.error !== null) body = <p className="w-changes__message">{list.error}</p>
  else
    body = (
      <DiffScreen
        tree={{
          repos,
          filter,
          onFilter: setFilter,
          selected: chosen,
          onSelect: select,
          workflowOpen,
          onWorkflowOpen: setWorkflowOpen,
          toggled,
          onToggle: (key) => setToggled((set) => toggledWith(set, key)),
          truncatedAt: value?.truncatedAt ?? null,
          renderRowEnd,
        }}
        diff={{ ref: pane, projectId, subject, scope, hideWhitespace, layout, wrap, entries, several: false, selected: chosen, generation, threads: row.threads, renderHeadEnd, ...lineComments.diff }}
        columnClassName="w-pr-review__diff"
        aboveDiff={
          <>
            {!onLines && comments.length > 0 && draftCommit !== null ? (
              <section className="w-pr-review-off" data-testid="pr-review-off-lines" aria-label={`Your comments on ${short(draftCommit)}`}>
                <p className="w-changes__muted">
                  {plural(comments.length, 'comment')} on the lines of <span className="w-mono">{short(draftCommit)}</span>, not of this diff
                </p>
                {comments.map(lineComments.listed)}
              </section>
            ) : null}
            {lineComments.offList}
          </>
        }
      />
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
        <span className="w-changes__muted w-pr-review__keys">j / k file · n / p hunk{local ? ' · v Viewed · c comment' : ''} · Esc close</span>
      </div>
      {notice !== null || draftRead?.problem != null ? (
        <p className="w-pr-review__notice" role="alert" data-testid="pr-review-notice">
          {notice ?? draftRead?.problem}
        </p>
      ) : null}
      {body}
      {bar}
      {lineComments.overlay}
      {dialog}
    </section>
  )
}
