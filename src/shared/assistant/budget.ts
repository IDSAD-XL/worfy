// The budget of the Assistant (epic worfy-assistant, ticket 05): what it spent and how often it may
// wake by itself. Everything here is pure; main keeps the ledger (src/main/assistant/budget/ledger.ts)
// and checks a wake (src/main/assistant/budget/wake-gate.ts), the Assistant's screen shows the summary.
//
// - Every call is noted with its tokens and its cost: a turn of an Assistant Session (a `wake` the
//   Assistant woke for by itself, or the `conversation` the user started) and every `source-check`.
// - The summary covers the local day (since the local midnight) and the week (the local day and the
//   six before it, counted by calendar dates, so a day of 23 or 25 hours is one day). It breaks the
//   tokens down by source, by wake and for the conversation. The calls of a wake count on the day of
//   the wake, so a wake at 23:59 and its call at 00:05 stay together; a `wake` call whose wake the
//   ledger does not hold (no id, or dropped after USAGE_KEEP_MS) counts at its own time, in
//   `wakes.total` but in no `byWake` entry.
// - The share of a Limits window is an estimate: worfy sees only the share of the whole window, never
//   that of one call. Method `cost-share`: the window's share times the Assistant's part of the cost
//   of all turns worfy saw since the window began — the Assistant's calls plus every other turn noted
//   with noteOtherTurn. The cost (the SDK's `total_cost_usd`) weighs a model and the cache the way
//   the price does, closer to what a window counts than a plain sum of tokens. Claude used outside
//   worfy is not seen and only adds to the window, so for the turns counted the estimate errs high;
//   with no other turn noted it is the whole window. Other turns are kept by the hour, so both sides
//   are counted from the start of the hour the window began in: up to an hour of turns from before
//   the window, the Assistant's and the others' alike.
import { z } from 'zod'
import { claudeWindowMinutes } from '../agent/limits'

/** Automatic wakes of the Assistant a local day allows by default; the user's own calls are not counted. */
export const ASSISTANT_DAILY_WAKE_LIMIT = 20

/** The calls, wakes and other turns older than this are dropped from the ledger: the week and a day of margin. */
export const USAGE_KEEP_MS = 8 * 24 * 60 * 60_000

const tokens = z.number().nonnegative()

/** The tokens of one call, as the `result` event of a Session gives them (src/shared/agent/events.ts). */
export const callUsageSchema = z.object({
  inputTokens: tokens,
  outputTokens: tokens,
  cacheCreationInputTokens: tokens,
  cacheReadInputTokens: tokens,
})
export type CallUsage = z.infer<typeof callUsageSchema>

export const USAGE_CALL_KINDS = ['wake', 'conversation', 'source-check'] as const

export const usageCallSchema = z.object({
  /** When the call ended, in milliseconds since the epoch. */
  at: z.number(),
  kind: z.enum(USAGE_CALL_KINDS),
  /** The source a `source-check` read (`slack`, `jira`, …); null for the other kinds. */
  source: z.string().nullable(),
  /** The wake a `wake` call belongs to (AssistantUsageLedger.noteWake); null for the other kinds. */
  wakeId: z.string().nullable(),
  model: z.string().nullable(),
  usage: callUsageSchema,
  costUsd: z.number().nonnegative(),
})
export type UsageCall = z.infer<typeof usageCallSchema>
/** A call as its caller notes it: the ledger stamps the time. */
export type UsageCallInput = Omit<UsageCall, 'at'>

export const usageWakeSchema = z.object({
  id: z.string(),
  at: z.number(),
  /** Whether the wake was urgent; both kinds count against the daily limit. */
  urgent: z.boolean(),
})
export type UsageWake = z.infer<typeof usageWakeSchema>

export const usageLedgerSchema = z.object({
  /** The automatic wakes, in the order they happened. */
  wakes: z.array(usageWakeSchema),
  calls: z.array(usageCallSchema),
  /** The cost of the turns of every other Session worfy ran, in USD, by the start of the hour (ms, as a string key). */
  otherCost: z.record(z.string(), z.number().nonnegative()),
  /**
   * The last running total in USD each conversation of another Session reported, and when (worfy-assistant ticket 27):
   * Claude Code restores it when it resumes the conversation, so its next turn costs only the rise. Absent in a file
   * written before it: none known.
   */
  otherTotals: z.record(z.string(), z.object({ totalUsd: z.number().nonnegative(), at: z.number() })).default({}),
})
export type UsageLedger = z.infer<typeof usageLedgerSchema>

export const emptyUsageLedger = (): UsageLedger => ({ wakes: [], calls: [], otherCost: {}, otherTotals: {} })

export interface TokenTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  /** The four kinds together. */
  tokens: number
  costUsd: number
}

export interface UsagePeriod {
  /** The start of the period, a local midnight, in ms. */
  from: number
  total: TokenTotals
  /** The checks of sources, by source. */
  sources: Record<string, TokenTotals>
  wakes: {
    /** The automatic wakes in the period. */
    count: number
    total: TokenTotals
    /** Each wake of the period with its calls, in the order of the wakes. */
    byWake: { id: string; at: number; urgent: boolean; total: TokenTotals }[]
  }
  /** What the user started: their messages to the Assistant. */
  conversation: TokenTotals
}

