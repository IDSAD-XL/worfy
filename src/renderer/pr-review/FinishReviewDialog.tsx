// The Finish review dialog (worfy-pr-review ticket 11; spec, implementation decisions, 7; ADR-0112): the review as it
// will go to GitHub, and Submit review — the one POST, on the person's click (`prReview.submit`, pr-review-submit.ts).
//
// - Summary, the verdict Comment / Approve / Request changes — always starting on Comment; an Agent review's suggested
//   verdict is a line beside it, never chosen by itself — and every comment exactly as it goes: `path:line` and its
//   text, «by the agent» on a comment the agent wrote and the person did not edit, Remove on each (the comment stays
//   in the draft until a Submit takes the rest).
// - The dialog keeps the texts it opened with: a change of the draft while it is open does not change what goes.
// - Inactive: Approve and Request changes on the person's own PR; Comment and Request changes without a summary and
//   without comments (GitHub needs a body); Submit while a comment is not on a changed line (GitHub refuses the review
//   whole) or review-draft-lint found something in the texts (`prReview.check`, run again as they change).
// - The commit the comments are numbered on (`anchoredOn`, else `startedOn`) is the one they go on. A head past it:
//   «Your comments are on <a>; the head is <b>.» and Submit on <a>. A head that moved while the dialog was open comes
//   back from main, which posts nothing then, and the dialog shows it before the next click.
// - Enter does not submit: a click on Submit or ⌘↵ in the dialog does, once; a second one while it runs does nothing.
// - A summary typed and not submitted stays with the PR while worfy runs: Cancel and Finish review again give it back.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import '../../shared/ipc/pr-review'
import type { PrReviewSubmitAnswer, ReviewComment, ReviewDraft, ReviewEvent } from '../../shared/ipc/pr-review'
import { invoke } from '../ipc'
import { Dialog } from '../theme/kit/Dialog'
import { EVENT_WORDS, openOutside, plural, short } from './review-store'

const OWN_PULL = 'GitHub does not let you approve or request changes on your own pull request'
const NEEDS_TEXT = 'GitHub needs a summary or a comment for this verdict'
const OFF_LINES = 'Remove the comments not on a changed line first: GitHub refuses the whole review with one of them'
const LINT_CLEAN = 'Checked: no workflow traces, no AI signature, no personal data'
/** How long the texts rest before review-draft-lint checks them again. */
const CHECK_PAUSE_MS = 400

const EVENTS: readonly ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']

/** The summaries typed and not submitted, by Project and PR, while worfy runs. */
const typed = new Map<string, string>()
const typedKey = (projectId: string, repo: string, number: number): string => `${projectId}\n${repo.toLowerCase()}#${number}`

const whereOf = (comment: ReviewComment): string => `${comment.path}:${comment.start_line === undefined ? comment.line : `${comment.start_line}–${comment.line}`}`

export interface FinishReviewDialogProps {
  projectId: string
  repo: string
  number: number
  /** The draft as Finish review found it: the dialog keeps these texts. */
  draft: ReviewDraft
  /** The head of the PR the view shows. */
  head: string
  /** The PR is the person's own: no Approve, no Request changes. */
  mine: boolean
  /** The places in the draft of the comments not on a changed line (Review mode knows them). */
  off: ReadonlySet<number>
  onClose: () => void
  /** GitHub has the review: posted now, or found there after a Submit whose answer was lost. */
  onSubmitted: (answer: PrReviewSubmitAnswer, event: ReviewEvent, comments: number) => void
}

interface Shown {
  index: number
  comment: ReviewComment
  by: 'person' | 'agent'
}

type Lint = { state: 'checking' } | { state: 'clean' } | { state: 'findings'; findings: string[] } | { state: 'broken'; reason: string }

