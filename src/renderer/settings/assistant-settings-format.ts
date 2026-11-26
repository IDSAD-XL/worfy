// What Settings → Assistant says of a number, a time and a check that failed (worfy-assistant ticket 15): plain
// functions, apart from the components, so Fast Refresh keeps working on those.
import { CHECK_LABELS } from '../../shared/assistant/settings-change'
import type { CheckKind } from '../../shared/assistant/schedule/settings'
import type { CheckNowRefusal, SettingsCheck } from '../../shared/assistant/settings-view'

/** The tokens in thousands: «25.8k», or the plain number under a thousand. */
export function tokensText(tokens: number): string {
  return tokens < 1000 ? String(Math.round(tokens)) : `${(Math.round(tokens / 100) / 10).toFixed(1)}k`
}

export const timeText = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

const DAY = 24 * 60 * 60_000

/**
 * The line next to the switch (ticket 25; the prototype's «On since Monday»): «On since today, 09:12», «On since
 * yesterday», the weekday within the last week, else the date — «On since 3 Nov», with the year when it is not this one.
 */
export function onSinceText(at: number, now: number): string {
  const day = (moment: number): number => {
    const date = new Date(moment)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const days = Math.round((day(now) - day(at)) / DAY)
  const date = new Date(at)
  if (days <= 0) return `On since today, ${timeText(at)}`
  if (days === 1) return 'On since yesterday'
  if (days < 7) return `On since ${date.toLocaleDateString('en-GB', { weekday: 'long' })}`
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return `On since ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

/** «Slack: 3 failures in a row, next check at 14:20». */
export function failureLine(check: Pick<SettingsCheck, 'kind' | 'failures' | 'nextAt'>): string {
  const times = check.failures === 1 ? '1 failure in a row' : `${check.failures} failures in a row`
  const next = check.nextAt === null ? 'no check while it is off' : `next check at ${timeText(check.nextAt)}`
  return `${CHECK_LABELS[check.kind]}: ${times}, ${next}`
}


const REFUSALS: Record<CheckNowRefusal, string> = {
  'not-registered': 'it does not run on this Mac',
  stopped: 'the checks have not started yet',
  asleep: 'the checks wait while the Mac sleeps',
  'assistant-off': 'the Assistant is off',
  'check-off': 'the check is turned off',
  running: 'it is running already',
}

/** «The Slack check did not start: the Assistant is off.» — why main started nothing on Check now. */
export function checkNowRefusalText(kind: CheckKind, refused: CheckNowRefusal | null): string {
  return `The ${CHECK_LABELS[kind]} check did not start: ${refused === null ? 'it is running already, or the Assistant is off' : REFUSALS[refused]}.`
}
