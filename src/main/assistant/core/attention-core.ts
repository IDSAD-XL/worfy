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
// Output: items. Waking the model is ticket 06. The duty of an item (ticket 07) is the one its event names, else
// the one `dutyOf` answers (src/main/assistant/duties/); the duties listen to the items taken (onItem).
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
  /** The duty of an event that names none; every item's duty is null when absent. */
  dutyOf?: (event: Omit<AttentionEvent, 'at'>) => string | null
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
  private readonly takers = new Set<(item: AttentionItem) => void>()
  /** How many batch() calls are running; while above 0, a changed scope is only marked in `dirty`. */
  private batching = 0
  private readonly dirty = new Set<string | null>()

  constructor(private readonly options: AttentionCoreOptions) {}

  /**
   * Runs `take` and writes each scope it changed once, at its end (a batch inside a batch: at the end of the outer
   * one); the listeners are told once per scope then. A source that hands over many events at once (the first read of
   * a Project's workflow) runs in a batch: the file is written once, not once per item (worfy-polish 151). Inside the
   * batch the core answers at once from memory, and each item still goes to the takers (onItem) as it is taken.
   * What `take` changed before it threw is written too; the throw goes on to the caller.
   */
  batch<T>(take: () => T): T {
    this.batching += 1
    try {
      return take()
    } finally {
      this.batching -= 1
      if (this.batching === 0) this.flush()
    }
  }

  /** Writes every scope a batch changed; a scope whose write fails costs only itself, and the first failure is thrown after the rest. */
  private flush(): void {
    let failure: { error: unknown } | undefined
    for (const scope of [...this.dirty]) {
      this.dirty.delete(scope)
      const file = this.scopes.get(scope)
      if (file === undefined) continue
      try {
        this.write(scope, file)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure !== undefined) throw failure.error
  }

  private timeZone(): string {
    return this.options.settings?.().timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  private load(scope: string | null): AttentionFile {
    let file = this.scopes.get(scope)
    if (file === undefined) {
      const saved = this.options.store.read(scope)
      file = saved ?? { since: this.options.now(), items: [], seen: {}, conditions: [] }
      this.scopes.set(scope, file)
      // Written at once (in a batch: at its end): `since` has to outlive a run that gave the scope no item.
      if (saved === undefined) {
        if (this.batching > 0) this.dirty.add(scope)
        else this.options.store.write(scope, file)
      }
    }
    return file
  }

  private save(scope: string | null, file: AttentionFile): void {
    if (this.batching > 0) this.dirty.add(scope)
    else this.write(scope, file)
  }

  private write(scope: string | null, file: AttentionFile): void {
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

  /** Called with the item each event taken made or was glued into, and with each item a «nothing happened» condition raised; not with a repeat. */
  onItem(listener: (item: AttentionItem) => void): () => void {
    this.takers.add(listener)
    return () => this.takers.delete(listener)
  }

  /** Takes one event: a new item, the item it was glued into, or null for a repeat. */
  ingest(event: AttentionEvent): AttentionItem | null {
    const file = this.load(event.projectId)
    const key = keyOf(event.source, event.id, event.revision)
    if (file.seen[key] !== undefined) return null
    const now = this.options.now()
    const at = event.at ?? now
    file.seen[key] = now
    // Something happened on the subject: its pending condition ends, and an open «nothing happened» item is stale.
    this.settle(file, event.subject, 'stale')
    const day = dayOf(at, this.timeZone())
    const glued = file.items.find((item) => item.condition === undefined && sameSubject(item.subject, event.subject) && dayOf(item.startedAt, this.timeZone()) === day)
    let item: AttentionItem
    if (glued !== undefined) {
      Object.assign(glued, {
        source: event.source,
        kind: event.kind,
        text: event.text,
        revision: event.revision,
        updatedAt: now,
        lastAt: Math.max(glued.lastAt ?? glued.startedAt, at),
        events: glued.events + 1,
        duty: this.dutyOf(event),
      })
      if (event.pr !== undefined) glued.pr = event.pr
      if (event.message !== undefined) glued.message = event.message
      // A dismissed or snoozed item stays so; a seen, closed or stale one asks again.
      if (glued.state === 'seen' || glued.state === 'closed' || glued.state === 'stale') glued.state = 'new'
      item = glued
    } else {
      item = { ...this.fresh(event, at, now), events: 1, ...(event.message === undefined ? {} : { message: event.message }) }
      file.items.push(item)
    }
    this.save(event.projectId, file)
    for (const taker of this.takers) taker(item)
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

  /** Drops the pending «nothing happened» condition `id` of `scope`; the items it already raised stay as they are. */
  disarm(scope: string | null, id: string): void {
    const file = this.load(scope)
    const pending = file.conditions.filter((each) => each.id !== id)
    if (pending.length === file.conditions.length) return
    file.conditions = pending
    this.save(scope, file)
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
    const raised: AttentionItem[] = []
    for (const condition of due) {
      file.seen[keyOf('condition', condition.id, condition.revision)] = now
      for (const item of file.items) if (item.condition === condition.id && isOpen(item)) item.state = 'stale'
      const item: AttentionItem = { ...this.fresh(condition, condition.dueAt, now), events: 1, condition: condition.id }
      file.items.push(item)
      raised.push(item)
    }
    this.save(scope, file)
    // After the save: a listener may name a condition of its own (a rule of a Project), which writes the file again.
    for (const item of raised) for (const taker of this.takers) taker(item)
  }

  /** Changes the state of an item (the user saw, snoozed or dismissed it). */
  mark(scope: string | null, id: string, state: AttentionState): void {
    const file = this.load(scope)
    const item = file.items.find((each) => each.id === id)
    if (item === undefined || item.state === state) return
    item.state = state
    this.save(scope, file)
  }

  private dutyOf(event: Omit<AttentionEvent, 'at'>): string | null {
    return event.duty ?? this.options.dutyOf?.(event) ?? null
  }

  private fresh(event: Omit<AttentionEvent, 'at'>, at: number, now: number): Omit<AttentionItem, 'events'> {
    const id = [event.projectId ?? 'machine', event.subject.kind, event.subject.id, event.kind, at].join('|')
    return {
      id,
      source: event.source,
      projectId: event.projectId,
      subject: event.subject,
      kind: event.kind,
      text: event.text,
      startedAt: at,
      lastAt: at,
      updatedAt: now,
      revision: event.revision,
      state: 'new',
      duty: this.dutyOf(event),
      ...(event.pr === undefined ? {} : { pr: event.pr }),
    }
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
