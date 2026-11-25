// The attention core (worfy-assistant ticket 03; spec, the solution, layer 1, and implementation decisions, the attention core): events of every
// Project of this Machine become items, without a model. It is the bus of events main did not have: the sources
// (sources.ts) hand it their events, and it keeps
//
// - one item per event: a repeat — the same source, id and revision — gives nothing, after a restart too;
// - one item per subject per day: the events of one PR, Ticket, Session or Run in one local day are glued into it;
// - «nothing happened»: a source names a condition («this Session ended its turn; nothing since») and when it is due;
//   when nothing came on the subject by then, the condition gives one item. The same condition never gives a second;
//   a changed one (a new revision) gives a new item and makes the open one of the old revision stale;
// - the items in the Project's data folder (store.ts), so they live through a restart; a source that reads its state
//   again at the start (the Tickets that wait, the PR inbox, the Autopilot journal) catches up on what came while worfy
//   was closed, and the keys taken drop what was there before. An item that takes no event for ATTENTION_KEEP_DAYS is
//   dropped with the keys of that time, so the file stays bounded; a state still true then (a Ticket that still waits)
//   comes back as a new item at the next read of its source.
//
// Input: events, the clock, the settings (the time zone of the day) and the Limits (as events of their source).
// Output: items. Waking the model is ticket 06; the duty of an item is ticket 07.
import { OPEN_STATES, type AttentionEvent, type AttentionItem, type AttentionSource, type AttentionState, type AttentionSubject } from '../../../shared/assistant/attention'
import type { AttentionCondition, AttentionFile, AttentionStore } from './store'

/**
 * How long an item that takes no event is kept, open or not, and the key of an event taken: 14 days, the period of the
 * events measurement of the proactive-runtime map (docs/product/proactive-runtime/). It bounds the file, and how far back
 * a source reads past events at the start (catchUpFrom). Decided without the owner (ticket 03, result section).
 */
export const ATTENTION_KEEP_DAYS = 14

const DAY_MS = 24 * 60 * 60_000

export interface AttentionSettings {
  /** The time zone the day of the gluing is counted in (an IANA name). */
  timeZone: string
}

/** A «nothing happened» condition as a source names it. */
export interface AttentionExpectation extends Omit<AttentionEvent, 'at'> {
  /** How long nothing may happen on the subject, from `from` (the clock's now when absent). */
  quietMs: number
  from?: number
}

export interface AttentionCoreOptions {
  now: () => number
  store: AttentionStore
  /** Read at each event; the machine's time zone when absent. */
  settings?: () => AttentionSettings
  /** The Projects whose conditions tick() looks at, besides the Machine's own. */
  projects: () => readonly string[]
  /** Where a Project whose file failed in tick() is told of; console.warn when absent. */
  log?: (message: string, error: unknown) => void
}

export type AttentionListener = (scope: string | null, items: readonly AttentionItem[]) => void

const sameSubject = (a: AttentionSubject, b: AttentionSubject): boolean => a.kind === b.kind && a.id === b.id
const keyOf = (source: AttentionSource | 'condition', id: string, revision: string): string => `${source}\0${id}\0${revision}`
const isOpen = (item: AttentionItem): boolean => OPEN_STATES.includes(item.state)

const formats = new Map<string, Intl.DateTimeFormat>()
/** The local day of `at` in `timeZone`, `2026-10-25`: a day of 23 or 25 hours is one day too. */
export function dayOf(at: number, timeZone: string): string {
  let format = formats.get(timeZone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    formats.set(timeZone, format)
  }
  return format.format(at)
}

export class AttentionCore {
  private readonly scopes = new Map<string | null, AttentionFile>()
  private readonly listeners = new Set<AttentionListener>()

  constructor(private readonly options: AttentionCoreOptions) {}

