import { app } from 'electron'
import { layoutApply, layoutArchiveCandidates, layoutChanged, layoutGet } from '../../shared/ipc/layout'
import { toEveryWindow } from '../broadcast'
import { runningArchiver } from '../layout/archive'
import { layoutStore } from '../layout/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = layoutStore()

// Every client (src/main/clients.ts) hears about every change, whoever made it: this window,
// another one, a client without a window, or a later part of main (the MCP tools) calling the
// store directly. The change carries its operation and the screen that sent it, so a screen's undo
// history can tell when another screen changed a Node it would undo (worfy-link ticket 07).
store.onChange(({ projectId, layout, revision, op, screen }) => {
  toEveryWindow((client) => emit(client, layoutChanged, { projectId, layout, revision, op, screen }))
})

// Writes are debounced; what is still pending is written before the app exits.
app.on('will-quit', () => store.flushAll())

export default [
  defineHandler(layoutGet, ({ projectId }) => store.get(projectId)),
  defineHandler(layoutApply, ({ projectId, op, screen }) => store.apply(projectId, op, screen ?? null)),
  // The candidates of «Archive finished sessions now», read by the app's archiver (src/main/index.ts).
  defineHandler(layoutArchiveCandidates, ({ projectId }) => {
    const archiver = runningArchiver()
    if (archiver === null) throw new Error('the automatic archive is not running')
    return archiver.candidatesNow(projectId)
  }),
] satisfies HandlerModule
