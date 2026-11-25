// The loop of the decision to wake (src/main/assistant/wake/loop.ts, worfy-assistant ticket 06): it looks at once,
// after a change of the items or the Limits, and when the clock makes a wake due, and hands each wake to the Session
// starter. The clock is vitest's fake one; the planner's file is a real one in a temporary folder, so a restart is a
// second loop over it.
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from '../../src/shared/assistant/attention'
import type { WorkHours } from '../../src/shared/assistant/schedule/work-hours'
import { MAX_TIMER_MS } from '../../src/main/assistant/schedule/scheduler'
import { fileWakeStore, LOOK_AFTER_ERROR_MS, onResume, runWakeLoop, type WakeLoop } from '../../src/main/assistant/wake/loop'
import { BATCH_GATHER_MS, WakePlanner, type AssistantWake } from '../../src/main/assistant/wake/planner'
import { removeTestTree } from '../remove'

const KYIV = 'Europe/Kyiv'
const OFFICE: WorkHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 9 * 60, to: 18 * 60 }], timeZone: KYIV }
/** Wednesday 25 November 2026 in Kyiv (UTC+2): `hour` local. */
const wed = (hour: number, minute = 0): number => Date.UTC(2026, 10, 25, hour - 2, minute)

let dir: string
let items: AttentionItem[]
let wakesToday: number
let listeners: (() => void)[]
const loops: WakeLoop[] = []

beforeEach(() => {
  vi.useFakeTimers({ now: wed(8, 50) })
  dir = mkdtempSync(join(tmpdir(), 'worfy-wake-loop-'))
  items = []
  wakesToday = 0
  listeners = []
})
afterEach(() => {
  for (const loop of loops.splice(0)) loop.stop()
  vi.useRealTimers()
  removeTestTree(dir)
})

function start(onWake: (wake: AssistantWake) => void, log?: (message: string) => void): WakeLoop {
  const planner = new WakePlanner({
    now: () => Date.now(),
    items: () => items,
    workHours: () => OFFICE,
    limits: () => ({ windows: {} }),
    ledger: { automaticWakesToday: () => wakesToday, noteWake: () => void (wakesToday += 1) },
    store: fileWakeStore(join(dir, 'assistant', 'wake.json')),
  })
  const loop = runWakeLoop({
    planner,
    now: () => Date.now(),
    onWake,
    changes: [
      (listener) => {
        listeners.push(listener)
        return () => void (listeners = listeners.filter((each) => each !== listener))
      },
    ],
    ...(log ? { log } : {}),
  })
  loops.push(loop)
  return loop
}

function arrive(over: Partial<AttentionItem> = {}): AttentionItem {
  const at = Date.now()
  const made: AttentionItem = { id: `p1|pr|o/r#${items.length + 1}|needs-review|${at}`, source: 'pr-inbox', projectId: 'p1', subject: { kind: 'pr', id: `o/r#${items.length + 1}`, label: 'o/r' }, kind: 'needs-review', text: 't', startedAt: at, updatedAt: at, revision: 'r', state: 'new', duty: null, events: 1, ...over }
  items.push(made)
  for (const listener of listeners) listener()
  return made
}

