import { app } from 'electron'

// Each module of main that holds something to end when the app quits — a store to flush, a watcher,
// a child process, the link — subscribes to the app's `will-quit` itself, once, next to what it ends
// (18 places on 2026-10-24, and one more per Autopilot run while it keeps the Mac awake). Node warns
// at the eleventh listener of one event (MaxListenersExceededWarning in the log of the Stable copy,
// 2026-10-19): a check for listeners added again and again, which these are not. A single quit
// handler that calls the stops in order would also change which listener may hold the quit
// (preventDefault: the Terminal's and the link's), so the limit is raised instead, with room to grow.
// It applies to every event of `app`; test/unit/quit-listeners.test.ts keeps it above the count.
export const QUIT_LISTENERS_MAX = 40

app.setMaxListeners(QUIT_LISTENERS_MAX)
