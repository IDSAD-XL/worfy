import { app, BrowserWindow } from 'electron'
import { layoutApply, layoutChanged, layoutGet } from '../../shared/ipc/layout'
import { layoutStore } from '../layout/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = layoutStore()

// Every window hears about every change, whoever made it: this window, another one, or a later
// part of main (the MCP tools) calling the store directly.
store.onChange(({ projectId, layout, revision }) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) emit(window.webContents, layoutChanged, { projectId, layout, revision })
  }
})

// Writes are debounced; what is still pending is written before the app exits.
app.on('will-quit', () => store.flushAll())

export default [
  defineHandler(layoutGet, ({ projectId }) => store.get(projectId)),
  defineHandler(layoutApply, ({ projectId, op }) => store.apply(projectId, op)),
] satisfies HandlerModule
