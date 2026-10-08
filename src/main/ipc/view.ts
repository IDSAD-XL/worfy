// The `view` IPC domain: what the View menu (src/main/menu.ts) shows or hides in the window
// (ticket 29: the minimap). The state is kept in memory for the running app; every client hears
// about a change, and `view.get` answers with it.
import { toEveryWindow } from '../broadcast'
import { viewChanged, viewGet, type ViewState } from '../../shared/ipc/view'
import { defineHandler, emit, type HandlerModule } from './index'

let state: ViewState = { minimap: true }

export function viewState(): ViewState {
  return state
}

/** Changes the state and tells every client. */
export function setViewState(next: ViewState): void {
  state = { ...next }
  toEveryWindow((client) => emit(client, viewChanged, state))
}

export default [defineHandler(viewGet, () => state)] satisfies HandlerModule
