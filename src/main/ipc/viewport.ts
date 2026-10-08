// The `viewport` IPC domain: the saved camera of a Project's Canvas on this machine (worfy-link
// ticket 06, src/main/layout/viewports.ts). No event goes out: a pan in one window changes nothing
// another window shows.
import { app } from 'electron'
import { viewportGet, viewportSet } from '../../shared/ipc/viewport'
import { viewportStore } from '../layout/viewports'
import { projectStore } from '../projects/store'
import { defineHandler, type HandlerModule } from './index'

const store = viewportStore()

// A Project removed from the list takes its camera along (a Linked machine's Projects keep theirs).
projectStore().onChange(() => store.prune())

// Writes are debounced; what is still pending is written before the app exits.
app.on('will-quit', () => store.flush())

export default [
  defineHandler(viewportGet, ({ projectId, machine }) => store.get(projectId, machine)),
  defineHandler(viewportSet, ({ projectId, viewport, machine }) => store.set(projectId, viewport, machine)),
] satisfies HandlerModule
