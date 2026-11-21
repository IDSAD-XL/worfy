// The bar at the bottom of Review mode (worfy-pr-review tickets 08–11): what the review holds and what can be done with it.
// - While the Session of an Agent review writes: «Agent is writing the review…», Take over and Stop; Finish review is
//   inactive until the agent finishes or is stopped.
// - Else «Your review · N pending comments on M files», «(K by the agent)» when the agent wrote some, the verdict it
//   suggests; Take over on the agent's draft, Ask the agent to add comments on the person's; Discard, which asks
//   «Discard N pending comments?» first; Finish review, which opens the dialog of Submit review (ticket 11,
//   FinishReviewDialog.tsx; ⌘⇧↵ too). A Submit GitHub did not confirm or refused leaves its reason on the bar.
// - A Submit that did not finish (worfy quit while it ran: «Submitting did not finish»), or that GitHub did not confirm:
//   the texts that went stay as they are — no Ask the agent, no Take over — and Finish review submits them again; main
//   first looks whether GitHub has them. Discard stays, warning that the review may be on GitHub already: the lookup
//   can fail for good (access lost, repository gone).
// - Submitted: «You reviewed this pull request · Approve», the link to the review on GitHub, and Start a new review.
import { useId, useState } from 'react'
import { submitPending, type ReviewDraft } from '../../shared/ipc/pr-review'
import { Dialog } from '../theme/kit/Dialog'
import { EVENT_WORDS, openOutside, plural, short } from './review-store'

/** Why Finish review is inactive while the Session writes. */
export const FINISH_WAITS = 'Waits until the agent finishes or you stop it'

export interface ReviewBarProps {
  draft: ReviewDraft
  /** The comments of the draft, those by the agent among them, and the files of those on a changed line. */
  count: { all: number; agent: number; files: number }
  /** The draft may be changed: Discard (a draft whose Submit may be on GitHub is discarded with a warning anyway). */
  canChange: boolean
  /** Why Finish review is inactive; null when it opens the dialog. */
  finishWhy: string | null
  onStop: () => void
  onAsk: () => void
  /** Discard, confirmed. */
  onDiscard: () => void
  onFinish: () => void
  /** Start a new review of a PR whose review is submitted. */
  onNewReview: () => void
}

/** Finish review: a button that keeps its tooltip while inactive (`aria-disabled`, not `disabled`). */
function FinishButton({ why, onFinish }: { why: string | null; onFinish: () => void }) {
  return (
    <button
      type="button"
      className="w-pr-inbox-button w-pr-inbox-button--primary"
      data-testid="pr-review-finish"
      aria-disabled={why !== null}
      title={why ?? 'Finish review (⌘⇧↵): the review as it will go, and Submit'}
      onClick={(event) => {
        event.preventDefault()
        if (why === null) onFinish()
      }}
    >
      Finish review
    </button>
  )
}

