// keep-awake for an Autopilot run (worfy-daily tickets 04 and 32, ADR-0024 item 7, ADR-0034):
// Electron's powerSaveBlocker of type 'prevent-display-sleep' from the run's start to its end,
// including the wait for a Limits reset and the wait for background tasks after Stop. That type
// keeps both the system and the display awake, so the display does not go dark and macOS does not
// lock it: the Wave's agents run e2e and `gate full`, and Electron shows no window on a locked
// screen. It takes precedence over 'prevent-app-suspension', so one blocker per run is enough.
// With the lid closed the Mac sleeps anyway, and a screen locked by hand stays locked: worfy does
// not change the system settings that would prevent either.
//
// The blocker is released when the run ends and also when the app quits: the `will-quit`
// subscription lives here, as the registry's does (src/main/agent/app-registry.ts), so a run that
// never got to stop does not leak its blocker. Each run holds its own blocker.
import { app, powerSaveBlocker } from 'electron'

export const KEEP_AWAKE_TYPE = 'prevent-display-sleep'

/** The parts of Electron keep-awake uses; tests pass their own. */
export interface PowerDeps {
  blocker: {
    start(type: typeof KEEP_AWAKE_TYPE): number
    stop(id: number): unknown
    isStarted(id: number): boolean
  }
  /** Subscribes `listener` to the app's `will-quit`; answers the unsubscribe. */
  onQuit(listener: () => void): () => void
}

export function electronPowerDeps(): PowerDeps {
  return {
    blocker: powerSaveBlocker,
    onQuit: (listener) => {
      app.on('will-quit', listener)
      return () => {
        app.removeListener('will-quit', listener)
      }
    },
  }
}

/** One run's keep-awake: start() once, stop() as often as the run likes. */
export class KeepAwake {
  private id: number | null = null
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: PowerDeps = electronPowerDeps()) {}

  /** Whether this run holds a blocker now. */
  get held(): boolean {
    return this.id !== null
  }

  start(): void {
    if (this.id !== null) return
    this.id = this.deps.blocker.start(KEEP_AWAKE_TYPE)
    this.unsubscribe = this.deps.onQuit(() => this.stop())
  }

  stop(): void {
    const id = this.id
    if (id === null) return
    this.id = null
    const unsubscribe = this.unsubscribe
    this.unsubscribe = null
    try {
      if (this.deps.blocker.isStarted(id)) this.deps.blocker.stop(id)
    } finally {
      unsubscribe?.()
    }
  }
}