describe('runWakeLoop', () => {
  it('wakes at the start of work hours by the timer, then on a change and at the batch time', async () => {
    const wakes: AssistantWake[] = []
    start((wake) => wakes.push(wake))
    expect(wakes).toEqual([])
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(wakes.map((wake) => [wake.reason, wake.at])).toEqual([['morning', wed(9)]])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    // An urgent item: a change makes the loop look at once.
    arrive({ source: 'autopilot', kind: 'run-stopped', subject: { kind: 'run', id: 'r1', label: 'Autopilot' } })
    arrive({ source: 'autopilot', kind: 'run-stopped', subject: { kind: 'run', id: 'r2', label: 'Autopilot' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wakes.map((wake) => wake.reason)).toEqual(['morning', 'urgent'])
    expect(wakes[1]?.items).toHaveLength(2)
    const pr = arrive()
    await vi.advanceTimersByTimeAsync(BATCH_GATHER_MS - 1)
    expect(wakes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(wakes.map((wake) => wake.reason)).toEqual(['morning', 'urgent', 'batch'])
    expect(wakes[2]?.items.map((item) => item.id)).toEqual([pr.id])
  })

  it('keeps what it handed over in its file, so a restart does not wake for it again', async () => {
    vi.setSystemTime(wed(10))
    const first: AssistantWake[] = []
    start((wake) => first.push(wake))
    expect(first.map((wake) => wake.reason)).toEqual(['morning'])
    expect(JSON.parse(readFileSync(join(dir, 'assistant', 'wake.json'), 'utf8'))).toMatchObject({ morningDay: '2026-11-25' })
    loops.splice(0).forEach((loop) => loop.stop())
    const second: AssistantWake[] = []
    start((wake) => second.push(wake))
    await vi.advanceTimersByTimeAsync(2 * MAX_TIMER_MS)
    expect(second).toEqual([])
  })

  it('a Session that does not start is logged; the loop goes on', async () => {
    vi.setSystemTime(wed(10))
    const logged: string[] = []
    let calls = 0
    start(() => {
      calls += 1
      throw new Error('no Session')
    }, (message) => logged.push(message))
    expect(logged).toEqual(['[assistant] the Session of a wake did not start'])
    arrive({ source: 'autopilot', kind: 'run-stopped', subject: { kind: 'run', id: 'r1', label: 'Autopilot' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(2)
  })

  it('a look that fails (the file cannot be written) is logged and tried again after LOOK_AFTER_ERROR_MS, not at once', async () => {
    vi.setSystemTime(wed(10))
    const logged: string[] = []
    let looks = 0
    const planner = new WakePlanner({
      now: () => Date.now(),
      items: () => items,
      workHours: () => OFFICE,
      limits: () => ({ windows: {} }),
      ledger: { automaticWakesToday: () => 0, noteWake: () => undefined },
      store: {
        read: () => undefined,
        write: () => {
          looks += 1
          throw new Error('disk full')
        },
      },
    })
    const loop = runWakeLoop({ planner, now: () => Date.now(), onWake: () => undefined, changes: [], log: (message) => logged.push(message) })
    loops.push(loop)
    expect(looks).toBe(1)
    await vi.advanceTimersByTimeAsync(LOOK_AFTER_ERROR_MS - 1)
    expect(looks).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(looks).toBe(2)
    expect(logged).toEqual(['[assistant] the decision to wake failed', '[assistant] the decision to wake failed'])
  })

  it('a message of the user and an escalation reach the Session starter', () => {
    vi.setSystemTime(wed(10))
    const wakes: AssistantWake[] = []
    const loop = start((wake) => wakes.push(wake))
    const quiet = arrive({ state: 'seen' })
    expect(loop.userMessage()).toMatchObject({ reason: 'user' })
    expect(loop.escalate(quiet.id)).toMatchObject({ type: 'wake', reason: 'urgent' })
    expect(wakes.map((wake) => wake.reason)).toEqual(['morning', 'user', 'urgent'])
  })

  it('stop() ends the timer and the subscriptions', async () => {
    const wakes: AssistantWake[] = []
    const loop = start((wake) => wakes.push(wake))
    loop.stop()
    expect(listeners).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * MAX_TIMER_MS)
    expect(wakes).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('after stop() a message of the user and an escalation wake nothing', () => {
    vi.setSystemTime(wed(23))
    const wakes: AssistantWake[] = []
    const loop = start((wake) => wakes.push(wake))
    const quiet = arrive({ state: 'seen' })
    loop.stop()
    expect(loop.userMessage()).toBeNull()
    expect(loop.escalate(quiet.id)).toBeNull()
    expect(wakes).toEqual([])
  })

  it('a burst of changes gives one look', async () => {
    vi.setSystemTime(wed(23))
    const planner = new WakePlanner({ now: () => Date.now(), items: () => items, workHours: () => OFFICE, limits: () => ({ windows: {} }), ledger: { automaticWakesToday: () => 0, noteWake: () => undefined }, store: fileWakeStore(join(dir, 'wake.json')) })
    const evaluate = vi.spyOn(planner, 'evaluate')
    let changed: () => void = () => undefined
    loops.push(runWakeLoop({ planner, now: () => Date.now(), onWake: () => undefined, changes: [(listener) => ((changed = listener), () => undefined)] }))
    expect(evaluate).toHaveBeenCalledTimes(1)
    changed()
    changed()
    changed()
    await vi.advanceTimersByTimeAsync(0)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('looks again when the Mac wakes: the morning summary comes then, not with the next timer', async () => {
    vi.setSystemTime(wed(18, 30))
    const power = new EventEmitter()
    const wakes: AssistantWake[] = []
    const planner = new WakePlanner({ now: () => Date.now(), items: () => items, workHours: () => OFFICE, limits: () => ({ windows: {} }), ledger: { automaticWakesToday: () => 0, noteWake: () => undefined }, store: fileWakeStore(join(dir, 'wake.json')) })
    const loop = runWakeLoop({ planner, now: () => Date.now(), onWake: (wake) => wakes.push(wake), changes: [onResume(power)] })
    loops.push(loop)
    // The Mac sleeps through the night; its timers do not run. It opens at 10:00 on Thursday.
    vi.setSystemTime(wed(34))
    power.emit('suspend')
    await vi.advanceTimersByTimeAsync(0)
    expect(wakes).toEqual([])
    power.emit('resume')
    await vi.advanceTimersByTimeAsync(0)
    expect(wakes.map((wake) => [wake.reason, wake.at])).toEqual([['morning', wed(34)]])
    loop.stop()
    expect(power.listenerCount('resume')).toBe(0)
  })
})
