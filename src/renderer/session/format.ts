// How a Session's facts read on screen; shared by the Session view and the Orchestrator Node.
import type { SessionState } from '../../shared/agent/events'
import type { Status } from '../theme/primitives'

/** The chip of each Session state: a status colour always paired with its label (F-SPEC). */
export const STATE_CHIPS: Record<SessionState, { status: Status; label: string }> = {
  starting: { status: 'working', label: 'starting' },
  busy: { status: 'working', label: 'busy' },
  idle: { status: 'ready', label: 'idle' },
  needs_permission: { status: 'blocked', label: 'needs permission' },
  error: { status: 'blocked', label: 'error' },
  closed: { status: 'done', label: 'closed' },
}

/** Dollars with cents, or with four decimals below a dollar, where a turn costs fractions of a cent. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`
}

/** Claude Code's permission modes, as the Session header names them. */
const PERMISSION_LABELS: Readonly<Record<string, string>> = {
  default: 'ask',
  acceptEdits: 'accept edits',
  bypassPermissions: 'bypass',
  plan: 'plan',
  dontAsk: "don't ask",
}

export function permissionLabel(mode: string): string {
  return PERMISSION_LABELS[mode] ?? mode
}

/** Seconds with one decimal below a minute, then minutes and seconds. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)} m ${seconds % 60} s`
}
