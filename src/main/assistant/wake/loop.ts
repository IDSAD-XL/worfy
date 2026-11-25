// The loop of the decision to wake (worfy-assistant ticket 06): it runs the planner (planner.ts) — a look at once, one
// after a change of the items or the Limits, one when the clock makes a wake due — and hands each wake to the function
// that starts its Session. The planner's file is `<WORFY_DATA_DIR>/assistant/wake.json` (ADR-0005). No Electron here:
// app.ts gives it the app's sources.
import { join } from 'node:path'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'
import { MAX_TIMER_MS, type PowerEvents } from '../schedule/scheduler'
import { wakeStateSchema, type AssistantWake, type WakeDecision, type WakePlanner, type WakeStore } from './planner'

/** How long the loop waits after a look that failed (the planner's file could not be written) before the next one. */
export const LOOK_AFTER_ERROR_MS = 60_000

/** The planner's file under WORFY_DATA_DIR. */
export const WAKE_FILE = join('assistant', 'wake.json')

/** The planner's file; an unreadable one is set aside by readJsonFile and the planner starts afresh. */
export function fileWakeStore(file: string): WakeStore {
  return { read: () => readJsonFile(file, wakeStateSchema), write: (state) => writeJsonFile(file, wakeStateSchema, state) }
}

/**
 * The system's wake as a change: the loop looks at once when the Mac wakes, as the scheduler of the checks does
 * (src/main/assistant/schedule/scheduler.ts, followPower), instead of up to MAX_TIMER_MS later.
 */
export function onResume(power: PowerEvents): (listener: () => void) => () => void {
  return (listener) => {
    power.on('resume', listener)
    // A stand-in without removeListener (a test's mock of powerMonitor) keeps the listener; it does nothing once the
    // loop is stopped.
    return () => void power.removeListener?.('resume', listener)
  }
}

export interface WakeLoopOptions {
  planner: WakePlanner
  now: () => number
  /** Starts the Session of a wake; a throw is logged, the wake stays handed over and counted. */
  onWake: (wake: AssistantWake) => void
  /** What makes a wake due besides the clock: a changed item, changed Limits, the Mac's wake. Each answers its unsubscribe. */
  changes: readonly ((listener: () => void) => () => void)[]
  log?: (message: string, error?: unknown) => void
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export interface WakeLoop {
  /** The closed list did not help with item `id`: the model wakes at once (ticket 08). Null once stopped. */
  escalate(id: string): WakeDecision | null
  /** The user wrote to the Assistant (ticket 14). Null once stopped. */
  userMessage(): AssistantWake | null
  stop(): void
}

/**
 * Runs the planner: one look now, one after each change (a burst of changes gives one look), and one when the clock
 * makes a wake due — the timer waits at most MAX_TIMER_MS, so a sleep of the Mac or a change of the clock is caught.
 */
export function runWakeLoop(options: WakeLoopOptions): WakeLoop {
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const log = options.log ?? ((message, error) => console.warn(message, error))
  let timer: unknown
  let soon: unknown
  let stopped = false

  const hand = (decision: WakeDecision | null): WakeDecision | null => {
    if (decision?.type === 'wake') {
      try {
        options.onWake(decision)
      } catch (error) {
        log('[assistant] the Session of a wake did not start', error)
      }
    }
    return decision
  }
  const plan = (failed = false): void => {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    if (stopped) return
    const next = options.planner.nextCheckAt()
    const wait = next === null ? MAX_TIMER_MS : Math.min(Math.max(next - options.now(), 0), MAX_TIMER_MS)
    // A wake that is due stays due when its look fails: without the pause the timer would spin at 0 ms.
    timer = setTimer(look, failed ? Math.max(wait, LOOK_AFTER_ERROR_MS) : wait)
  }
  function look(): void {
    if (stopped) return
    let failed = false
    try {
      hand(options.planner.evaluate())
    } catch (error) {
      failed = true
      log('[assistant] the decision to wake failed', error)
    }
    plan(failed)
  }
  const lookSoon = (): void => {
    if (soon !== undefined || stopped) return
    soon = setTimer(() => {
      soon = undefined
      look()
    }, 0)
  }
  const unsubscribe = options.changes.map((subscribe) => subscribe(lookSoon))
  look()
  return {
    escalate: (id) => {
      if (stopped) return null
      const decision = hand(options.planner.escalate(id))
      plan()
      return decision
    },
    userMessage: () => {
      if (stopped) return null
      const wake = options.planner.userMessage()
      hand(wake)
      plan()
      return wake
    },
    stop: () => {
      stopped = true
      for (const each of unsubscribe) each()
      if (timer !== undefined) clearTimer(timer)
      if (soon !== undefined) clearTimer(soon)
    },
  }
}
