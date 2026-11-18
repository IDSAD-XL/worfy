// "Resolve conflicts", "Fix checks" and "Address comments" in the "what to do next" strip of the Pull requests view
// (worfy-pr-follow ticket 04), drawn after DraftRepliesButton (DraftThread.tsx). A click hands the PR to a Session of
// skill pr-fix: `actions.prFollow` with the Project, the PR and the action. Main reads the PR again, decides over that
// read and sends the rendered template to the live Session of the PR's Ticket or to a new Session Node
// (src/main/actions/launch.ts, prFollow); a short toast says which: "Sent to …", "Queued for …" or "Started a Session".
// A refusal of main is an error toast with its reason.
//
// Whether the button can run is usePrFollowState's (src/renderer/canvas/actions/gates.ts, ticket 01), the same verdict
// the Ticket Node and the Command palette take (ticket 05): a read-only screen, an empty or broken template, a PR that
// is not the user's, from a fork, or no longer has the reason. An inactive button keeps its focus and its kit tooltip
// with the reason (`aria-disabled`, not `disabled`: a disabled button shows no tooltip, as projects/read-only.ts says).
// An active one says in its native title the text it sends.
import { useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import { ACTION_LABELS, type PrFollowAction } from '../../shared/projects/action-templates'
import type { Ticket } from '../../shared/workflow/types'
import { usePrFollowState } from '../canvas/actions/gates'
import { invoke } from '../ipc'
import { ticketRef } from '../pipeline/board'
import { hintProps } from '../theme/kit/hint'
import { showToast } from '../toast/toasts'

export interface PrFollowButtonProps {
  projectId: string
  row: PrInboxRow
  action: PrFollowAction
  /** The PR's Ticket: the Session that takes the text when one is live is that Ticket's. */
  ticket: Ticket | undefined
  /** The main button of the strip. */
  primary?: boolean
}

/** Where the text went, as the toast says it after "<action> for <repo>#<N>: ". */
function deliveryText(delivery: 'sent' | 'queued' | 'new', ticket: Pick<Ticket, 'epic' | 'num'> | undefined): string {
  if (delivery === 'new') return 'Started a Session'
  const session = ticket === undefined ? "the Ticket's Session" : `the Session of ${ticketRef(ticket)}`
  return delivery === 'sent' ? `Sent to ${session}` : `Queued for ${session}`
}

export function PrFollowButton({ projectId, row, action, ticket, primary = false }: PrFollowButtonProps) {
  const state = usePrFollowState(projectId, row, action)
  const [running, setRunning] = useState(false)
  const label = ACTION_LABELS[action]
  const name = `${row.repo}#${row.number}`
  const hint = !state.enabled ? state.reason : running ? `${label} is starting for ${name}…` : null
  const run = (): void => {
    if (hint !== null) return
    setRunning(true)
    void invoke('actions.prFollow', { projectId, repo: row.repo, pr: row.number, action })
      .then((result) => {
        const key = `pr-follow ${projectId} ${name}`
        if (result.ok) showToast({ kind: 'success', key, projectId, testId: 'pr-follow-toast', text: `${label} for ${name}: ${deliveryText(result.value.delivery, ticket)}` })
        else showToast({ kind: 'error', key, projectId, testId: 'pr-follow-toast', text: `${label} for ${name} failed: ${failureReason('actions.prFollow', result.error)}` })
      })
      .finally(() => setRunning(false))
  }
  return (
    <button
      type="button"
      className={primary ? 'w-pr-inbox-button w-pr-inbox-button--primary' : 'w-pr-inbox-button'}
      data-testid="pr-inbox-follow"
      data-action={action}
      aria-disabled={hint === null ? 'false' : 'true'}
      {...(hint === null ? { title: state.enabled ? state.text : undefined } : hintProps(hint))}
      onClick={run}
    >
      {label}
    </button>
  )
}
