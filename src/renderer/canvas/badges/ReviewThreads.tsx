import { useMemo, type ReactNode } from 'react'
import type { Ticket } from '../../../shared/workflow/types'
import { ApprovalsChip } from '../../pr-inbox/ApprovalsChip'
import { openPrInboxOf } from '../../pr-inbox/open'
import { approvalsChip, usePrInbox } from '../../pr-inbox/usePrInbox'
import { StatusChip } from '../../theme/primitives'
import { useWorkflow } from '../../workflow/useWorkflow'
import type { SlotProps } from './index'
import { reviewLabels, reviewsOfTicket, type TicketPull, type TicketReviews } from './review-threads'
import './review-threads.css'

// The review threads that wait for the user on a Ticket's PRs (worfy-pr-inbox ticket 06): «3 open threads» and/or
// «changes requested», read from the Project's PR inbox snapshot (usePrInbox, ticket 03) — no gh call of its own, no
// write anywhere. A click opens the Pull requests view on that PR (openPrInboxOf). A Ticket whose PR the snapshot does
// not hold shows nothing. A Ticket over several repositories (ADR-0104, item 3) sums its PRs: the PRs know nothing of
// each other, the link lives only in worfy (ticketOfRow).
//
// What it counts is in review-threads.ts. The card has room for the badge only because the layout knows of it:
// ticket-card.ts gives one line per chip (REVIEW_LINE), from `reviewChipsOf` over the same snapshot (sources/epics.ts).
//
// A PR short of approvals adds the approvals chip `1/2 approvals` (worfy-pr-review ticket 03, Q5 (a): only while the PR is
// open — the inbox holds open PRs only — and approvals are short): always on a line of its own, below the labels. Beside
// «changes requested» the pair is wider than the card (218 px), so the chip never shares a line; it never makes a line
// taller, and reviewLinesOf counts its line.

export const order = 15

/** The PR a click opens: the first that waits for the user, in the order of the view's groups. */
const firstWaiting = (reviews: TicketReviews): TicketPull | undefined => reviews.pulls.find((pull) => pull.threads > 0 || pull.changesRequested || pull.approvals !== null)

/** «example-org/web#118: 2 open threads, changes requested, 1 of 2 required approvals» per PR that waits, for the tooltip. */
function tooltipOf(reviews: TicketReviews): string {
  const lines = reviews.pulls.flatMap((pull) => {
    const chip = approvalsChip(pull.approvals ?? undefined)
    // The approvals in words, without a second «changes requested» when the chip of that name already says it.
    const approvals = chip === null ? [] : [pull.changesRequested ? chip.label.replace(/, changes requested$/u, '') : chip.label]
    const labels = [...reviewLabels(pull), ...approvals]
    return labels.length === 0 ? [] : [`${pull.repo}#${pull.number}: ${labels.join(', ')}`]
  })
  return `${lines.join('\n')}\nOpen in Pull requests`
}

function TicketReviewThreads({ projectId, root, ticket }: { projectId: string; root: string; ticket: Ticket }) {
  const { snapshot } = usePrInbox(projectId)
  const { model } = useWorkflow(root)
  // The model's list, the same for every Ticket Node: the map of whose PRs wait is made once for all of them.
  const alone = useMemo(() => [ticket], [ticket])
  const reviews = reviewsOfTicket(snapshot, ticket, model?.tickets ?? alone)
  const labels = reviewLabels(reviews)
  const target = reviews === null ? undefined : firstWaiting(reviews)
  if (reviews === null || (labels.length === 0 && reviews.short === null) || target === undefined) return null
  const lines: ReactNode[] = []
  if (reviews.threads > 0)
    lines.push(
      <span key="threads" data-testid="review-threads-count" data-value={reviews.threads}>
        <StatusChip status="working" label={labels[0]!} />
      </span>,
    )
  if (reviews.changesRequested)
    lines.push(
      <span key="changes" data-testid="review-threads-changes">
        <StatusChip status="blocked" label="changes requested" />
      </span>,
    )
  const chip = reviews.short === null ? null : <ApprovalsChip approvals={reviews.short.approvals ?? undefined} word compact />
  return (
    <button
      type="button"
      className="w-review-threads w-badge-button nodrag"
      data-testid="badge-review-threads"
      data-repo={target.repo}
      data-number={target.number}
      title={tooltipOf(reviews)}
      onClick={(event) => {
        event.stopPropagation()
        // The Canvas shows the active Project, so the view opens at once.
        void openPrInboxOf(projectId, projectId, { repo: target.repo, number: target.number })
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* A line per label, and the approvals chip alone on the last line. */}
      {[...lines, ...(chip === null ? [] : [chip])].map((line, index) => (
        <span key={index} className="w-review-threads__line">
          {line}
        </span>
      ))}
    </button>
  )
}

export default function ReviewThreads({ subject }: SlotProps) {
  if (subject.kind !== 'ticket') return null
  return <TicketReviewThreads projectId={subject.projectId} root={subject.root} ticket={subject.ticket} />
}