export function ReviewBar({ draft, count, canChange, finishWhy, onStop, onAsk, onDiscard, onFinish, onNewReview }: ReviewBarProps) {
  const [asking, setAsking] = useState(false)
  const titleId = useId()
  const writing = draft.agent?.state === 'writing'
  const agentDraft = draft.agent !== undefined && draft.agent.state !== 'stopped'
  const pending = submitPending(draft)

  if (draft.state === 'submitted')
    return (
      <footer className="w-pr-review-bar is-submitted" role="status" data-testid="pr-review-bar" data-state="submitted">
        <span className="w-pr-review-bar__what">
          <b>You reviewed this pull request{draft.payload.event === undefined ? '' : ` · ${EVENT_WORDS[draft.payload.event]}`}</b>
          <span className="w-changes__muted">
            One review on <span className="w-mono">{short(draft.anchoredOn ?? draft.startedOn)}</span>, {plural(draft.payload.comments.length, 'comment')}. GitHub has it.
          </span>
          {draft.reviewUrl !== undefined ? (
            <a href={draft.reviewUrl} data-testid="pr-review-open-review" onClick={(event) => openOutside(event, draft.reviewUrl!)}>
              Open the review on GitHub
            </a>
          ) : null}
        </span>
        <span className="w-changes__spacer" />
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-new" title="A new draft on the head of the PR; the review on GitHub stays" onClick={onNewReview}>
          Start a new review
        </button>
      </footer>
    )

  if (writing)
    return (
      <footer className="w-pr-review-bar is-writing" role="status" data-testid="pr-review-bar" data-state="writing">
        <span className="w-pr-review-bar__spin" aria-hidden="true" />
        <span className="w-pr-review-bar__what">
          <b>Agent is writing the review…</b>
          <span className="w-changes__muted">{plural(count.agent, 'comment')} so far · you can read and write your own comments; the agent does not touch them.</span>
        </span>
        <span className="w-changes__spacer" />
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-take-over" title="Stop the agent and keep what it wrote as your draft" onClick={onStop}>
          Take over
        </button>
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-stop" onClick={onStop}>
          Stop
        </button>
        <FinishButton why={FINISH_WAITS} onFinish={onFinish} />
      </footer>
    )

  const words = count.all === 0 ? 'No comments yet. Press c on a line or the + in the gutter.' : `${count.agent > 0 ? `${plural(count.all, 'comment')} (${count.agent} by the agent)` : plural(count.all, 'pending comment')} on ${plural(count.files, 'file')}`
  return (
    <footer className="w-pr-review-bar" role="status" data-testid="pr-review-bar" data-state={draft.state === 'submitting' ? 'submitting' : pending ? 'unconfirmed' : agentDraft ? 'agent' : 'person'}>
      <span className="w-pr-review-bar__what">
        <b>{draft.state === 'submitting' ? 'Submitting did not finish' : 'Your review'}</b>
        <span className="w-changes__muted" data-testid="pr-review-bar-count">
          {pending ? 'Finish review submits it again: worfy first looks whether GitHub has it already.' : words}
        </span>
        {draft.agent?.state === 'stopped' ? <span className="w-pr-review-flag">Agent stopped</span> : null}
        {draft.suggestedEvent !== undefined ? (
          <span data-testid="pr-review-suggests">
            · The agent suggests: <b>{EVENT_WORDS[draft.suggestedEvent]}</b>
          </span>
        ) : null}
        {draft.error !== undefined ? (
          <span className="w-pr-review-bar__error" role="alert" data-testid="pr-review-bar-error">
            {draft.error}
          </span>
        ) : null}
      </span>
      <span className="w-changes__spacer" />
      {pending ? null : agentDraft ? (
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-take-over" title="Make the draft yours: the agent stops and its comments stay" onClick={onStop}>
          Take over
        </button>
      ) : (
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-ask-agent" title="The agent adds its comments; yours and your summary stay as they are" onClick={onAsk}>
          Ask the agent to add comments
        </button>
      )}
      <button type="button" className="w-pr-inbox-button w-pr-review-bar__discard" data-testid="pr-review-discard" disabled={pending ? false : !canChange || count.all === 0} title="Delete the draft on this machine" onClick={() => setAsking(true)}>
        Discard
      </button>
      <FinishButton why={finishWhy} onFinish={onFinish} />
      {asking ? (
        <Dialog open onClose={() => setAsking(false)} labelledBy={titleId} className="w-pr-review-confirm" data-testid="pr-review-discard-confirm">
          <h3 id={titleId} className="w-pr-review-confirm__title">
            {pending ? 'Discard this review?' : `Discard ${plural(count.all, 'pending comment')}?`}
          </h3>
          <p className="w-pr-review-confirm__text" data-testid="pr-review-discard-text">
            {pending
              ? 'GitHub did not confirm the Submit of this review: it may be on GitHub already. Discard deletes only the draft on this machine; a review on GitHub stays there — look at the pull request on GitHub.'
              : 'The draft file on this machine is deleted. Nothing was on GitHub, so nothing changes there.'}
          </p>
          <div className="w-pr-review-confirm__bar">
            <button type="button" className="w-pr-inbox-button" data-testid="pr-review-discard-cancel" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="w-pr-inbox-button w-pr-inbox-button--primary"
              data-testid="pr-review-discard-ok"
              onClick={() => {
                setAsking(false)
                onDiscard()
              }}
            >
              Discard
            </button>
          </div>
        </Dialog>
      ) : null}
    </footer>
  )
}
