// The approvals chip (worfy-pr-review ticket 03): how many approvals of a PR count and how many the rule of its base
// branch asks for — `1/2`, `✓ 2/2`, `✕ 1/2`, `1/?` — as the prototype of ticket 01 draws it (state `chips`). The texts
// are approvalsChip of usePrInbox.ts; the chip always carries text, its colour comes second (tokens `--ready-*`,
// `--blocked-*`), and its accessible name says it in words. It stands in a row of the PR inbox, in the Approvals cell
// of the PR pane, on a Pipeline card on Stage Human review and on a Ticket card on the Canvas.
import { approvalsChip } from './usePrInbox'
import type { PrApprovals } from '../../shared/ipc/pr-inbox'
import './approvals-chip.css'

export interface ApprovalsChipProps {
  approvals: PrApprovals | undefined
  /** «approvals» after a count: `1/2 approvals`, where the chip stands without a heading. */
  word?: boolean
  /** The larger chip of the Approvals cell. */
  large?: boolean
  /** The compact 16 px chip of a Ticket card. */
  compact?: boolean
}

function Clock() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

/** The chip; nothing when nothing asks for reviews or main has not read approvals. */
export function ApprovalsChip({ approvals, word = false, large = false, compact = false }: ApprovalsChipProps) {
  const chip = approvalsChip(approvals)
  if (chip === null) return null
  const size = large ? ' w-approvals-chip--large' : compact ? ' w-approvals-chip--compact' : ''
  return (
    <span className={`w-approvals-chip w-approvals-chip--${chip.tone}${size}`} data-testid="approvals-chip" data-tone={chip.tone} role="img" aria-label={chip.label} title={chip.tooltip}>
      {chip.owners ? <Clock /> : null}
      {chip.text}
      {word && chip.count ? <span className="w-approvals-chip__word"> approvals</span> : null}
    </span>
  )
}
