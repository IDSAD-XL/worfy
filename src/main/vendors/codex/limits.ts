// The limits part of the Codex driver (ADR-0094 item 2; worfy-multi-vendor ticket 21): the windows of
// the ChatGPT plan as Limit windows (src/shared/agent/limits.ts). Codex sends up to two windows,
// `primary` and `secondary`, each with its length in minutes (ticket 03): the request
// `account/rateLimits/read` answers them without a model request, and the notification
// `account/rateLimits/updated` brings them during a turn. A Codex refusal by its Limits is a turn error
// with `codexErrorInfo: "usageLimitExceeded"`; worfy turns it into a `limit_reached` event (decision 09).
//
// The schedule of the background ask is LimitsRefresher (src/main/agent/limits-usage.ts), which polls
// through `poll` and keeps the windows in the LimitsTracker next to Claude's (src/main/agent/limits.ts).
import { existsSync } from 'node:fs'
import type { AgentEvent } from '../../../shared/agent/events'
import type { LimitWindow } from '../../../shared/agent/limits'
import type { LimitsPart } from '../limits'
import { appCodexStarter, CODEX_ASK_TIMEOUT_MS, codexHomeOf, readCodexAccount, withCodex, type CodexAsk, type StartCodex } from './account'
import type { AccountRateLimitsUpdatedNotification } from './protocol/ts/v2/AccountRateLimitsUpdatedNotification'
import type { ErrorNotification } from './protocol/ts/v2/ErrorNotification'
import type { GetAccountRateLimitsResponse } from './protocol/ts/v2/GetAccountRateLimitsResponse'
import type { RateLimitSnapshot } from './protocol/ts/v2/RateLimitSnapshot'

export const CODEX_VENDOR = 'codex'

/** Where a window came from: the answer of `account/rateLimits/read`, or `account/rateLimits/updated`. */
export type CodexLimitsSource = 'read' | 'updated'

/**
 * The labels of window lengths, as the Codex TUI picks them (codex-rs/tui/src/chatwidget/rate_limits.rs,
 * get_limits_duration, rust-v0.166.0): a length within 5 % of one of these, a month being 30 days.
 */
const WINDOW_LABELS: readonly { minutes: number; label: string }[] = [
  { minutes: 5 * 60, label: '5h' },
  { minutes: 24 * 60, label: 'daily' },
  { minutes: 7 * 24 * 60, label: 'weekly' },
  { minutes: 30 * 24 * 60, label: 'monthly' },
  { minutes: 365 * 24 * 60, label: 'annual' },
]

export type CodexWindowId = 'primary' | 'secondary'

/**
 * The label of a window by its length; for a length none of the labels fits, or none, the TUI's
 * fallback: `usage` for the primary window, `secondary usage` for the secondary one.
 */
export function codexWindowLabel(minutes: number | null, id: CodexWindowId): string {
  const fits = minutes === null ? undefined : WINDOW_LABELS.find((known) => minutes >= known.minutes * 0.95 && minutes <= known.minutes * 1.05)
  if (fits !== undefined) return fits.label
  return id === 'primary' ? 'usage' : 'secondary usage'
}

/**
 * The windows of one snapshot of Codex's rate limits. A window is `reached` when Codex says a limit
 * was reached (`rateLimitReachedType`) or it is used up (`usedPercent` 100 or more), `ok` otherwise:
 * Codex sends no warning level.
 */
export function codexLimitWindows(snapshot: RateLimitSnapshot, receivedAt: number, source: CodexLimitsSource): LimitWindow[] {
  const reachedType = snapshot.rateLimitReachedType ?? null
  return (['primary', 'secondary'] as const).flatMap((id): LimitWindow[] => {
    const window = snapshot[id] ?? null
    if (window === null) return []
    const windowMinutes = window.windowDurationMins ?? null
    return [
      {
        vendor: CODEX_VENDOR,
        id,
        label: codexWindowLabel(windowMinutes, id),
        usedPercent: window.usedPercent,
        windowMinutes,
        resetsAt: window.resetsAt ?? null,
        state: reachedType !== null || window.usedPercent >= 100 ? 'reached' : 'ok',
        receivedAt,
        source,
      },
    ]
  })
}

/**
 * The `limits` event of an `account/rateLimits/updated` notification: its windows, and as the status
 * the `rateLimitReachedType` Codex named, if any (it names no window and no reset time).
 */
export function codexLimitsEvent(params: AccountRateLimitsUpdatedNotification, receivedAt: number): Extract<AgentEvent, { type: 'limits' }> {
  const reachedType = params.rateLimits.rateLimitReachedType ?? null
  return {
    type: 'limits',
    vendor: CODEX_VENDOR,
    windows: codexLimitWindows(params.rateLimits, receivedAt, 'updated'),
    status: reachedType === null ? null : { text: reachedType, state: 'reached', windowId: null, resetsAt: null },
  }
}

/** What a refusal by the Limits means: which window to wait for and until when, or a quota with nothing to wait for. */
export type CodexLimitReached = Pick<Extract<AgentEvent, { type: 'limit_reached' }>, 'windowId' | 'resetsAt' | 'reason'>

