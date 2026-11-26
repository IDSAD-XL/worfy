// The decision to wake the Assistant (src/main/assistant/wake/planner.ts, worfy-assistant ticket 06; seam A of the
// spec's test decisions). On the way in: the items of the attention core, a clock, the work hours and the Limits; on
// the way out: the decisions to wake. The clock is a fake one moved by hand: midnight, the change of summer time, the
// Mac's sleep (a jump of the clock) and a restart (a second planner over the same files). The daily limit is counted
// by the real usage ledger of ticket 05 in a temporary folder. Moments are UTC with Kyiv's offset written out (UTC+2
// in winter, UTC+3 in summer).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LimitWindowState, LimitsState } from '../../src/shared/agent/limits'
import type { AttentionItem } from '../../src/shared/assistant/attention'
import { ASSISTANT_DAILY_WAKE_LIMIT } from '../../src/shared/assistant/budget'
import type { WorkHours } from '../../src/shared/assistant/schedule/work-hours'
import { AssistantUsageLedger } from '../../src/main/assistant/budget/ledger'
import { BATCH_GATHER_MS, BATCH_SPACING_MS, memoryWakeStore, WakePlanner, type WakeStore } from '../../src/main/assistant/wake/planner'
import { removeTestTree } from '../remove'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const KYIV = 'Europe/Kyiv'

const utc = (year: number, month: number, day: number, hour: number, minute = 0): number => Date.UTC(year, month - 1, day, hour, minute)

/** Wednesday 25 November 2026 in Kyiv (UTC+2): `hour` local. */
const wed = (hour: number, minute = 0): number => utc(2026, 11, 25, hour - 2, minute)
/** Thursday 26 November 2026 in Kyiv. */
const thu = (hour: number, minute = 0): number => utc(2026, 11, 26, hour - 2, minute)

const OFFICE: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 9 * 60, to: 18 * 60 }], timeZone: KYIV }

let clock: number
let items: AttentionItem[]
let hours: WorkHours
let limits: LimitsState
let store: WakeStore
let dir: string
let ledger: AssistantUsageLedger
let zone: string | undefined

beforeAll(() => {
  // The ledger counts the day by the machine's zone, as the budget of Autopilot does.
  zone = process.env.TZ
  process.env.TZ = KYIV
})
afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

beforeEach(() => {
  clock = wed(3)
  items = []
  hours = OFFICE
  limits = { windows: {} }
  store = memoryWakeStore()
  dir = mkdtempSync(join(tmpdir(), 'worfy-wake-'))
  ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
})
afterEach(() => removeTestTree(dir))

function planner(): WakePlanner {
  return new WakePlanner({ now: () => clock, items: () => items, workHours: () => hours, limits: () => limits, ledger, store })
}

let serial = 0
/** An item of the attention core that arrived at the clock's now. */
function arrive(over: Partial<AttentionItem> = {}): AttentionItem {
  serial += 1
  const at = clock
  const made: AttentionItem = {
    id: `p1|pr|o/r#${serial}|needs-review|${at}`,
    source: 'pr-inbox',
    projectId: 'p1',
    subject: { kind: 'pr', id: `o/r#${serial}`, label: `o/r#${serial}` },
    kind: 'needs-review',
    text: 'Needs your review',
    startedAt: at,
    updatedAt: at,
    revision: 'r1',
    state: 'new',
    duty: null,
    events: 1,
    ...over,
  }
  items.push(made)
  return made
}

const runStopped = (): AttentionItem => arrive({ id: `p1|run|r-${serial + 1}|run-stopped|${clock}`, source: 'autopilot', subject: { kind: 'run', id: `r-${serial + 1}`, label: 'Autopilot · e' }, kind: 'run-stopped', text: 'e: no-progress' })

/** A window that resets two hours after the clock's now: set the clock first. */
function window(over: Partial<LimitWindowState> = {}): LimitWindowState {
  return { utilization: 0.1, resetsAt: Math.floor((clock + 2 * HOUR) / 1000), status: 'allowed', receivedAt: clock - MINUTE, source: 'sdk', ...over }
}

const wakesNoted = (): { id: string; urgent: boolean }[] => ledger.snapshot().wakes.map(({ id, urgent }) => ({ id, urgent }))

