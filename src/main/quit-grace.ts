// The one coordinator of worfy's quit (worfy-continuity ticket 04, the spec's grace on quit and on Update). A quit,
// "Restart now" of Update and a shutdown of the system all go through it, in steps:
//
// 1. Departing (depart): the registry sends nothing more — a message waits in its Session's queue, and the end
//    of a turn sends nothing from it — while the turns under way run on (SessionRegistry.depart). Every Autopilot
//    Run gets the cycle's `suspend`: it starts no Wave, and its waits (the Limits, a retry, the budget, the Start
//    window) stop without sending anything (Autopilot.suspendAll). Auto-continue of the Orchestrators' own turns
//    stops (OrchestratorContinue.stop).
// 2. The grace: while a Session has a call of its own (not a Subagent's: worfy-continuity ticket 07) that may act
//    outside the machine and has no result yet (externalActions of continue-plan.ts with `done: false`), the quit
//    waits for its result, GRACE_MS at most. Every window shows «Quitting worfy» meanwhile: the calls, the time
//    left and Quit now, which ends the wait at once. Without such a call the quit goes on at once, with no window.
// 3. The halt: each stopped Run that still waited for its background tasks journals them as killed — before its
//    Session closes, which it would read as given back (Autopilot.recordKilled) — the record of live Sessions stops
//    (live-sessions.ts keeps what was under way for the start after), every Session's turn is interrupted (its end waited for QUIT_HALT_TURN_MS at most in the app) and the Session
//    closed, and its processes are waited for: EXIT_WAIT_MS, then SIGKILL and KILL_EXIT_MS more
//    (SessionRegistry.haltAll, ADR-0064).
// 4. The records: each Run writes `run-suspended` with the cause — `quit`, `update` or `shutdown` — and, after a
//    shutdown, which skips the halt, a stopped Run that still waited for its background tasks journals them as
//    killed (Autopilot.recordQuit). Then the
//    coordinator lets the quit go: the app quits again, and every `before-quit` and `will-quit` handler runs.
//
// A shutdown of the system (followShutdown: powerMonitor's `shutdown` on macOS and Linux, a window's `session-end`
// on Windows) does not wait: the system will not. It departs and writes the records, with no grace and no halt;
// a shutdown during the grace ends it the same way. The coordinator is registered first in `before-quit`
// (src/main/index.ts) and holds every quit until step 4 is done.
import { externalActions } from '../shared/agent/continue-plan'
import type { AgentEvent } from '../shared/agent/events'
import type { SuspendCause } from '../shared/autopilot/journal'
import { QUIT_GRACE_CALLS_MAX, type QuitGraceView } from '../shared/ipc/quit-grace'

/** How long the quit waits for the external calls without a result (spec Q2 (a), the 60 s of Codex's daemon). */
export const GRACE_MS = 60_000

/**
 * How long the halt waits for an interrupted turn to end before its Session is closed anyway (Session.halt). A Stop
 * waits HALT_TURN_MS (15 s); the quit has already waited for the external calls, the close ends the turn as surely,
 * and the swap helper of an Update waits two minutes for worfy in all (docs/features/updates.md).
 */
export const QUIT_HALT_TURN_MS = 2_000

