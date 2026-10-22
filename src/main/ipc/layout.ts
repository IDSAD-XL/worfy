import { app } from 'electron'
import { layoutApply, layoutArchiveCandidates, layoutArchived, layoutChanged, layoutGet, layoutRestoreBatch } from '../../shared/ipc/layout'
import { toEveryWindow } from '../broadcast'
import { onArchiveBatch, restoreBatch, runningArchiver, type AutoArchiver } from '../layout/archive'
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

// Each batch of main's archive timer: every window of its Project shows the toast with Undo
// (worfy-canvas ticket 10, ADR-0076, point 8).
onArchiveBatch((batch) => {
  toEveryWindow((client) => emit(client, layoutArchived, batch))
})

// Writes are debounced; what is still pending is written before the app exits.
app.on('will-quit', () => store.flushAll())

/** The app's archiver; without it nobody can tell a live Session, so nothing is archived (not known — not closed). */
function appArchiver(): AutoArchiver {
  const archiver = runningArchiver()
  if (archiver === null) throw new Error('the automatic archive is not running')
  return archiver
}

export default [
  defineHandler(layoutGet, ({ projectId }) => store.get(projectId)),
  // An `archive` from a window or a Linked machine keeps the archive rule's exceptions, checked by
  // the app's archiver at the write (ADR-0076); main's own timer applies to the store directly.
  // An operation that may take a Session off the Canvas first asks the pages of its Browsers for
  // unsaved changes (src/main/layout/store.ts, askBrowsersFirst).
  defineHandler(layoutApply, async ({ projectId, op, screen }) => {
    await store.askBrowsersFirst(projectId, op)
    return op.op === 'archive' ? appArchiver().archiveFromScreen(projectId, op, screen ?? null) : store.apply(projectId, op, screen ?? null)
  }),
  // The candidates of «Archive finished sessions now», read by the app's archiver (src/main/index.ts).
  defineHandler(layoutArchiveCandidates, ({ projectId }) => appArchiver().candidatesNow(projectId)),
  // The Undo of a batch's toast: that batch alone, without a screen (src/main/layout/archive.ts).
  defineHandler(layoutRestoreBatch, ({ projectId, batch }) => restoreBatch(store, projectId, batch)),
] satisfies HandlerModule
