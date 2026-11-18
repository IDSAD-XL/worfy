// Handlers of the `quitGrace` domain (src/shared/ipc/quit-grace.ts): the window «Quitting worfy» of the quit's
// coordinator (src/main/quit-grace.ts, worfy-continuity ticket 04). A window reads the view at its load; the
// changes come on `quitGrace.changed` (src/main/index.ts sends them to every window). Quit now ends the wait.
import { quitGraceQuitNow, quitGraceState } from '../../shared/ipc/quit-grace'
import { appQuitGrace } from '../quit-grace'
import { defineHandler, type HandlerModule } from './index'

export default [
  defineHandler(quitGraceState, () => appQuitGrace()?.view ?? null),
  defineHandler(quitGraceQuitNow, () => {
    appQuitGrace()?.quitNow()
  }),
] satisfies HandlerModule