export interface UsageSummary {
  day: UsagePeriod
  week: UsagePeriod
}

export interface LimitsShareEstimate {
  window: string
  /** Always true: the share of one caller is never known, see the method. */
  estimate: true
  method: 'cost-share'
  /** The share of the whole window, 0..1, as the Limits give it. */
  utilization: number
  /** The Assistant's estimated part of it, 0..utilization. */
  share: number
  /** When the window began, in ms: its reset less its length. */
  since: number
}

const HOUR_MS = 60 * 60_000

/** The start of the hour of `at`, the key of `otherCost`. */
export function hourKey(at: number): string {
  return String(Math.floor(at / HOUR_MS) * HOUR_MS)
}

/** The local midnight `daysBack` calendar days before the day of `now`. */
export function localMidnight(now: number, daysBack = 0): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - daysBack)
  return day.getTime()
}

/** The local midnight after the day of `now`. */
export function nextLocalMidnight(now: number): number {
  const day = new Date(now)
  day.setHours(24, 0, 0, 0)
  return day.getTime()
}

const noTokens = (): TokenTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, tokens: 0, costUsd: 0 })

function add(totals: TokenTotals, call: UsageCall): void {
  const { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } = call.usage
  totals.calls += 1
  totals.inputTokens += inputTokens
  totals.outputTokens += outputTokens
  totals.cacheCreationInputTokens += cacheCreationInputTokens
  totals.cacheReadInputTokens += cacheReadInputTokens
  totals.tokens += inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
  totals.costUsd += call.costUsd
}

/** When a call counts: a `wake` call at the time of its wake when the ledger holds it, any other at its own time. */
function countedAt(call: UsageCall, wakeTimes: ReadonlyMap<string, number>): number {
  return (call.kind === 'wake' && call.wakeId !== null ? wakeTimes.get(call.wakeId) : undefined) ?? call.at
}

// Nothing here has an upper bound at `now`: a note stamped later than now (the clock went back) still counts.
function period(ledger: UsageLedger, from: number): UsagePeriod {
  const wakeTimes = new Map(ledger.wakes.map((wake) => [wake.id, wake.at]))
  const wakes = ledger.wakes.filter((wake) => wake.at >= from)
  const byWake = new Map(wakes.map((wake) => [wake.id, { ...wake, total: noTokens() }]))
  const out: UsagePeriod = { from, total: noTokens(), sources: {}, wakes: { count: wakes.length, total: noTokens(), byWake: [] }, conversation: noTokens() }
  for (const call of ledger.calls) {
    if (countedAt(call, wakeTimes) < from) continue
    add(out.total, call)
    if (call.kind === 'conversation') add(out.conversation, call)
    else if (call.kind === 'source-check') add((out.sources[call.source ?? 'unknown'] ??= noTokens()), call)
    else {
      add(out.wakes.total, call)
      const wake = call.wakeId === null ? undefined : byWake.get(call.wakeId)
      if (wake !== undefined) add(wake.total, call)
    }
  }
  out.wakes.byWake = [...byWake.values()]
  return out
}

/** The tokens of the local day and of the week, at `now`. */
export function usageSummary(ledger: UsageLedger, now: number): UsageSummary {
  return { day: period(ledger, localMidnight(now)), week: period(ledger, localMidnight(now, 6)) }
}

/** The automatic wakes since the local midnight of `now`, a wake stamped after `now` included. */
export function automaticWakesToday(ledger: UsageLedger, now: number): number {
  const from = localMidnight(now)
  return ledger.wakes.filter((wake) => wake.at >= from).length
}

/** The Assistant's estimated share of each Limits window in force whose share, reset and length are known. */
export function limitsShare(ledger: UsageLedger, windows: Readonly<Record<string, { utilization: number | null; resetsAt: number | null }>>, now: number): LimitsShareEstimate[] {
  const out: LimitsShareEstimate[] = []
  for (const [window, state] of Object.entries(windows)) {
    const minutes = claudeWindowMinutes(window)
    if (minutes === null || state.utilization === null || state.resetsAt === null || state.resetsAt * 1000 <= now) continue
    const since = state.resetsAt * 1000 - minutes * 60_000
    // Both sides from the start of the hour the window began in: the other turns are kept by the hour.
    const from = Number(hourKey(since))
    let assistant = 0
    for (const call of ledger.calls) if (call.at >= from) assistant += call.costUsd
    let other = 0
    for (const [hour, cost] of Object.entries(ledger.otherCost)) if (Number(hour) >= from) other += cost
    const all = assistant + other
    out.push({ window, estimate: true, method: 'cost-share', utilization: state.utilization, share: all > 0 ? (state.utilization * assistant) / all : 0, since })
  }
  return out
}

/** The ledger without what is older than USAGE_KEEP_MS at `now`. */
export function pruneUsage(ledger: UsageLedger, now: number): UsageLedger {
  const from = now - USAGE_KEEP_MS
  return {
    wakes: ledger.wakes.filter((wake) => wake.at >= from),
    calls: ledger.calls.filter((call) => call.at >= from),
    otherCost: Object.fromEntries(Object.entries(ledger.otherCost).filter(([hour]) => Number(hour) >= from - HOUR_MS)),
    otherTotals: Object.fromEntries(Object.entries(ledger.otherTotals).filter(([, last]) => last.at >= from)),
  }
}