  private timeZone(): string {
    return this.options.settings?.().timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  private load(scope: string | null): AttentionFile {
    let file = this.scopes.get(scope)
    if (file === undefined) {
      const saved = this.options.store.read(scope)
      file = saved ?? { since: this.options.now(), items: [], seen: {}, conditions: [] }
      this.scopes.set(scope, file)
      // Written at once: `since` has to outlive a run that gave the scope no item.
      if (saved === undefined) this.options.store.write(scope, file)
    }
    return file
  }

  private save(scope: string | null, file: AttentionFile): void {
    const oldest = this.options.now() - ATTENTION_KEEP_DAYS * DAY_MS
    file.items = file.items.filter((item) => item.updatedAt >= oldest)
    file.seen = Object.fromEntries(Object.entries(file.seen).filter(([, at]) => at >= oldest))
    this.options.store.write(scope, file)
    for (const listener of this.listeners) listener(scope, file.items)
  }

  /** The items of a Project (null: of the Machine), oldest first. */
  items(scope: string | null): readonly AttentionItem[] {
    return [...this.load(scope).items]
  }

  /**
   * From when a source that reads past events back (the Autopilot journal) takes them: since the core first kept the
   * scope, and no further back than ATTENTION_KEEP_DAYS, whose keys are gone.
   */
  catchUpFrom(scope: string | null): number {
    return Math.max(this.load(scope).since, this.options.now() - ATTENTION_KEEP_DAYS * DAY_MS)
  }

  subscribe(listener: AttentionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Takes one event: a new item, the item it was glued into, or null for a repeat. */
  ingest(event: AttentionEvent): AttentionItem | null {
    const file = this.load(event.projectId)
    const key = keyOf(event.source, event.id, event.revision)
    if (file.seen[key] !== undefined) return null
    const now = this.options.now()
    const at = event.at ?? now
    file.seen[key] = now
    // An item already holds this revision (its key is gone, a source read its state again): it stays as it is.
    if (file.items.some((item) => item.condition === undefined && item.source === event.source && sameSubject(item.subject, event.subject) && item.revision === event.revision)) {
      this.save(event.projectId, file)
      return null
    }
    // Something happened on the subject: its pending condition ends, and an open «nothing happened» item is stale.
    this.settle(file, event.subject, 'stale')
    const day = dayOf(at, this.timeZone())
    const glued = file.items.find((item) => item.condition === undefined && sameSubject(item.subject, event.subject) && dayOf(item.startedAt, this.timeZone()) === day)
    let item: AttentionItem
    if (glued !== undefined) {
      Object.assign(glued, { source: event.source, kind: event.kind, text: event.text, revision: event.revision, updatedAt: now, events: glued.events + 1 })
      // A dismissed or snoozed item stays so; a seen, closed or stale one asks again.
      if (glued.state === 'seen' || glued.state === 'closed' || glued.state === 'stale') glued.state = 'new'
      item = glued
    } else {
      item = { ...this.fresh(event, at, now), events: 1 }
      file.items.push(item)
    }
    this.save(event.projectId, file)
    return item
  }

  /** The cause of the subject's open items went away (a person answered, the Ticket no longer waits): they close. */
  resolve(scope: string | null, subject: AttentionSubject): void {
    const file = this.load(scope)
    if (this.settle(file, subject, 'closed')) this.save(scope, file)
  }

  /** Names a «nothing happened» condition; one already raised with this revision is not armed again. */
  expect(expectation: AttentionExpectation): void {
    const { quietMs, from, ...condition } = expectation
    const file = this.load(condition.projectId)
    if (file.seen[keyOf('condition', condition.id, condition.revision)] !== undefined) return
    const next: AttentionCondition = { ...condition, dueAt: (from ?? this.options.now()) + quietMs }
    file.conditions = [...file.conditions.filter((each) => each.id !== condition.id), next]
    this.save(condition.projectId, file)
  }

  /** Raises the conditions that are due: after a sleep of the Mac or a restart, each gives its one item. */
  tick(): void {
    const now = this.options.now()
    for (const scope of [null, ...this.options.projects()]) {
      // One scope whose file fails (no permission, a full disk) costs only its own conditions.
      try {
        this.raise(scope, now)
      } catch (error) {
        ;(this.options.log ?? ((message, cause) => console.warn(message, cause)))(`[assistant] the attention core could not look at the conditions of ${scope ?? 'the Machine'}`, error)
      }
    }
  }

  private raise(scope: string | null, now: number): void {
    const file = this.load(scope)
    const due = file.conditions.filter((condition) => condition.dueAt <= now)
    if (due.length === 0) return
    file.conditions = file.conditions.filter((condition) => condition.dueAt > now)
    for (const condition of due) {
      file.seen[keyOf('condition', condition.id, condition.revision)] = now
      for (const item of file.items) if (item.condition === condition.id && isOpen(item)) item.state = 'stale'
      file.items.push({ ...this.fresh(condition, condition.dueAt, now), events: 1, condition: condition.id })
    }
    this.save(scope, file)
  }

  /** Changes the state of an item (the user saw, snoozed or dismissed it). */
  mark(scope: string | null, id: string, state: AttentionState): void {
    const file = this.load(scope)
    const item = file.items.find((each) => each.id === id)
    if (item === undefined || item.state === state) return
    item.state = state
    this.save(scope, file)
  }

  private fresh(event: Omit<AttentionEvent, 'at'>, at: number, now: number): Omit<AttentionItem, 'events'> {
    const id = [event.projectId ?? 'machine', event.subject.kind, event.subject.id, event.kind, at].join('|')
    return { id, source: event.source, projectId: event.projectId, subject: event.subject, kind: event.kind, text: event.text, startedAt: at, updatedAt: now, revision: event.revision, state: 'new', duty: null }
  }

  /** Ends the subject's pending conditions and puts its open items (only «nothing happened» ones for `stale`) in `state`. */
  private settle(file: AttentionFile, subject: AttentionSubject, state: 'stale' | 'closed'): boolean {
    let changed = false
    const pending = file.conditions.filter((condition) => !sameSubject(condition.subject, subject))
    if (pending.length !== file.conditions.length) {
      file.conditions = pending
      changed = true
    }
    for (const item of file.items) {
      if (!isOpen(item) || !sameSubject(item.subject, subject) || (state === 'stale' && item.condition === undefined)) continue
      item.state = state
      changed = true
    }
    return changed
  }
}