describe('an urgent item wakes at once', () => {
  it('a stopped Autopilot Run wakes the model at once, outside work hours too, and once', () => {
    const wake = planner()
    expect(wake.evaluate()).toBeNull()
    clock = wed(3, 10)
    const stop = runStopped()
    const decision = wake.evaluate()
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent', at: clock })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([stop.id])
    expect(wakesNoted()).toEqual([{ id: decision?.type === 'wake' ? decision.id : '', urgent: true }])
    // The same stop does not wake again.
    clock = wed(3, 11)
    expect(wake.evaluate()).toBeNull()
  })

  it('a Run that finished its Tickets is not urgent: it waits for work hours', () => {
    const wake = planner()
    clock = wed(3, 10)
    arrive({ source: 'autopilot', subject: { kind: 'run', id: 'r-done', label: 'Autopilot · e' }, kind: 'run-finished' })
    expect(wake.evaluate()).toBeNull()
    expect(wakesNoted()).toEqual([])
  })

  it('a Run the user stopped is not urgent: it waits for the morning; another stop at night wakes at once (ticket 23)', () => {
    const wake = planner()
    expect(wake.evaluate()).toBeNull()
    clock = wed(3, 10)
    const mine = (['user-stop', 'user-force-stop', 'start-cancelled', 'discarded'] as const).map((stopReason) => {
      const item = runStopped()
      item.stopReason = stopReason
      return item
    })
    expect(wake.evaluate()).toBeNull()
    expect(wakesNoted()).toEqual([])
    for (const stopReason of ['main-red', 'turn-hung'] as const) {
      clock += MINUTE
      const other = runStopped()
      other.stopReason = stopReason
      const decision = wake.evaluate()
      expect(decision).toMatchObject({ type: 'wake', reason: 'urgent', at: clock })
      // The urgent wake carries what is pending, the user's stops too: they wait for no later wake.
      expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual(stopReason === 'main-red' ? [...mine, other].map((item) => item.id) : [other.id])
    }
  })

  it('a Run the user stopped goes with the morning summary', () => {
    const wake = planner()
    expect(wake.evaluate()).toBeNull()
    clock = wed(3, 10)
    const mine = runStopped()
    mine.stopReason = 'user-stop'
    expect(wake.evaluate()).toBeNull()
    clock = wed(9)
    const morning = wake.evaluate()
    expect(morning).toMatchObject({ type: 'wake', reason: 'morning' })
    expect(morning?.type === 'wake' && morning.items.map((item) => item.id)).toEqual([mine.id])
  })

  it('a Run that stopped before the Assistant first ran is not urgent: it goes with the morning', () => {
    clock = wed(2)
    const old = runStopped()
    clock = wed(3)
    const wake = planner()
    expect(wake.evaluate()).toBeNull()
    clock = wed(9)
    const morning = wake.evaluate()
    expect(morning).toMatchObject({ type: 'wake', reason: 'morning' })
    expect(morning?.type === 'wake' && morning.items.map((item) => item.id)).toEqual([old.id])
  })

  it('work that stands and that the closed list did not help wakes at once, even when the item was handed over already', () => {
    const wake = planner()
    clock = wed(10)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    const quiet = arrive({ source: 'session', subject: { kind: 'session', id: 's1', label: 's1' }, kind: 'waiting', condition: 's1:waiting' })
    clock = wed(11, 30)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'batch' })
    // Late in the evening the closed list tried to wake the Orchestrator, and the work still stands.
    clock = wed(23)
    expect(wake.evaluate()).toBeNull()
    const decision = wake.escalate(quiet.id)
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent', at: clock })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([quiet.id])
    expect(wakesNoted().map((noted) => noted.urgent)).toEqual([false, false, true])
    clock = wed(23, 5)
    expect(wake.evaluate()).toBeNull()
  })

  it('an item that is no longer open is not escalated', () => {
    const wake = planner()
    clock = wed(23)
    const gone = arrive({ state: 'closed' })
    expect(wake.escalate(gone.id)).toBeNull()
    expect(wake.escalate('no such item')).toBeNull()
    // The closed item comes back with a new event: it is pending, not escalated.
    clock = wed(23, 5)
    Object.assign(gone, { state: 'new', events: 2, updatedAt: clock })
    expect(wake.evaluate()).toBeNull()
  })

  it('a stop that comes while worfy restarts stays urgent: the first look writes when the planner started', () => {
    planner().evaluate()
    // worfy is closed at 03:00; a Run of the Orchestrator stops at 03:01; worfy opens at 03:02.
    clock = wed(3, 1)
    const late = runStopped()
    clock = wed(3, 2)
    const decision = planner().evaluate()
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent' })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([late.id])
  })

  it('a held urgent stop stays urgent across a restart', () => {
    planner().evaluate()
    clock = wed(3, 10)
    limits = { windows: { five_hour: window({ utilization: 1, status: 'rejected' }) } }
    const stop = runStopped()
    expect(planner().evaluate()).toMatchObject({ type: 'held', reason: 'urgent' })
    // worfy restarts before the window resets.
    clock = wed(3, 20)
    const restarted = planner()
    expect(restarted.evaluate()).toMatchObject({ type: 'held', reason: 'urgent' })
    clock = wed(4)
    limits = { windows: {} }
    const decision = restarted.evaluate()
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent' })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([stop.id])
  })

  it('a usage ledger that cannot write loses the count, not the wake', () => {
    const logged: string[] = []
    const failing = { automaticWakesToday: () => 0, noteWake: () => { throw new Error('disk full') } }
    const wake = new WakePlanner({ now: () => clock, items: () => items, workHours: () => hours, limits: () => limits, ledger: failing, store, log: (message) => logged.push(message) })
    clock = wed(3, 10)
    const stop = runStopped()
    const decision = wake.evaluate()
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent' })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([stop.id])
    expect(logged).toEqual(['[assistant] a wake was not noted in the usage ledger'])
  })
})

