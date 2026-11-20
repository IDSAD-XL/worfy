// The bar at the bottom of Review mode (worfy-pr-review tickets 08–10): what the review holds and what can be done with it.
// - While the Session of an Agent review writes: «Agent is writing the review…», Take over and Stop; Finish review is
//   inactive until the agent finishes or is stopped.
// - Else «Your review · N pending comments on M files», «(K by the agent)» when the agent wrote some, the verdict it
//   suggests; Take over on the agent's draft, Ask the agent to add comments on the person's; Discard, which asks
//   «Discard N pending comments?» first; Finish review (its dialog is ticket 11's: until then inactive, «Coming next»).
import { useId, useState } from 'react'
import type { ReviewDraft } from '../../shared/ipc/pr-review'
import { Dialog } from '../theme/kit/Dialog'
import { plural } from './review-store'

/** Why Finish review is inactive while the Session writes. */
export const FINISH_WAITS = 'Waits until the agent finishes or you stop it'
/** Why Finish review is inactive until its dialog comes (ticket 11). */
export const FINISH_NEXT = 'Coming next'

const EVENT_WORDS = { APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes', COMMENT: 'Comment' } as const

export interface ReviewBarProps {
  draft: ReviewDraft
  /** The comments of the draft, those by the agent among them, and the files of those on a changed line. */
  count: { all: number; agent: number; files: number }
  /** The draft may be changed: Discard. */
  canChange: boolean
  onStop: () => void
  onAsk: () => void
  /** Discard, confirmed. */
  onDiscard: () => void
}

/** Finish review: a button that keeps its tooltip while inactive (`aria-disabled`, not `disabled`). */
function FinishButton({ why }: { why: string }) {
  return (
    <button type="button" className="w-pr-inbox-button w-pr-inbox-button--primary" data-testid="pr-review-finish" aria-disabled="true" title={why} onClick={(event) => event.preventDefault()}>
      Finish review
    </button>
  )
}

export function ReviewBar({ draft, count, canChange, onStop, onAsk, onDiscard }: ReviewBarProps) {
  const [asking, setAsking] = useState(false)
  const titleId = useId()
  const writing = draft.agent?.state === 'writing'
  const agentDraft = draft.agent !== undefined && draft.agent.state !== 'stopped'

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
        <FinishButton why={FINISH_WAITS} />
      </footer>
    )

  const words = count.all === 0 ? 'No comments yet. Press c on a line or the + in the gutter.' : `${count.agent > 0 ? `${plural(count.all, 'comment')} (${count.agent} by the agent)` : plural(count.all, 'pending comment')} on ${plural(count.files, 'file')}`
  return (
    <footer className="w-pr-review-bar" role="status" data-testid="pr-review-bar" data-state={agentDraft ? 'agent' : 'person'}>
      <span className="w-pr-review-bar__what">
        <b>Your review</b>
        <span className="w-changes__muted" data-testid="pr-review-bar-count">
          {words}
        </span>
        {draft.agent?.state === 'stopped' ? <span className="w-pr-review-flag">Agent stopped</span> : null}
        {draft.suggestedEvent !== undefined ? (
          <span data-testid="pr-review-suggests">
            · The agent suggests: <b>{EVENT_WORDS[draft.suggestedEvent]}</b>
          </span>
        ) : null}
      </span>
      <span className="w-changes__spacer" />
      {agentDraft ? (
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-take-over" title="Make the draft yours: the agent stops and its comments stay" onClick={onStop}>
          Take over
        </button>
      ) : (
        <button type="button" className="w-pr-inbox-button" data-testid="pr-review-ask-agent" title="The agent adds its comments; yours and your summary stay as they are" onClick={onAsk}>
          Ask the agent to add comments
        </button>
      )}
      <button type="button" className="w-pr-inbox-button w-pr-review-bar__discard" data-testid="pr-review-discard" disabled={!canChange || count.all === 0} title="Delete the draft on this machine" onClick={() => setAsking(true)}>
        Discard
      </button>
      <FinishButton why={FINISH_NEXT} />
      {asking ? (
        <Dialog open onClose={() => setAsking(false)} labelledBy={titleId} className="w-pr-review-confirm" data-testid="pr-review-discard-confirm">
          <h3 id={titleId} className="w-pr-review-confirm__title">
            Discard {plural(count.all, 'pending comment')}?
          </h3>
          <p className="w-pr-review-confirm__text">The draft file on this machine is deleted. Nothing was on GitHub, so nothing changes there.</p>
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
