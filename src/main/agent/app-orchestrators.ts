// The app's Orchestrators (orchestrator.ts) and when main opens them by itself: the active
// Project's as soon as there is a window to show it, and a Project's when it becomes active. A
// Project removed from the list stops its Orchestrator. src/main/index.ts calls
// startOrchestrators() once; the `orchestrator` IPC handlers only use sharedOrchestrators().
//
// Orchestrators run in the app's registry (app-registry.ts), so `agent.send`, `agent.interrupt`
// and `agent.close` reach them too. Like every Session of the app (the Sessions of `agent.start`
// and of Session Nodes too, ADR-0053 point 4), an Orchestrator belongs to the app rather than to a
// window: its events and views go to every client of the app, and closing a window does not stop
// it. It stops when the app quits, with every other Session.
import { app } from 'electron'
import { agentEvent } from '../../shared/ipc/agent'
import { orchestratorChanged } from '../../shared/ipc/orchestrator'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { emit } from '../ipc/index'
import { layoutStore } from '../layout/store'
import { projectHolds } from '../projects/holds'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { sharedRegistry } from './app-registry'
import { Orchestrators } from './orchestrator'
import { readTranscriptFacts } from './orchestrator-transcript'
import { SessionSettingsStore } from './session-settings'

let shared: Orchestrators | null = null

/** The app's Orchestrators, made on first use. */
export function sharedOrchestrators(): Orchestrators {
  if (shared === null) {
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    shared = new Orchestrators({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      registry: sharedRegistry(),
      // Asked through get(), like the Layout: a Project removed from the list is refused, so a
      // late write does not create its data folder again.
      settings: new SessionSettingsStore((projectId) => projectStore().dataDir(projectStore().get(projectId).id)),
      transcript: async (projectRoot, sdkSessionId) => {
        const path = await claude.transcriptPath(projectRoot, sdkSessionId)
        return path === null ? null : readTranscriptFacts(path)
      },
      broadcast: (sessionId, event) => toEveryWindow((target) => emit(target, agentEvent, { sessionId, event })),
      publish: (view) => toEveryWindow((target) => emit(target, orchestratorChanged, view)),
    })
  }
  return shared
}

function openActive(): void {
  try {
    const active = projectStore().active()
    if (active) {
      sharedOrchestrators()
        .open(active.id)
        .catch((error: unknown) => console.error(`[orchestrator] could not open the Orchestrator of ${active.id}`, error))
    }
  } catch (error) {
    console.error('[orchestrator] could not open the Orchestrator of the active Project', error)
  }
}

/**
 * Opens the Orchestrator of every Project a screen of a Linked machine shows (worfy-link ticket
 * 09, projects/holds.ts), as for the active Project. Opening one that is open does nothing.
 */
function openHeld(): void {
  for (const projectId of projectHolds().projectIds()) {
    try {
      sharedOrchestrators()
        .open(projectId)
        .catch((error: unknown) => console.error(`[orchestrator] could not open the Orchestrator of ${projectId}`, error))
    } catch (error) {
      console.error(`[orchestrator] could not open the Orchestrator of the held Project ${projectId}`, error)
    }
  }
}

let started = false

/**
 * Subscribes main's own opening of Orchestrators; a second call does nothing. Subscribing reads
 * nothing: the Project list is read on the first window, not when this runs.
 */
export function startOrchestrators(): void {
  if (started) return
  started = true
  app.on('browser-window-created', openActive)
  projectHolds().onChange(openHeld)
  projectStore().onChange(({ activeId, previousActiveId }) => {
    if (activeId !== previousActiveId) openActive()
    shared?.retain(new Set(projectStore().list().map((project) => project.id)))
  })
}
