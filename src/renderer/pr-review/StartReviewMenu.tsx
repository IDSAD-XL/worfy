// Start review (worfy-pr-review ticket 09; spec, the decision, points 3 and 6): a button with a menu that asks who writes the
// review — Review myself (the person writes the comments and chooses the verdict) or Agent review (a Session drafts it,
// the person edits and submits it). A click on the button itself takes the Project's last choice, Review myself until
// one is made; the menu remembers the choice for the Project, on this machine. On a Linked machine the draft stays on
// the Machine of the Project (`prReview.*` are `local`): the button is inactive, with the reason as its tooltip.
import { useState } from 'react'
import { Menu, MenuItem } from '../theme/kit/Menu'
import { LINKED_REVIEW_HINT, lastReviewChoice, rememberReviewChoice, type ReviewHow } from './review-store'
import './pr-review.css'

const CHOICES: readonly { how: ReviewHow; title: string; text: string }[] = [
  { how: 'myself', title: 'Review myself', text: 'You write the comments and choose the verdict' },
  { how: 'agent', title: 'Agent review', text: 'An agent drafts it; you edit and submit' },
]

export interface StartReviewMenuProps {
  projectId: string
  /** Non-null in a window of a Linked machine (reviewAway): the button is inactive. */
  away: string | null
  onStart: (how: ReviewHow) => void
}

export function StartReviewMenu({ projectId, away, onStart }: StartReviewMenuProps) {
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<ReviewHow>(() => lastReviewChoice(projectId))
  const off = away === null ? null : LINKED_REVIEW_HINT
  const start = (how: ReviewHow): void => {
    rememberReviewChoice(projectId, how)
    setLast(how)
    onStart(how)
  }
  return (
    <span className="w-pr-review-split" data-testid="pr-review-start-split">
      <button
        type="button"
        className="w-pr-inbox-button w-pr-inbox-button--primary w-pr-review-split__main"
        data-testid="pr-inbox-next-step-action"
        data-how={last}
        aria-disabled={off !== null ? 'true' : undefined}
        title={off ?? (last === 'agent' ? 'Agent review (last used)' : 'Review myself (last used)')}
        onClick={() => {
          if (off === null) start(last)
        }}
      >
        Start review{last === 'agent' ? ' · Agent' : ''}
      </button>
      <Menu
        open={open && off === null}
        onOpenChange={(next) => setOpen(next && off === null)}
        label="Choose who writes the review"
        testId="pr-review-start-menu"
        className="w-pr-review-menu"
        align="end"
        trigger={
          <button
            type="button"
            className="w-pr-inbox-button w-pr-inbox-button--primary w-pr-review-split__more"
            data-testid="pr-review-start-more"
            aria-label="Choose who writes the review"
            aria-disabled={off !== null ? 'true' : undefined}
            title={off ?? 'Choose who writes the review'}
          >
            ▾
          </button>
        }
      >
        {CHOICES.map((choice) => (
          <MenuItem key={choice.how} className="w-pr-review-menu__item" testId={`pr-review-start-${choice.how}`} onClick={() => start(choice.how)}>
            <span className="w-pr-review-menu__title">{choice.title}</span>
            <span className="w-pr-review-menu__text">{choice.text}</span>
          </MenuItem>
        ))}
      </Menu>
    </span>
  )
}
