// What Settings → Assistant says of a number, a time and a check that failed (worfy-assistant ticket 15): plain
// functions, apart from the components, so Fast Refresh keeps working on those.
import { CHECK_LABELS } from '../../shared/assistant/settings-change'
import type { SettingsCheck } from '../../shared/assistant/settings-view'

/** The tokens in thousands: «25.8k», or the plain number under a thousand. */
export function tokensText(tokens: number): string {
  return tokens < 1000 ? String(Math.round(tokens)) : `${(Math.round(tokens / 100) / 10).toFixed(1)}k`
}

export const timeText = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** «Slack: 3 failures in a row, next check at 14:20». */
export function failureLine(check: Pick<SettingsCheck, 'kind' | 'failures' | 'nextAt'>): string {
  const times = check.failures === 1 ? '1 failure in a row' : `${check.failures} failures in a row`
  const next = check.nextAt === null ? 'no check while it is off' : `next check at ${timeText(check.nextAt)}`
  return `${CHECK_LABELS[check.kind]}: ${times}, ${next}`
}

