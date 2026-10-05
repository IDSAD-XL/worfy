// Handlers of the `orchestrator` domain (src/shared/ipc/orchestrator.ts), and the place where main
// opens Orchestrators by itself: the active Project's as soon as there is a window to show it, and
// a Project's when it becomes active. A Project removed from the list stops its Orchestrator.
//
// Orchestrators run in the same registry as the Sessions of `agent.start`, so `agent.send`,
// `agent.interrupt` and `agent.close` reach them too. Unlike those Sessions, an Orchestrator
// belongs to the app rather than to a window: its events go to every window, and closing a window
// does not stop it. It stops when the app quits, with every other Session.
import { app, BrowserWindow } from 'electron'
import { orchestratorOpen } from '../../shared/ipc/orchestrator'
import { Orchestrators } from '../agent/orchestrator'
import type { EventSink } from '../agent/session'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { sharedRegistry, windowSink } from './agent'
import { defineHandler, type HandlerModule } from './index'

/** The handlers over a set of Orchestrators; tests pass their own. */
export function orchestratorHandlers(orchestrators: () => Orchestrators): HandlerModule {
  return [defineHandler(orchestratorOpen, ({ projectId }) => orchestrators().open(projectId))]
}

const toEveryWindow: EventSink = (sessionId, event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) windowSink(window.webContents)(sessionId, event)
  }
}

let shared: Orchestrators | null = null

/** The app's Orchestrators, made on first use. */
function sharedOrchestrators(): Orchestrators {
  shared ??= new Orchestrators({
    layout: layoutStore(),
    projectPath: (projectId) => projectStore().get(projectId).path,
    registry: sharedRegistry(),
    broadcast: toEveryWindow,
  })
  return shared
}

function openActive(): void {
  try {
    const active = projectStore().active()
    if (active) sharedOrchestrators().open(active.id)
  } catch (error) {
    console.error('[orchestrator] could not open the Orchestrator of the active Project', error)
  }
}

// Subscribing reads nothing: the Project list is read on the first window, not when this module loads.
app.on('browser-window-created', openActive)
projectStore().onChange(({ activeId, previousActiveId }) => {
  if (activeId !== previousActiveId) openActive()
  shared?.retain(new Set(projectStore().list().map((project) => project.id)))
})

export default orchestratorHandlers(sharedOrchestrators) satisfies HandlerModule
