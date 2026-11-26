// The usage ledger of the Assistant: every call it made, its automatic wakes and the cost of every
// other turn worfy ran, in <WORFY_DATA_DIR>/assistant/usage.json (ADR 0005: worfy's own state only).
// The rules of the summary, the daily count and the estimate are in src/shared/assistant/budget.ts.
//
// Who notes what:
// - noteWake — the decision to wake (worfy-assistant ticket 06), before the Session starts, so a wake
//   that fails still counts against the daily limit; the user's own messages are not wakes;
// - noteCall — each `result` of an Assistant Session (ticket 10) and each check of a source
//   (ticket 11), with the `usage` and `costUsd` of that result;
// - noteOtherTurn, noteOtherTotal, noteOtherRenamed — the cost of each turn of every other Session and request worfy
//   runs, for the estimate of the share (ticket 27), through src/main/agent/turn-cost.ts (ledgerTurnCostSink, set by
//   the app at its start); never a turn of the Assistant, which noteCall already counts. A request of one turn comes
//   with its cost (noteOtherTurn); a Session's turn comes as its conversation's running total (noteOtherTotal), and
//   the ledger keeps the last total of each conversation in its file (`otherTotals`), so a turn is counted once, as
//   the rise since the last result of the conversation, across processes, Sessions and restarts of worfy alike.
//
// Every note is written at once, synchronously (src/main/storage/json-file.ts), and drops what is
// older than USAGE_KEEP_MS. The file is bounded by that retention of 8 days, not by a count: Slack
// checked every 10 minutes over 10 working hours alone gives about 480 calls.
//
// A note outside the schema (a cost of NaN, negative tokens) is dropped with a warning: kept, it
// would make every later write refuse the whole ledger. The ledger in memory changes only after the
// file is written: when the write fails, the note throws and nothing of it stays.
import { join } from 'node:path'
import { z } from 'zod'
import type { LimitsState } from '../../../shared/agent/limits'
import { costSinceLast, type TurnCostSink } from '../../agent/turn-cost'
import {
  automaticWakesToday,
  emptyUsageLedger,
  hourKey,
  limitsShare,
  pruneUsage,
  usageCallSchema,
  usageLedgerSchema,
  usageSummary,
  usageWakeSchema,
  type LimitsShareEstimate,
  type UsageCallInput,
  type UsageLedger,
  type UsageSummary,
} from '../../../shared/assistant/budget'
import { appNow } from '../../clock'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'
import { dataRoot } from '../../storage/paths'

/** The ledger's file under WORFY_DATA_DIR. */
export const USAGE_FILE = join('assistant', 'usage.json')

export interface AssistantUsageLedgerOptions {
  /** WORFY_DATA_DIR. */
  dataDir: string
  /** Clock in milliseconds: main's (appNow, src/main/clock.ts) by default; tests pass a fake one. */
  now?: () => number
}

export class AssistantUsageLedger {
  private readonly file: string
  private readonly now: () => number
  private ledger: UsageLedger

  constructor(options: AssistantUsageLedgerOptions) {
    this.file = join(options.dataDir, USAGE_FILE)
    this.now = options.now ?? appNow
    this.ledger = readJsonFile(this.file, usageLedgerSchema) ?? emptyUsageLedger()
  }

  /** An automatic wake starts now; `id` names it for the calls of its Session. */
  noteWake(id: string, urgent: boolean): void {
    const at = this.now()
    const wake = usageWakeSchema.safeParse({ id, at, urgent })
    if (!wake.success) return console.warn(`worfy: an Assistant wake was not noted: ${z.prettifyError(wake.error)}`)
    this.write({ ...this.ledger, wakes: [...this.ledger.wakes, wake.data] }, at)
  }

  /** One call of the Assistant ended now. */
  noteCall(call: UsageCallInput): void {
    const at = this.now()
    const parsed = usageCallSchema.safeParse({ ...call, at })
    if (!parsed.success) return console.warn(`worfy: an Assistant call was not noted: ${z.prettifyError(parsed.error)}`)
    this.write({ ...this.ledger, calls: [...this.ledger.calls, parsed.data] }, at)
  }

  /** A turn of another Session worfy runs ended now, at `costUsd`; a turn that cost nothing changes nothing. */
  noteOtherTurn(costUsd: number): void {
    if (!Number.isFinite(costUsd)) return console.warn(`worfy: the cost of a turn was not noted: ${costUsd}`)
    if (costUsd <= 0) return
    const at = this.now()
    const hour = hourKey(at)
    this.write({ ...this.ledger, otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + costUsd } }, at)
  }

  /**
   * The latest result of another Session's conversation reports `totalUsd` so far: the rise since its last total (all
   * of it for a conversation not known, or one whose total went down) counts as a turn now. The same total again (an
   * interrupted turn) and a total of 0 (a Codex Session) change nothing.
   */
  noteOtherTotal(conversationId: string, totalUsd: number): void {
    if (!Number.isFinite(totalUsd)) return console.warn(`worfy: the cost of a turn was not noted: ${totalUsd}`)
    const last = this.ledger.otherTotals[conversationId]?.totalUsd
    if (totalUsd <= 0 || totalUsd === last) return
    const at = this.now()
    const turn = costSinceLast(last, totalUsd)
    const hour = hourKey(at)
    this.write(
      {
        ...this.ledger,
        otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + turn },
        otherTotals: { ...this.ledger.otherTotals, [conversationId]: { totalUsd, at } },
      },
      at,
    )
  }

  /** Another Session's conversation goes on under id `to` in the same process: its total goes on from that of `from`. */
  noteOtherRenamed(from: string, to: string): void {
    const last = this.ledger.otherTotals[from]
    if (last === undefined || this.ledger.otherTotals[to] !== undefined) return
    this.write({ ...this.ledger, otherTotals: { ...this.ledger.otherTotals, [to]: last } }, this.now())
  }

  snapshot(): UsageLedger {
    return this.ledger
  }

  /** The tokens of the local day and of the week. */
  summary(): UsageSummary {
    return usageSummary(this.ledger, this.now())
  }

  /** The automatic wakes since the local midnight, for the daily limit (wake-gate.ts). */
  automaticWakesToday(): number {
    return automaticWakesToday(this.ledger, this.now())
  }

  /** The Assistant's estimated share of each Limits window in force: an estimate, never a measure. */
  limitsShare(limits: LimitsState): LimitsShareEstimate[] {
    return limitsShare(this.ledger, limits.windows, this.now())
  }

  private write(next: UsageLedger, now: number): void {
    const pruned = pruneUsage(next, now)
    writeJsonFile(this.file, usageLedgerSchema, pruned)
    this.ledger = pruned
  }
}

let appLedger: AssistantUsageLedger | null = null

/** The sink of the cost of the turns that are not the Assistant's (src/main/agent/turn-cost.ts) into the ledger `ledger` answers. */
export function ledgerTurnCostSink(ledger: () => AssistantUsageLedger): TurnCostSink {
  return {
    turn: (costUsd) => ledger().noteOtherTurn(costUsd),
    conversationTotal: (conversationId, totalUsd) => ledger().noteOtherTotal(conversationId, totalUsd),
    renamed: (from, to) => ledger().noteOtherRenamed(from, to),
  }
}

/** The app's ledger over WORFY_DATA_DIR, made on first use. */
export function appAssistantUsage(): AssistantUsageLedger {
  appLedger ??= new AssistantUsageLedger({ dataDir: dataRoot() })
  return appLedger
}