describe('non-urgent items go in one batch in work hours', () => {
  it('counts the gathering from when an item became pending, not from its latest event', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    clock = wed(10)
    const busy = arrive()
    expect(wake.evaluate()).toBeNull()
    // A new event is glued into the item every 5 minutes.
    for (const minute of [5, 10]) {
      clock = wed(10, minute)
      Object.assign(busy, { events: busy.events + 1, updatedAt: clock })
      expect(wake.evaluate()).toBeNull()
    }
    clock = wed(10) + BATCH_GATHER_MS
    Object.assign(busy, { events: busy.events + 1, updatedAt: clock })
    const batch = wake.evaluate()
    expect(batch).toMatchObject({ type: 'wake', reason: 'batch' })
    expect(batch?.type === 'wake' && batch.items.map((item) => item.id)).toEqual([busy.id])
  })

  it('keeps when an item became pending across a restart', () => {
    clock = wed(9)
    planner().evaluate()
    clock = wed(10)
    const busy = arrive()
    expect(planner().evaluate()).toBeNull()
    clock = wed(10, 10)
    Object.assign(busy, { events: 2, updatedAt: clock })
    expect(planner().evaluate()).toBeNull()
    clock = wed(10) + BATCH_GATHER_MS
    Object.assign(busy, { events: 3, updatedAt: clock })
    expect(planner().evaluate()).toMatchObject({ type: 'wake', reason: 'batch' })
  })

  it('gathers the items that come close together into one wake, and not before the gathering time', () => {
    const wake = planner()
    clock = wed(9)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    clock = wed(10, 5)
    const first = arrive()
    expect(wake.evaluate()).toBeNull()
    clock = wed(10, 12)
    const second = arrive({ source: 'ticket-waits', kind: 'waits' })
    expect(wake.evaluate()).toBeNull()
    clock = wed(10, 5) + BATCH_GATHER_MS
    const batch = wake.evaluate()
    expect(batch).toMatchObject({ type: 'wake', reason: 'batch' })
    expect(batch?.type === 'wake' && batch.items.map((item) => item.id)).toEqual([first.id, second.id])
    expect(wakesNoted().map((noted) => noted.urgent)).toEqual([false, false])
  })

  it('keeps at least the spacing between two batches', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    clock = wed(9, 1)
    arrive()
    clock = wed(9) + BATCH_SPACING_MS - MINUTE
    expect(wake.evaluate()).toBeNull()
    clock = wed(9) + BATCH_SPACING_MS
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'batch' })
  })

  it('a new event glued into an item handed over already makes it pending again', () => {
    const wake = planner()
    clock = wed(9)
    const pr = arrive()
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    clock = wed(10, 30)
    Object.assign(pr, { events: 2, updatedAt: clock, state: 'new' })
    expect(wake.evaluate()).toBeNull()
    clock = wed(10, 30) + BATCH_GATHER_MS
    const batch = wake.evaluate()
    expect(batch?.type === 'wake' && batch.items.map((item) => item.id)).toEqual([pr.id])
  })

  it('an item the user saw or dismissed is not pending', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    clock = wed(10)
    arrive({ state: 'seen' })
    arrive({ state: 'dismissed' })
    clock = wed(12)
    expect(wake.evaluate()).toBeNull()
  })

  it('does not wake outside work hours: the evening items wait for the morning summary, one wake for all', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    clock = wed(18, 30)
    const evening = arrive()
    expect(wake.evaluate()).toBeNull()
    expect(wake.nextCheckAt()).toBe(thu(9))
    clock = wed(23, 59)
    expect(wake.evaluate()).toBeNull()
    // Midnight passes; the night is still outside work hours.
    clock = thu(0, 30)
    const night = arrive()
    clock = thu(8, 59)
    expect(wake.evaluate()).toBeNull()
    clock = thu(9)
    const morning = wake.evaluate()
    expect(morning).toMatchObject({ type: 'wake', reason: 'morning' })
    expect(morning?.type === 'wake' && morning.items.map((item) => item.id)).toEqual([evening.id, night.id])
    clock = thu(9) + BATCH_SPACING_MS
    expect(wake.evaluate()).toBeNull()
    expect(wakesNoted()).toHaveLength(2)
  })

  it('says when to look next: the batch, else the start of work hours', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    clock = wed(10)
    arrive()
    expect(wake.nextCheckAt()).toBe(wed(10) + BATCH_GATHER_MS)
  })
})