/** The clock of the grace: the wall clock in the app, the test's in tests. */
export interface QuitClock {
  now(): number
  setTimeout(fire: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

const WALL_CLOCK: QuitClock = {
  now: () => Date.now(),
  setTimeout: (fire, delay) => setTimeout(fire, delay),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** A call of a Session's own that may act outside the machine and has no result yet. */
export interface OpenCall {
  sessionId: string
  toolUseId: string
  /** What it does, in short (ExternalAction.description). */
  description: string
}

/**
 * The calls of every Session's current turn, followed from the registry's events (SessionRegistry.observe), and
 * which of them may act outside the machine and have no result yet. A turn's calls go at its end (`result`), at
 * the next turn's `prompt`, when the Session closes and when its process is gone (state `error`: no result comes
 * any more); a Session renamed takes its calls along.
 */
export class OpenCalls {
  private readonly turns = new Map<string, AgentEvent[]>()
  private readonly listeners = new Set<() => void>()

  /** Every event of every Session: the sink SessionRegistry.observe takes. */
  readonly sink = (sessionId: string, event: AgentEvent): void => {
    switch (event.type) {
      case 'tool_use':
      case 'tool_result': {
        const turn = this.turns.get(sessionId) ?? []
        turn.push(event)
        this.turns.set(sessionId, turn)
        break
      }
      case 'renamed': {
        const turn = this.turns.get(event.from)
        if (turn === undefined) return
        this.turns.delete(event.from)
        this.turns.set(sessionId, turn)
        return
      }
      case 'prompt':
      case 'result':
        if (!this.turns.delete(sessionId)) return
        break
      case 'state':
        if ((event.state !== 'closed' && event.state !== 'error') || !this.turns.delete(sessionId)) return
        break
      default:
        return
    }
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.warn('[quit] a listener of the open calls failed', error)
      }
    }
  }

  /** The calls without a result now, Session by Session, each in the order it was made. */
  open(): OpenCall[] {
    return [...this.turns].flatMap(([sessionId, events]) =>
      externalActions(events)
        .filter((action) => !action.done)
        .map((action) => ({ sessionId, toolUseId: action.toolUseId, description: action.description })),
    )
  }

  /** Calls `listener` after every change of the calls; answers the unsubscribe. */
  observe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
}

/** Steps 1, 3 and 4 of the quit, as the app does them (quitSteps) or a test fakes them. */
export interface QuitSteps {
  /** Step 1: nothing more is sent, no Run starts a Wave, nothing is continued. Synchronous. */
  depart(): void
  /** Step 3: the turns interrupted, the Sessions closed, their processes exited or killed. */
  halt(): Promise<void>
  /** Step 4: the records of the quit with its cause. */
  record(cause: SuspendCause): Promise<void>
}

export interface QuitGraceDeps extends QuitSteps {
  /** The calls of the Sessions (OpenCalls). */
  calls: Pick<OpenCalls, 'open' | 'observe'>
  /** Shows the window «Quitting worfy» in every window; null closes it. */
  show(view: QuitGraceView): void
  /** The coordinator lets the quit go: the app quits again (app.quit()), and beforeQuit no longer holds it. */
  quit(): void
  /** The wall clock unless given. */
  clock?: QuitClock
  /** GRACE_MS unless given. */
  graceMs?: number
}

type Stage = 'idle' | 'grace' | 'halting' | 'recording' | 'released'

/** The quit's coordinator; see the head of the file. */
export class QuitGrace {
  private stage: Stage = 'idle'
  private cause: SuspendCause = 'quit'
  /** A shutdown came: no grace and no halt from now on. */
  private shutdownNow = false
  /** Ends the grace's wait at once; null while none runs. */
  private endWait: (() => void) | null = null
  private viewValue: QuitGraceView = null
  /** Settles once the coordinator has let the quit go. */
  private released: Promise<void> | null = null
  private readonly clock: QuitClock

  constructor(private readonly deps: QuitGraceDeps) {
    this.clock = deps.clock ?? WALL_CLOCK
  }

  /** The window's view now (`quitGrace.state`). */
  get view(): QuitGraceView {
    return this.viewValue
  }

  /**
   * The app's `before-quit`, registered first: a quit the coordinator has not let go is held (preventDefault)
   * and led through the steps, as a quit by a person (`quit`). Once let go, the quit passes.
   */
  beforeQuit(event: { preventDefault(): void }): void {
    if (this.stage === 'released') return
    event.preventDefault()
    void this.leave('quit')
  }

  /**
   * Leads the quit through the steps with `cause` ("Restart now" of Update: `update`); a quit already under way goes
   * on with its own cause. Settles once the coordinator has let the quit go.
   */
  leave(cause: SuspendCause): Promise<void> {
    if (this.released !== null) return this.released
    this.cause = cause
    this.released = this.steps()
    return this.released
  }

  /** Quit now: the grace ends at once; nothing happens outside it. */
  quitNow(): void {
    this.endWait?.()
  }

  /**
   * The system shuts down: the records, with cause `shutdown`, and the quit, without grace or halt. During the
   * grace it ends the grace; during the halt the halt still ends first; once the records are being written, their
   * cause stays.
   */
  shutdown(): Promise<void> {
    this.shutdownNow = true
    if (this.stage !== 'recording' && this.stage !== 'released') this.cause = 'shutdown'
    this.endWait?.()
    return this.leave('shutdown')
  }

  private async steps(): Promise<void> {
    this.stage = 'grace'
    try {
      this.deps.depart()
    } catch (error) {
      console.error('[quit] could not stop sending', error)
    }
    if (!this.shutdownNow) await this.grace()
    if (!this.shutdownNow) {
      this.stage = 'halting'
      if (this.viewValue !== null) this.setView({ ...this.viewValue, stage: 'stopping', leftMs: 0 })
      try {
        await this.deps.halt()
      } catch (error) {
        console.error('[quit] could not stop the agents', error)
      }
    }
    this.stage = 'recording'
    try {
      await this.deps.record(this.cause)
    } catch (error) {
      console.error('[quit] could not write the records of the quit', error)
    }
    if (this.viewValue !== null) this.setView(null)
    this.stage = 'released'
    this.deps.quit()
  }

