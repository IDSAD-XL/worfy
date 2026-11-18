// Which of "Resolve conflicts", "Fix checks" and "Address comments" the PRs of a Ticket offer, and how a row names one
// (worfy-pr-follow ticket 05): the button on the Ticket Node (PrFollow.tsx) and the rows of the Command palette
// (palette/commands.ts) list the same choices from here. Pure, and not a slot module: the action slot
// (badges/index.ts) collects only the .tsx files of this folder, and a .tsx slot may export only components.
//
// The reasons come from the Project's PR inbox, not from the Pipeline: the action needs the PR's repository, number
// and head, which only a row of the inbox holds (the Epic's spec, decided without the owner, item 5). The Ticket's PRs
// are the ones the review threads badge counts (reviewsOfTicket: its `PR:` lines, else its branch).
import { prFollowReasons } from '../../../shared/actions/pr-follow'
import type { PrInboxRow, PrInboxSnapshot } from '../../../shared/ipc/pr-inbox'
import { ACTION_LABELS, type PrFollowAction } from '../../../shared/projects/action-templates'
import type { Ticket } from '../../../shared/workflow/types'
import { findRow } from '../../pr-inbox/usePrInbox'
import { reviewsOfTicket } from '../badges/review-threads'

/** One action a Ticket's PR has a reason for: the row of the PR inbox and the action. */
export interface PrFollowChoice {
  row: PrInboxRow
  action: PrFollowAction
}

/**
 * The actions the PRs of `ticket` have a reason for: each PR of the snapshot that is the Ticket's, in the order of the
 * inbox's groups, with its reasons in the order of PR_FOLLOW_ACTIONS (prFollowReasons). Empty when the snapshot is
 * absent, the inbox is off (`"prInbox": false`) or it holds none of the Ticket's PRs. `tickets`: the Project's
 * Tickets, which decide whose a PR is.
 */
export function prFollowChoices(snapshot: PrInboxSnapshot | undefined, ticket: Pick<Ticket, 'epic' | 'num'>, tickets: readonly Ticket[]): PrFollowChoice[] {
  if (snapshot === undefined) return []
  const pulls = reviewsOfTicket(snapshot, ticket, tickets)?.pulls ?? []
  return pulls.flatMap((pull) => {
    const row = findRow(snapshot, pull)?.row
    return row === undefined ? [] : prFollowReasons(row, snapshot.viewer).map((action) => ({ row, action }))
  })
}

/** «Fix checks owner/web#118»: the action and its PR, as a palette row and an item of a Ticket over several PRs say it. */
export const prFollowTitle = ({ row, action }: PrFollowChoice): string => `${ACTION_LABELS[action]} ${row.repo}#${row.number}`
