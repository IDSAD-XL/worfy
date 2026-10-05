// The `view` IPC domain: what the View menu (src/main/menu.ts) shows or hides in the window
// (ticket 29: the minimap). The state is kept in memory for the running app; every window hears
// about a change, and `view.get` answers with it.
import { BrowserWindow } from 'electron'
import { viewChanged, viewGet, type ViewState } from '../../shared/ipc/view'
import { defineHandler, emit, type HandlerModule } from './index'

let state: ViewState = { minimap: true }

export function viewState(): ViewState {
  return state
}

/** Changes the state and tells every window. */
export function setViewState(next: ViewState): void {
  state = { ...next }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) emit(window.webContents, viewChanged, state)
  }
}

export default [defineHandler(viewGet, () => state)] satisfies HandlerModule
