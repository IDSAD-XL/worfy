// The decision to wake the Assistant (worfy-assistant ticket 06; spec, implementation decisions, the attention core,
// the decision on waking; owner's decisions 13 and 21). Code of main, no model: the items of the attention core
// (ticket 03), the clock, the work hours (ticket 04) and the Limits come in; a decision to wake goes out, and the
// Session of the Assistant (ticket 10) starts on it.
//
// - Urgent wakes at once, at any hour: an Autopilot Run stopped not by the user (isUrgentStop of
//   src/shared/assistant/attention.ts, ticket 23; the window reads urgency by the same rule), or work stands and the
//   closed list of actions did not help (escalate(), called by the closed list, ticket 08).
// - Non-urgent items wait and go in one batch in work hours: BATCH_GATHER_MS after the oldest of them came, and not
//   sooner than BATCH_SPACING_MS after the previous wake. Outside work hours they wait for the morning.
// - The morning summary: one wake per working day, at the first moment of work hours worfy sees (09:00, or when the
//   Mac wakes later). It carries the items that came overnight, so no batch follows it.
// - A message of the user wakes the model at once, without the checks below, and is not counted (ticket 05).
// - Before each automatic wake: the Limits and the daily limit (assistantWakeGate, ticket 05). A held wake stays
//   due and is looked at again when the gate says it may go (`until`); it is counted only when it goes.
//
// Each item is handed over once: the number of its events goes into the planner's file, so a restart, a repeat look
// or a later wake does not carry it again; a new event glued into it makes it pending again.
import { z } from 'zod'
import type { LimitsState } from '../../../shared/agent/limits'
import { isUrgentStop, OPEN_STATES, type AttentionItem } from '../../../shared/assistant/attention'
import { inWorkHours, machineTimeZone, nextWorkHoursStart, workWindowStartOf, type WorkHours } from '../../../shared/assistant/schedule/work-hours'
import { assistantWakeGate, type WakeVerdict } from '../budget/wake-gate'
import { dayOf } from '../core/attention-core'

/** How long a batch gathers items after the oldest of them came. Decided without the owner (ticket 06, result). */
export const BATCH_GATHER_MS = 15 * 60_000
/** The least time between a batch and the wake before it. Decided without the owner (ticket 06, result). */
export const BATCH_SPACING_MS = 60 * 60_000

export type WakeReason = 'urgent' | 'batch' | 'morning' | 'user'

/** A decision to wake the model: ticket 10 starts a new Session of the Assistant on it. */
export interface AssistantWake {
  type: 'wake'
  /** The id the usage ledger notes the wake by (AssistantUsageLedger.noteWake). */
  id: string
  reason: WakeReason
  at: number
  /** The items handed over with the wake, oldest first. The morning may carry none: it summarises the state. */
  items: AttentionItem[]
}

/** An automatic wake that was due and that the Limits or the daily limit hold. */
export interface WakeHeld {
  type: 'held'
  reason: Exclude<WakeReason, 'user'>
  verdict: Exclude<WakeVerdict, { ok: true }>
}

export type WakeDecision = AssistantWake | WakeHeld

export const wakeStateSchema = z.object({
  /** When the planner first ran: a stop older than that is not urgent, it goes with the morning. */
  since: z.number(),
  /** The id of each item handed over, and how many of its events were. */
  delivered: z.record(z.string(), z.number().int().nonnegative()),
  /** The items the closed list did not help with, waiting for an urgent wake. */
  escalated: z.array(z.string()),
  /** The last wake of any reason, by the planner's clock. */
  lastWakeAt: z.number().nullable(),
  /** The local day (of the work hours' zone) of the last morning summary, `2026-11-25`. */
  morningDay: z.string().nullable(),
  /**
   * When each pending item became pending, by the planner's clock: a batch gathers from that moment, not from the
   * item's latest event, which moves with every event glued into it.
   */
  pendingSince: z.record(z.string(), z.number()),
})
export type WakeState = z.infer<typeof wakeStateSchema>

export interface WakeStore {
  read(): WakeState | undefined
  write(state: WakeState): void
}

export function memoryWakeStore(initial?: WakeState): WakeStore {
  let saved = initial === undefined ? undefined : structuredClone(initial)
  return {
    read: () => (saved === undefined ? undefined : structuredClone(saved)),
    write: (state) => void (saved = structuredClone(state)),
  }
}

export interface WakePlannerOptions {
  now: () => number
  /** Every item of the attention core: the Machine's and each Project's. */
  items: () => readonly AttentionItem[]
  workHours: () => WorkHours
  limits: () => LimitsState
  /** The usage ledger of ticket 05: it counts the automatic wakes of the day. */
  ledger: { automaticWakesToday(): number; noteWake(id: string, urgent: boolean): void }
  store: WakeStore
  /** Where a wake the ledger could not note is told of; console.warn when absent. */
  log?: (message: string, error: unknown) => void
}

const isOpen = (item: AttentionItem): boolean => OPEN_STATES.includes(item.state)

export class WakePlanner {
  private state: WakeState
  /** The verdict of the last held wake: the next look is due when it lets go. */
  private held: WakeHeld | null = null
  /** No file yet: the first look writes one, so `since` outlives a restart before the first wake. */
  private fresh: boolean

  constructor(private readonly options: WakePlannerOptions) {
    const saved = options.store.read()
    this.fresh = saved === undefined
    this.state = saved ?? { since: options.now(), delivered: {}, escalated: [], lastWakeAt: null, morningDay: null, pendingSince: {} }
  }

