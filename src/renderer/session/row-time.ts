// When a row of a chat happened, in local time: the Session view's transcript (Transcript.tsx) and the Assistant's
// Chat (assistant/AssistantPanel.tsx; worfy-polish ticket 171) show it in one format.
import { createContext, useContext, useEffect, useState } from 'react'

/** The time rows are dated against (useToday): which of them are of today. */
export const NowContext = createContext(0)

/**
 * The time now, taken when the view mounts and again at every local midnight, so a row of yesterday gets its date
 * while the view stays open.
 */
export function useToday(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setNow(Date.now()), Math.max(midnight.getTime() - now, 1000))
    return () => clearTimeout(timer)
  }, [now])
  return now
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (value: number): string => String(value).padStart(2, '0')

export type RowWhen = { date: string | null; clock: string; full: string }

/**
 * When a row happened, in local time: `HH:MM`, a date before it for a row of another day than
 * today (`Oct 4`, `Dec 31 '25` in another year), and the full time with seconds for the tooltip.
 */
export function rowTime(at: number, now: number): RowWhen {
  const when = new Date(at)
  const today = new Date(now)
  const clock = `${two(when.getHours())}:${two(when.getMinutes())}`
  const full = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${clock}:${two(when.getSeconds())}`
  const sameDay = when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate()
  if (sameDay) return { date: null, clock, full }
  const day = `${MONTHS[when.getMonth()] ?? ''} ${when.getDate()}`
  return { date: when.getFullYear() === today.getFullYear() ? day : `${day} '${String(when.getFullYear()).slice(-2)}`, clock, full }
}

/** When a row happened (rowTime) against `now`; null without a time Date can hold. */
export function rowTimeOf(at: number | null, now: number): RowWhen | null {
  // A time Date cannot hold (out of its range) is shown as none rather than thrown on.
  return at === null || !Number.isFinite(new Date(at).getTime()) ? null : rowTime(at, now)
}

/** When a row happened (rowTime), against the transcript's today (NowContext). */
export function useRowTime(at: number | null): RowWhen | null {
  return rowTimeOf(at, useContext(NowContext))
}