describe('the morning summary', () => {
  it('goes once a working day, at the start of work hours, with nothing pending too', () => {
    const wake = planner()
    clock = wed(8, 59)
    expect(wake.evaluate()).toBeNull()
    clock = wed(9)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning', items: [] })
    for (const later of [wed(9, 30), wed(12), wed(17, 59)]) {
      clock = later
      expect(wake.evaluate()).toBeNull()
    }
    clock = thu(9)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    expect(wakesNoted()).toHaveLength(2)
  })

  it('is not repeated after a restart the same day', () => {
    clock = wed(9)
    expect(planner().evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    const pr = arrive()
    clock = wed(9) + BATCH_SPACING_MS
    const restarted = planner()
    const batch = restarted.evaluate()
    expect(batch).toMatchObject({ type: 'wake', reason: 'batch' })
    expect(batch?.type === 'wake' && batch.items.map((item) => item.id)).toEqual([pr.id])
    clock = wed(12)
    expect(planner().evaluate()).toBeNull()
  })

  it('goes when the Mac wakes late in work hours, and not on a day off', () => {
    const wake = planner()
    // Asleep from Wednesday evening; opened at 11:20 on Thursday.
    clock = thu(11, 20)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning', at: thu(11, 20) })
    // Saturday 28 November.
    clock = utc(2026, 11, 28, 8)
    expect(wake.evaluate()).toBeNull()
  })

  it('belongs to the day the window starts on, for a window across midnight', () => {
    hours = { days: ['fri'], windows: [{ from: 22 * 60, to: 2 * 60 }], timeZone: KYIV }
    const wake = planner()
    // Friday 27 November, 22:00 in Kyiv.
    clock = utc(2026, 11, 27, 20)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    // Saturday 01:00 is still Friday's window.
    clock = utc(2026, 11, 27, 23)
    expect(wake.evaluate()).toBeNull()
  })

  it('goes once at 09:00 on the day summer time ends', () => {
    // Sunday 25 October 2026: Kyiv goes from UTC+3 to UTC+2 at 04:00.
    hours = { ...OFFICE, days: ['sun'] }
    const wake = planner()
    clock = utc(2026, 10, 25, 6)
    expect(wake.evaluate()).toBeNull()
    clock = utc(2026, 10, 25, 7)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    clock = utc(2026, 10, 25, 8)
    expect(wake.evaluate()).toBeNull()
  })
})

describe('a message of the user', () => {
  it('wakes the model at any hour, past the Limits and the daily limit, and is not counted as a wake', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    for (let n = 0; n < ASSISTANT_DAILY_WAKE_LIMIT; n++) ledger.noteWake(`filler-${n}`, false)
    limits = { windows: { five_hour: window({ status: 'rejected', utilization: 1 }) } }
    clock = wed(23)
    const pr = arrive()
    const before = wakesNoted().length
    const decision = wake.userMessage()
    expect(decision).toMatchObject({ type: 'wake', reason: 'user', at: clock })
    expect(decision.items.map((item) => item.id)).toEqual([pr.id])
    expect(wakesNoted()).toHaveLength(before)
    // The items it carried are handed over: the morning does not carry them again.
    clock = thu(9)
    limits = { windows: {} }
    ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    const morning = planner().evaluate()
    expect(morning).toMatchObject({ type: 'wake', reason: 'morning', items: [] })
  })
})