/**
 * Decision 09: a window used up (100 % or more) with a reset time — `window`, wait for it; of several,
 * the one that resets last, since the turn waits for every one. Otherwise `quota`: the plan does not
 * include Codex or a quota ran out without a window, and nothing resets (the same `usageLimitExceeded`
 * comes for QuotaExceeded and UsageNotIncluded, ticket 03).
 */
export function codexLimitReached(windows: readonly LimitWindow[]): CodexLimitReached {
  let last: LimitWindow | null = null
  for (const window of windows) {
    if (window.usedPercent === null || window.usedPercent < 100 || window.resetsAt === null) continue
    if (last === null || window.resetsAt > (last.resetsAt as number)) last = window
  }
  return last === null ? { windowId: null, resetsAt: null, reason: 'quota' } : { windowId: last.id, resetsAt: last.resetsAt, reason: 'window' }
}

/** The answer of `account/rateLimits/read`: the windows, and whether the plan's ordinary use is allowed now (null: unknown). */
export interface CodexRateLimits {
  windows: LimitWindow[]
  /** Codex's word on whether worfy may go on; percentages and reset times do not tell (app-server documentation). */
  ordinaryUsageAllowed: boolean | null
}

/**
 * Asks `account/rateLimits/read` of a running app-server. `background`: a poll, which skips the
 * reset-credit details (`excludeResetCreditDetails`), as Codex asks of background polls.
 */
export async function readCodexRateLimits(ask: Pick<CodexAsk, 'request'>, background: boolean, now: () => number = Date.now): Promise<CodexRateLimits> {
  const answer = await ask.request<GetAccountRateLimitsResponse>('account/rateLimits/read', background ? { excludeResetCreditDetails: true } : {}, CODEX_ASK_TIMEOUT_MS)
  return { windows: codexLimitWindows(answer.rateLimits, now(), 'read'), ordinaryUsageAllowed: answer.ordinaryUsageAllowed ?? null }
}

/** A refusal by the Limits as a `limit_reached` event, with the windows it was decided by. */
export interface CodexLimitReachedEvent extends CodexRateLimits {
  event: Extract<AgentEvent, { type: 'limit_reached' }>
}

/**
 * The `limit_reached` event of a turn's `error` notification; null for any error but
 * `usageLimitExceeded`. Before the decision the windows are read again on the Session's app-server
 * (`ask`): the answer is fresher than `known`, the windows of the Session's last `limits` event, which
 * stay the basis when the read fails. `ordinaryUsageAllowed` is passed on for the caller that decides
 * whether to wait.
 */
export async function codexLimitReachedEvent(ask: Pick<CodexAsk, 'request'>, error: ErrorNotification, known: readonly LimitWindow[], now: () => number = Date.now): Promise<CodexLimitReachedEvent | null> {
  if (error.error.codexErrorInfo !== 'usageLimitExceeded') return null
  let limits: CodexRateLimits = { windows: [...known], ordinaryUsageAllowed: null }
  try {
    limits = await readCodexRateLimits(ask, true, now)
  } catch (failure) {
    console.debug('[codex] reading the Limits after a refusal failed: the last windows of the Session decide', failure)
  }
  return { ...limits, event: { type: 'limit_reached', vendor: CODEX_VENDOR, ...codexLimitReached(limits.windows) } }
}

/** The limits part of the Codex driver, with the background poll of LimitsRefresher. */
export interface CodexLimitsPart extends LimitsPart {
  /**
   * One background ask on its own app-server: `account/read`, and only when signed in to Codex,
   * `account/rateLimits/read`. Null when not signed in, without starting anything when Codex has no
   * home folder. Rejects when the app-server does not start or answer; an abort of `signal` closes
   * the process and rejects at once.
   */
  poll(signal: AbortSignal): Promise<LimitWindow[] | null>
}

export interface CodexLimitsOptions {
  /** appCodexStarter by default; tests start the fake. */
  start?: StartCodex
  /** The folder Codex keeps its sign-in in; codexHomeOf() by default. */
  codexHome?: () => string
  /** Clock in milliseconds; tests pass a fixed one. */
  now?: () => number
}

export function codexLimitsPart(options: CodexLimitsOptions = {}): CodexLimitsPart {
  const start = options.start ?? appCodexStarter
  const codexHome = options.codexHome ?? (() => codexHomeOf())
  const now = options.now ?? Date.now
  return {
    // The windows now, on an app-server of its own; rejects when not signed in (Codex refuses the read).
    read: () => withCodex(start, undefined, async (ask) => (await readCodexRateLimits(ask, false, now)).windows),
    async poll(signal) {
      if (!existsSync(codexHome())) return null
      return withCodex(start, signal, async (ask) => ((await readCodexAccount(ask)).signedIn ? (await readCodexRateLimits(ask, true, now)).windows : null))
    },
  }
}

/** The limits part of the app's Codex driver. */
export const codexLimits: CodexLimitsPart = codexLimitsPart()