export function FinishReviewDialog({ projectId, repo, number, draft, head, mine, off, onClose, onSubmitted }: FinishReviewDialogProps) {
  const titleId = useId()
  // The texts it opened with, kept: a draft that changes while it is open changes nothing here.
  const [opened] = useState(() => ({
    commit: draft.anchoredOn ?? draft.startedOn,
    unfinished: draft.state === 'submitting',
    suggested: draft.suggestedEvent,
    comments: draft.payload.comments.map<Shown>((comment, index) => ({ index, comment, by: draft.anchors[index]?.by ?? 'person' })),
    off: new Set(off),
  }))
  // A Submit that did not finish goes again with its own texts, which may be on GitHub already.
  const [event, setEvent] = useState<ReviewEvent>(opened.unfinished ? (draft.payload.event ?? 'COMMENT') : 'COMMENT')
  const [summary, setSummary] = useState(() => (opened.unfinished ? draft.payload.body : (typed.get(typedKey(projectId, repo, number)) ?? draft.payload.body)))
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set())
  const [headNow, setHeadNow] = useState(head)
  const [reason, setReason] = useState<string | null>(null)
  const [checked, setChecked] = useState<{ of: string; lint: Lint } | null>(null)
  const [sending, setSending] = useState(false)
  const sendingNow = useRef(false)

  const list = useMemo(() => opened.comments.filter((each) => !removed.has(each.index)), [opened, removed])
  const offShown = list.filter((each) => opened.off.has(each.index))
  const comments = useMemo(() => list.map((each) => each.comment), [list])
  const moved = headNow.toLowerCase() !== opened.commit.toLowerCase()

  // review-draft-lint over the texts as they would go, again whenever they change.
  const texts = JSON.stringify([event, summary, comments])
  const lint: Lint = checked?.of === texts ? checked.lint : { state: 'checking' }
  useEffect(() => {
    let current = true
    const of = texts
    const timer = setTimeout(() => {
      void invoke('prReview.check', { projectId, repo, number, event, body: summary, comments }).then((answer) => {
        if (!current) return
        if (!answer.ok) setChecked({ of, lint: { state: 'broken', reason: failureReason('prReview.check', answer.error) } })
        else if (answer.value.reason !== null) setChecked({ of, lint: { state: 'broken', reason: answer.value.reason } })
        else setChecked({ of, lint: answer.value.findings.length > 0 ? { state: 'findings', findings: answer.value.findings } : { state: 'clean' } })
      })
    }, CHECK_PAUSE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
    // `texts` holds what is checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texts])

  const needsText = event !== 'APPROVE' && summary.trim() === '' && list.length === 0
  const why =
    mine && event !== 'COMMENT' ? OWN_PULL : needsText ? NEEDS_TEXT : offShown.length > 0 ? OFF_LINES : lint.state === 'findings' ? 'review-draft-lint found something in the texts: change them first' : sending ? 'Submitting…' : null

  const close = (): void => {
    if (!opened.unfinished) typed.set(typedKey(projectId, repo, number), summary)
    onClose()
  }

  const send = (): void => {
    if (why !== null || sendingNow.current) return
    sendingNow.current = true
    setSending(true)
    setReason(null)
    const sentEvent = event
    const count = comments.length
    void invoke('prReview.submit', { projectId, repo, number, event, body: summary, comments, commit: opened.commit, head: headNow })
      .then((answer) => {
        if (!answer.ok) {
          setReason(failureReason('prReview.submit', answer.error))
          return
        }
        if (answer.value.outcome === 'submitted' || answer.value.outcome === 'already-submitted') {
          typed.delete(typedKey(projectId, repo, number))
          onSubmitted(answer.value, sentEvent, count)
          return
        }
        if (answer.value.head !== null) setHeadNow(answer.value.head)
        setReason(answer.value.reason)
      })
      .finally(() => {
        sendingNow.current = false
        setSending(false)
      })
  }

  return (
    <Dialog
      open
      onClose={close}
      labelledBy={titleId}
      className="w-pr-review-finish"
      data-testid="pr-review-finish-dialog"
      closeOnBackdrop={false}
      onModifierKey={(key) => {
        if (key.key !== 'Enter' || !(key.metaKey || key.ctrlKey) || key.shiftKey || key.altKey) return false
        send()
        return true
      }}
    >
      <h3 id={titleId} className="w-pr-review-finish__title">
        Submit review to{' '}
        <span className="w-mono">
          {repo}#{number}
        </span>
      </h3>
      {opened.unfinished ? (
        <p className="w-pr-review-finish__stripe" role="status" data-testid="pr-review-dialog-unfinished">
          A Submit of this review did not finish. Submit it again: worfy first looks whether GitHub has it already.
        </p>
      ) : null}
      {moved ? (
        <p className="w-pr-review-finish__stripe" role="status" data-testid="pr-review-dialog-moved">
          <b>
            Your comments are on {short(opened.commit)}; the head is {short(headNow)}.
          </b>{' '}
          They go on the lines of {short(opened.commit)}, where you wrote them. GitHub may show a comment on a line {short(headNow)} changed as outdated.
        </p>
      ) : null}
      <label className="w-pr-review-finish__label" htmlFor={`${titleId}-summary`}>
        Summary
      </label>
      <textarea
        id={`${titleId}-summary`}
        className="w-pr-review-finish__summary"
        data-testid="pr-review-summary"
        placeholder="What you think of the change as a whole. Markdown."
        value={summary}
        readOnly={opened.unfinished}
        onChange={(change) => setSummary(change.target.value)}
      />
      <div className="w-pr-review-finish__verdict">
        <span className="w-segmented" role="radiogroup" aria-label="Verdict">
          {EVENTS.map((each) => {
            const own = mine && each !== 'COMMENT'
            const off = own || (opened.unfinished && each !== event)
            return (
              <button
                key={each}
                type="button"
                role="radio"
                className="w-segmented__item"
                aria-checked={event === each}
                aria-disabled={off}
                title={own ? OWN_PULL : undefined}
                data-testid={`pr-review-event-${each}`}
                onClick={() => {
                  if (!off) setEvent(each)
                }}
              >
                {EVENT_WORDS[each]}
              </button>
            )
          })}
        </span>
        {opened.suggested !== undefined ? (
          <span className="w-pr-review-finish__suggests" data-testid="pr-review-dialog-suggests">
            The agent suggests: <b>{EVENT_WORDS[opened.suggested]}</b> <span className="w-changes__muted">— you choose</span>
          </span>
        ) : null}
      </div>
      <p className="w-pr-review-finish__label" data-testid="pr-review-dialog-count">
        {plural(list.length - offShown.length, 'comment')} will be posted on <span className="w-mono">{short(opened.commit)}</span>, exactly as below
      </p>
      {list.length > 0 ? (
        <ul className="w-pr-review-finish__list">
          {list.map(({ index, comment, by }) => (
            <li key={index} className={`w-pr-review-finish__item${opened.off.has(index) ? ' is-off' : ''}`} data-testid="pr-review-dialog-comment">
              <span className="w-pr-review-finish__where w-mono" data-testid="pr-review-dialog-where">
                {whereOf(comment)}
                {by === 'agent' ? <span className="w-pr-review-flag w-pr-review-flag--agent">by the agent</span> : null}
              </span>
              {opened.off.has(index) ? <span className="w-pr-review-flag">Not posted · not on a changed line</span> : null}
              {opened.unfinished ? null : (
                <button type="button" className="w-pr-review-finish__remove" onClick={() => setRemoved((set) => new Set(set).add(index))}>
                  Remove
                </button>
              )}
              <span className="w-pr-review-finish__body" data-testid="pr-review-dialog-body">
                {comment.body}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="w-changes__muted w-pr-review-finish__none">No line comments: only the summary goes.</p>
      )}
      <div className={`w-pr-review-finish__lint is-${lint.state}`} data-testid="pr-review-dialog-lint">
        {lint.state === 'checking'
          ? 'Checking the texts…'
          : lint.state === 'clean'
            ? LINT_CLEAN
            : lint.state === 'broken'
              ? lint.reason
              : `review-draft-lint found: ${lint.findings.join('; ')}`}
      </div>
      {reason !== null ? (
        <p className="w-pr-review-finish__reason" role="alert" data-testid="pr-review-dialog-reason">
          {reason}{' '}
          <a href={`https://github.com/${repo}/pull/${number}`} onClick={(click) => openOutside(click, `https://github.com/${repo}/pull/${number}`)}>
            Open on GitHub
          </a>
        </p>
      ) : null}
      <div className="w-pr-review-finish__bar">
        <span className="w-changes__muted">One request to GitHub. Nothing was sent before this click.</span>
        <span className="w-changes__spacer" />
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-dialog-cancel" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="w-pr-inbox-button w-pr-inbox-button--primary"
          data-testid="pr-review-submit"
          aria-disabled={why !== null}
          title={why ?? 'Click or ⌘↵; Enter alone does not submit'}
          onClick={send}
          onKeyDown={(key) => {
            // A button takes Enter as a click: here only a click or ⌘↵ submits.
            if (key.key === 'Enter' && !key.metaKey && !key.ctrlKey) key.preventDefault()
          }}
        >
          {sending ? 'Submitting…' : moved ? `Submit on ${short(opened.commit)}` : 'Submit review'}
        </button>
      </div>
    </Dialog>
  )
}
