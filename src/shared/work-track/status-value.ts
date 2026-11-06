// The value of a Ticket's `Status:` line, in every form the git history of the Ticket files holds
// (worfy-work-track ticket 07; research 04 of worfy-autopilot-queue, item 5). The Harness writes
// `<state> <time>` today, with the time an ISO minute in UTC or a date (harness/bin/TICKETS.md); older
// Tickets wrote `<state> — <date>, <tail>`, a date and a time with no zone, or a bare word. The reader of
// git (src/main/work-track/ticket-status.ts) needs the state and the time of the change: this module reads
// both, and gives null for a form it does not know, never a guess. Pure functions: no Node, no DOM.
import type { TicketStatusState } from '../autopilot/journal'

/** When the value says the change happened. */
export type StatusTime =
  /** An instant: the value had a zone (`2026-11-05T07:39Z`); `at` is ISO in UTC. */
  | { kind: 'instant'; at: string }
  /** A date and a time with no zone (`2026-11-05 07:39`): the zone is the one of the commit that wrote it. */
  | { kind: 'local'; date: string; time: string }
  /** A date only (`2026-11-05`). */
  | { kind: 'date'; date: string }

export interface StatusValue {
  state: TicketStatusState
  /** `null`: the value names no time (`open`, `blocked — blocked by 05`). */
  time: StatusTime | null
}

// The words of the state. `in-progress` is the old word for claimed (bin/ticket folds it the same way).
const WORDS: ReadonlyMap<string, TicketStatusState> = new Map<string, TicketStatusState>([
  ['open', 'open'],
  ['claimed', 'claimed'],
  ['in-progress', 'claimed'],
  ['blocked', 'blocked'],
  ['done', 'done'],
])

// A date at the head of the rest of the value, with an optional time and zone, followed by its end, a
// space, a comma or a semicolon: `2026-11-05`, `2026-11-05T07:39Z`, `2026-11-05 07:39`,
// `2026-11-05T09:39:21+02:00`.
const WHEN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?(?=$|[\s,;])/

// The Status line of a Ticket header: `Status: …`, `**Status:** …` or `**Status**: …`.
const LINE = /^\*{0,2}Status\*{0,2}:\*{0,2}[ \t]*(.*?)[ \t\r]*$/i

/** The value of a `Status:` line of a Ticket header; null for any other line. */
export function statusLineValue(line: string): string | null {
  const m = LINE.exec(line)
  return m ? (m[1] ?? '') : null
}

/** Reads a `Status:` value: its state and its time. Null for an unknown form. */
export function parseStatusValue(value: string): StatusValue | null {
  const lead = value.replace(/\*\*[ \t]*$/, '').replace(/^[\s*]+/, '')
  const token = /^\S*/.exec(lead)?.[0] ?? ''
  const state = WORDS.get(token.replace(/[.,;:()]/g, '').toLowerCase())
  if (state === undefined) return null
  const rest = lead
    .slice(token.length)
    .trim()
    .replace(/^[—–:,;-]+[ \t]*/, '')
  return { state, time: timeOf(rest) }
}

function timeOf(rest: string): StatusTime | null {
  const m = WHEN.exec(rest)
  if (!m) return null
  const [, y, mo, d, hh, mm, ss, zone] = m
  const date = `${y}-${mo}-${d}`
  if (!realDate(Number(y), Number(mo), Number(d))) return null
  if (hh === undefined) return { kind: 'date', date }
  if (Number(hh) > 23 || Number(mm) > 59 || (ss !== undefined && Number(ss) > 59)) return null
  if (zone === undefined) return { kind: 'local', date, time: `${hh}:${mm}` }
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`
  return { kind: 'instant', at: new Date(`${date}T${hh}:${mm}:${ss ?? '00'}${offset}`).toISOString() }
}

function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/**
 * The instant of a value's time, ISO in UTC: an instant as it is; a time with no zone in the zone of
 * `commitDate` (an ISO date with its offset, as `git log --format=%aI` gives it). Null for a date only,
 * no time, or a commit date with no offset to read: the time of the commit stands in then.
 */
export function statusInstant(time: StatusTime | null, commitDate: string): string | null {
  if (time === null || time.kind === 'date') return null
  if (time.kind === 'instant') return time.at
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(commitDate)
  if (!zone) return null
  const at = new Date(`${time.date}T${time.time}:00${zone[1]}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}