describe('the Limits and the daily limit before an automatic wake', () => {
  it('holds the morning and a batch while the 5-hour window is above 80 %, and lets them go after', () => {
    const wake = planner()
    clock = wed(9)
    limits = { windows: { five_hour: window({ utilization: 0.85 }) } }
    const held = wake.evaluate()
    expect(held).toMatchObject({ type: 'held', reason: 'morning', verdict: { reason: 'limits', window: 'five_hour' } })
    expect(wakesNoted()).toEqual([])
    expect(wake.nextCheckAt()).toBe(held?.type === 'held' ? held.verdict.until : 0)
    clock = wed(10)
    limits = { windows: { five_hour: window({ utilization: 0.2 }) } }
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'morning' })
    clock = wed(10, 1)
    arrive()
    limits = { windows: { five_hour: window({ utilization: 0.81 }) } }
    clock = wed(12)
    expect(wake.evaluate()).toMatchObject({ type: 'held', reason: 'batch', verdict: { reason: 'limits' } })
    expect(wakesNoted()).toHaveLength(1)
  })

  it('lets an urgent wake through above 80 % but holds it while a window is rejected', () => {
    const wake = planner()
    clock = wed(3, 5)
    limits = { windows: { five_hour: window({ utilization: 0.95, status: 'allowed_warning' }) } }
    runStopped()
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'urgent' })
    clock = wed(3, 10)
    limits = { windows: { five_hour: window({ utilization: 1, status: 'rejected' }) } }
    runStopped()
    expect(wake.evaluate()).toMatchObject({ type: 'held', reason: 'urgent', verdict: { reason: 'limits' } })
    expect(wakesNoted()).toHaveLength(1)
  })

  it('holds every automatic wake, urgent ones too, once the daily limit is used, until the local midnight', () => {
    const wake = planner()
    for (let n = 0; n < ASSISTANT_DAILY_WAKE_LIMIT; n++) ledger.noteWake(`filler-${n}`, false)
    clock = wed(23)
    const stop = runStopped()
    expect(wake.evaluate()).toMatchObject({ type: 'held', reason: 'urgent', verdict: { reason: 'daily-limit', until: thu(0) } })
    expect(wake.nextCheckAt()).toBe(thu(0))
    clock = thu(0)
    const decision = wake.evaluate()
    expect(decision).toMatchObject({ type: 'wake', reason: 'urgent' })
    expect(decision?.type === 'wake' && decision.items.map((item) => item.id)).toEqual([stop.id])
  })

  it('holds at the daily limit the user chose in Settings (worfy-assistant ticket 15), read at each look', () => {
    let limit = 2
    const wake = new WakePlanner({ now: () => clock, items: () => items, workHours: () => hours, limits: () => limits, ledger, store, dailyWakeLimit: () => limit })
    ledger.noteWake('filler-1', false)
    ledger.noteWake('filler-2', false)
    clock = wed(23)
    runStopped()
    expect(wake.evaluate()).toMatchObject({ type: 'held', verdict: { reason: 'daily-limit', wakes: 2, limit: 2 } })
    limit = 3
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'urgent' })
  })

  it('an escalation the Limits hold stays urgent until they let it go', () => {
    const wake = planner()
    clock = wed(9)
    wake.evaluate()
    const quiet = arrive({ state: 'seen' })
    clock = wed(14)
    limits = { windows: { five_hour: window({ utilization: 1, status: 'rejected' }) } }
    expect(wake.escalate(quiet.id)).toMatchObject({ type: 'held', reason: 'urgent' })
    limits = { windows: {} }
    clock = wed(15)
    expect(wake.evaluate()).toMatchObject({ type: 'wake', reason: 'urgent', items: [expect.objectContaining({ id: quiet.id })] })
  })
})
