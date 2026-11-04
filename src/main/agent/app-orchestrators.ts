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
//
// Each Orchestrator runs on its Project's `defaultVendor` (worfy-multi-vendor ticket 37), read from the
// Project's settings when it starts; a Project that names none runs it on Claude Code.
import { app } from 'electron'
import type { SessionSettings } from '../../shared/agent/settings'
import { agentEvent } from '../../shared/ipc/agent'
import { orchestratorChanged, type OrchestratorView } from '../../shared/ipc/orchestrator'
import type { VendorId } from '../../shared/vendors/vendor'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { emit } from '../ipc/index'
import { layoutStore } from '../layout/store'
import { projectHolds } from '../projects/holds'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { vendorDriver } from '../vendors/registry'
import { sharedRegistry } from './app-registry'
import { Orchestrators } from './orchestrator'
import { readTranscriptFacts, type TranscriptFacts } from './orchestrator-transcript'
import { SessionSettingsStore } from './session-settings'

/** Projects whose Orchestrator may not be opened for now, with how many holds each has. */
const keptClosed = new Map<string, number>()

/** What opening a held Project's Orchestrator answers: an error the caller shows, not a Session. */
export const BEING_REMOVED = 'the project is being removed'

/**
 * The app's Orchestrators with the holds of keepClosed: every opening — main's own (a new window,
 * the active Project, a Linked machine's screen), `orchestrator.open` and `orchestrator.newConversation`
 * of a window — goes through open(), which refuses a held Project before anything starts.
 */
class AppOrchestrators extends Orchestrators {
  override open(projectId: string, options?: { firstSettings?: SessionSettings }): Promise<OrchestratorView> {
    if (keptClosed.has(projectId)) return Promise.reject(new Error(`The Orchestrator was not opened: ${BEING_REMOVED}`))
    return super.open(projectId, options)
  }
}

let shared: Orchestrators | null = null

/** What a Node shows before its Session says anything, when the transcript is not read. */
const NO_FACTS: TranscriptFacts = { model: null, statusBlock: null }

/** The app's Orchestrators, made on first use. */
export function sharedOrchestrators(): Orchestrators {
  if (shared === null) {
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    /** Each Vendor's reader of what a saved session's transcript tells the Node (TranscriptFacts). */
    const transcripts: Record<VendorId, (projectRoot: string, sessionId: string) => Promise<TranscriptFacts | null>> = {
      claude: async (projectRoot, sessionId) => {
        // A caller of this Machine: a saved Session whose cwd is unknown is still found (RegistryRoot).
        const path = await claude.transcriptPath({ path: projectRoot, local: true }, sessionId)
        return path === null ? null : readTranscriptFacts(path)
      },
      // shortcut: a Codex thread's transcript is not read; its Node shows no model or status block
      // until its first answer after a start, and a thread that is gone is found by the resume itself
      // (orchestrator.ts, NO_CONVERSATION). Redo when the Node must show them at once: read the tail
      // of the thread through the Codex driver (thread/read reads the whole thread).
      codex: () => Promise.resolve(NO_FACTS),
    }
    shared = new AppOrchestrators({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      registry: sharedRegistry(),
      // Asked through get(), like the Layout: a Project removed from the list is refused, so a
      // late write does not create its data folder again.
      settings: new SessionSettingsStore((projectId) => projectStore().dataDir(projectStore().get(projectId).id)),
      vendor: (projectId) => readProjectSettings(projectStore().dataDir(projectStore().get(projectId).id)).defaultVendor,
      transcript: (projectRoot, sdkSessionId, vendor) => transcripts[vendor](projectRoot, sdkSessionId),
      capabilities: (vendor) => vendorDriver(vendor).capabilities(),
      harnessHooks: (vendor) => vendorDriver(vendor).harnessHooks,
      broadcast: (sessionId, event) => toEveryWindow((target) => emit(target, agentEvent, { sessionId, event })),
      publish: (view) => toEveryWindow((target) => emit(target, orchestratorChanged, view)),
    })
  }
  return shared
}

/**
 * The Project's Orchestrator is not opened — by main itself or for a window — until the returned
 * function is called (AppOrchestrators). The removal of the Demo project holds it while it closes
 * the demo's Sessions and deletes the folder (worfy-onboarding ticket 10).
 */
export function keepClosed(projectId: string): () => void {
  keptClosed.set(projectId, (keptClosed.get(projectId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (keptClosed.get(projectId) ?? 1) - 1
    if (left > 0) keptClosed.set(projectId, left)
    else keptClosed.delete(projectId)
  }
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
