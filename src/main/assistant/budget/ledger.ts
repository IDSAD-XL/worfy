// The usage ledger of the Assistant: every call it made, its automatic wakes and the cost of every
// other turn worfy ran, in <WORFY_DATA_DIR>/assistant/usage.json (ADR 0005: worfy's own state only).
// The rules of the summary, the daily count and the estimate are in src/shared/assistant/budget.ts.
//
// Who notes what:
// - noteWake — the decision to wake (worfy-assistant ticket 06), before the Session starts, so a wake
//   that fails still counts against the daily limit; the user's own messages are not wakes;
// - noteCall — each `result` of an Assistant Session (ticket 10) and each check of a source
//   (ticket 11), with the `usage` and `costUsd` of that result;
// - noteOtherTurn — the `result` of every other Session worfy runs, for the estimate of the share;
//   never a turn of the Assistant, which noteCall already counts.
//
// Every note is written at once, synchronously (src/main/storage/json-file.ts), and drops what is
// older than USAGE_KEEP_MS: the file holds one week and a day, a few hundred calls at most.
import { join } from 'node:path'
import type { LimitsState } from '../../../shared/agent/limits'
import {
  automaticWakesToday,
  emptyUsageLedger,
  hourKey,
  limitsShare,
  pruneUsage,
  usageLedgerSchema,
  usageSummary,
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
    this.write({ ...this.ledger, wakes: [...this.ledger.wakes, { id, at, urgent }] }, at)
  }

  /** One call of the Assistant ended now. */
  noteCall(call: UsageCallInput): void {
    const at = this.now()
    this.write({ ...this.ledger, calls: [...this.ledger.calls, { ...call, at }] }, at)
  }

  /** A turn of another Session worfy runs ended now, at `costUsd`. */
  noteOtherTurn(costUsd: number): void {
    if (!(costUsd > 0)) return
    const at = this.now()
    const hour = hourKey(at)
    this.write({ ...this.ledger, otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + costUsd } }, at)
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
    this.ledger = pruneUsage(next, now)
    writeJsonFile(this.file, usageLedgerSchema, this.ledger)
  }
}

let appLedger: AssistantUsageLedger | null = null

/** The app's ledger over WORFY_DATA_DIR, made on first use. */
export function appAssistantUsage(): AssistantUsageLedger {
  appLedger ??= new AssistantUsageLedger({ dataDir: dataRoot() })
  return appLedger
}
