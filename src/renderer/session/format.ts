// How a Session's facts read on screen; shared by the Session view and the Orchestrator Node.
import type { SessionState } from '../../shared/agent/events'
import type { AnimatedNumberProps } from '../theme/AnimatedNumber'
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

/**
 * The cost as src/renderer/theme/AnimatedNumber.tsx draws it: dollars with cents, or with four decimals
 * below a dollar, where a turn costs fractions of a cent (`$0.00`, `$0.0125`, `$12.50`). The value is
 * rounded by toFixed first, as the text was before the digits rolled: Intl rounds the shortest decimal
 * form (1.005 → 1.01), toFixed the exact binary value (1.005 → 1.00).
 */
export function costNumber(usd: number): AnimatedNumberProps {
  const decimals = usd !== 0 && usd < 1 ? 4 : 2
  return { value: Number(usd.toFixed(decimals)), prefix: '$', format: { minimumFractionDigits: decimals, maximumFractionDigits: decimals } }
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