  /** Whether a wake is due now; if it is and the gate lets it go, it is noted and handed out. */
  evaluate(): WakeDecision | null {
    const now = this.options.now()
    const hours = this.options.workHours()
    const items = this.options.items()
    const pending = this.pending(items)
    this.track(pending, now)
    const escalated = items.filter((item) => isOpen(item) && this.state.escalated.includes(item.id))
    const urgent = escalated.length > 0 || pending.some((item) => isUrgentStop(item) && item.updatedAt >= this.state.since)
    let reason: Exclude<WakeReason, 'user'> | null = null
    if (urgent) reason = 'urgent'
    else if (inWorkHours(now, hours)) {
      if (this.morningDayOf(now, hours) !== this.state.morningDay) reason = 'morning'
      else if (pending.length > 0 && now >= this.batchDueAt(pending, now)) reason = 'batch'
    }
    if (reason === null) {
      this.held = null
      return null
    }
    const verdict = assistantWakeGate({ limits: this.options.limits(), urgent, wakesToday: this.options.ledger.automaticWakesToday(), now })
    if (!verdict.ok) {
      this.held = { type: 'held', reason, verdict }
      return this.held
    }
    this.held = null
    const wake = this.handOver(reason, now, items, [...escalated, ...pending.filter((item) => !escalated.includes(item))])
    // The items are handed over already: a ledger that cannot write loses the count, not the wake.
    try {
      this.options.ledger.noteWake(wake.id, urgent)
    } catch (error) {
      ;(this.options.log ?? ((message, cause) => console.warn(message, cause)))('[assistant] a wake was not noted in the usage ledger', error)
    }
    return wake
  }

  /** The closed list did not help with item `id` (work still stands): it wakes the model at once. */
  escalate(id: string): WakeDecision | null {
    const item = this.options.items().find((each) => each.id === id)
    if (item === undefined || !isOpen(item)) return null
    if (!this.state.escalated.includes(id)) this.save({ ...this.state, escalated: [...this.state.escalated, id] })
    return this.evaluate()
  }

  /** The user wrote to the Assistant: the model wakes now, with what is pending; no gate, not counted. */
  userMessage(): AssistantWake {
    const now = this.options.now()
    const items = this.options.items()
    return this.handOver('user', now, items, this.pending(items))
  }

  /** When the next wake may be due by the clock alone; null when only a new item can make one due. */
  nextCheckAt(): number | null {
    if (this.held !== null) return this.held.verdict.until
    const now = this.options.now()
    const hours = this.options.workHours()
    if (!inWorkHours(now, hours)) return nextWorkHoursStart(now, hours)
    if (this.morningDayOf(now, hours) !== this.state.morningDay) return now
    const pending = this.pending(this.options.items())
    return pending.length > 0 ? this.batchDueAt(pending, now) : null
  }

  /** The open items with events not yet handed over, oldest first; seen, snoozed and dismissed ones wait for the user. */
  private pending(items: readonly AttentionItem[]): AttentionItem[] {
    return items.filter((item) => item.state === 'new' && (this.state.delivered[item.id] ?? 0) < item.events).sort((a, b) => a.updatedAt - b.updatedAt)
  }

  /** Notes when each pending item became pending and forgets the ones that no longer are; the first look writes the file. */
  private track(pending: readonly AttentionItem[], now: number): void {
    const since = Object.fromEntries(pending.map((item) => [item.id, this.state.pendingSince[item.id] ?? Math.min(now, item.updatedAt)]))
    const known = Object.keys(this.state.pendingSince)
    const changed = known.length !== pending.length || pending.some((item) => this.state.pendingSince[item.id] === undefined)
    if (changed || this.fresh) this.save({ ...this.state, pendingSince: since })
    this.fresh = false
  }

  private batchDueAt(pending: readonly AttentionItem[], now: number): number {
    // A time past `now` (the clock went back) counts as `now`.
    const oldest = Math.min(now, ...pending.map((item) => this.state.pendingSince[item.id] ?? item.updatedAt))
    const last = this.state.lastWakeAt === null ? Number.NEGATIVE_INFINITY : Math.min(now, this.state.lastWakeAt)
    return Math.max(oldest + BATCH_GATHER_MS, last + BATCH_SPACING_MS)
  }

  /** The day of the work hours `now` is in: a window across midnight belongs to the day it starts on. */
  private morningDayOf(now: number, hours: WorkHours): string {
    return dayOf(workWindowStartOf(now, hours) ?? now, hours.timeZone ?? machineTimeZone())
  }

  /**
   * The file first, then memory: a write that throws leaves the wake due, so it is tried again. The usage ledger is
   * written after it (evaluate), and its failure does not undo the wake.
   */
  private save(next: WakeState): void {
    this.options.store.write(next)
    this.state = next
  }

  private handOver(reason: WakeReason, now: number, items: readonly AttentionItem[], carried: AttentionItem[]): AssistantWake {
    const present = new Set(items.map((item) => item.id))
    // Items the core dropped (ATTENTION_KEEP_DAYS) leave the file too.
    const delivered = Object.fromEntries(Object.entries(this.state.delivered).filter(([id]) => present.has(id)))
    for (const item of carried) delivered[item.id] = item.events
    const handed = new Set(carried.map((item) => item.id))
    const hours = this.options.workHours()
    this.save({
      ...this.state,
      delivered,
      pendingSince: Object.fromEntries(Object.entries(this.state.pendingSince).filter(([id]) => !handed.has(id))),
      escalated: reason === 'urgent' ? [] : this.state.escalated.filter((id) => present.has(id)),
      lastWakeAt: now,
      morningDay: reason === 'morning' ? this.morningDayOf(now, hours) : this.state.morningDay,
    })
    return { type: 'wake', id: `${reason}-${now}`, reason, at: now, items: carried.map((item) => structuredClone(item)) }
  }
}