  /** Step 2: waits while calls without a result are left, graceMs at most or until Quit now; the window meanwhile. */
  private grace(): Promise<void> {
    if (this.deps.calls.open().length === 0) return Promise.resolve()
    return new Promise((done) => {
      const until = this.clock.now() + (this.deps.graceMs ?? GRACE_MS)
      let unobserve: () => void = () => undefined
      const finish = (): void => {
        if (this.endWait !== finish) return
        this.endWait = null
        unobserve()
        this.clock.clearTimeout(timer)
        done()
      }
      const look = (): void => {
        if (this.endWait !== finish) return
        const calls = this.deps.calls.open()
        if (calls.length === 0) return finish()
        this.setView({
          stage: 'waiting',
          calls: calls.slice(0, QUIT_GRACE_CALLS_MAX).map((call) => ({ id: call.toolUseId, description: call.description })),
          total: calls.length,
          leftMs: Math.max(0, Math.round(until - this.clock.now())),
        })
      }
      this.endWait = finish
      const timer = this.clock.setTimeout(finish, Math.max(0, until - this.clock.now()))
      unobserve = this.deps.calls.observe(look)
      look()
    })
  }

  private setView(view: QuitGraceView): void {
    this.viewValue = view
    try {
      this.deps.show(view)
    } catch (error) {
      console.warn('[quit] could not show the window «Quitting worfy»', error)
    }
  }
}

/** The parts of the app the steps act on; each may be missing — a quit before it was made acts on nothing of it. */
export interface QuitParts {
  registry?: { depart(): void; haltAll(haltTurnMs?: number): Promise<void> } | null | undefined
  /** The record of live Sessions (live-sessions.ts): stopped before the halt, so that it keeps what was under way. */
  live?: { stop(): void; settled(): Promise<void> } | null | undefined
  autopilot?: { suspendAll(): void; recordKilled(): Promise<void>; recordQuit(cause: SuspendCause): Promise<void> } | null | undefined
  /** Auto-continue of the Orchestrators' own turns. */
  continuer?: { stop(): void } | null | undefined
  /** How long a turn's interrupt is waited for (Session.halt's HALT_TURN_MS unless given). */
  haltTurnMs?: number
}

/** Steps 1, 3 and 4 over the parts `parts()` answers when each step runs. */
export function quitSteps(parts: () => QuitParts): QuitSteps {
  return {
    depart: () => {
      const { registry, autopilot, continuer } = parts()
      registry?.depart()
      autopilot?.suspendAll()
      continuer?.stop()
    },
    halt: async () => {
      const { registry, live, autopilot, haltTurnMs } = parts()
      // Before any Session closes: a stopped Run would read its Session's close as given back, not killed. A failure
      // here does not keep the Sessions from being halted.
      try {
        await autopilot?.recordKilled()
      } catch (error) {
        console.error('[quit] could not journal the background tasks as killed', error)
      }
      if (live !== null && live !== undefined) {
        live.stop()
        await live.settled()
      }
      await registry?.haltAll(haltTurnMs)
    },
    record: async (cause) => {
      await parts().autopilot?.recordQuit(cause)
    },
  }
}

/** What tells worfy the system shuts down; Electron's in the app, emitters in tests. */
export interface ShutdownSources {
  platform: NodeJS.Platform
  /**
   * Electron's powerMonitor: `shutdown` on macOS and Linux. Electron gives the listener an event whose
   * preventDefault delays the shutdown (its documentation; its typings leave the event out).
   */
  power: { on(event: 'shutdown', listener: (event?: { preventDefault(): void }) => void): unknown }
  /** Electron's app: each window as it is made, for its `session-end` on Windows. */
  windows: { on(event: 'browser-window-created', listener: (event: unknown, window: { on(event: 'session-end', listener: () => void): unknown }) => void): unknown }
}

/**
 * Calls `shutdown` when the system shuts down, restarts or the user logs off: on Windows a window's `session-end`
 * (Electron has no `shutdown` there), elsewhere powerMonitor's `shutdown`, whose preventDefault asks the system
 * for the moment the records take. Installed before the first window.
 */
export function followShutdown(sources: ShutdownSources, shutdown: () => void): void {
  if (sources.platform === 'win32') {
    sources.windows.on('browser-window-created', (_event, window) => {
      window.on('session-end', () => shutdown())
    })
    return
  }
  sources.power.on('shutdown', (event) => {
    event?.preventDefault()
    shutdown()
  })
}

let appGrace: QuitGrace | null = null

/** Sets the app's coordinator (src/main/index.ts); the `quitGrace` handlers and Update reach it through appQuitGrace(). */
export function setAppQuitGrace(grace: QuitGrace): void {
  appGrace = grace
}

/** The app's coordinator; null before index.ts has set it (tests). */
export function appQuitGrace(): QuitGrace | null {
  return appGrace
}
