// The app's Sessions of Session Nodes (node-sessions.ts, ticket 18), made on first use. They run in
// the app's registry (app-registry.ts), so `agent.send`, `agent.interrupt` and `agent.close` reach
// them too, and they stop with every other Session when the app quits. Like the Orchestrator, they
// belong to the app rather than to a window: their events and views go to every window.
import { stat } from 'node:fs/promises'
import { agentEvent } from '../../shared/ipc/agent'
import { sessionsChanged } from '../../shared/ipc/sessions'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { emit } from '../ipc/index'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { sharedRegistry } from './app-registry'
import { NodeSessions } from './node-sessions'
import { SessionSettingsStore } from './session-settings'

let shared: NodeSessions | null = null

/** The app's Node Sessions, made on first use. */
export function sharedNodeSessions(): NodeSessions {
  if (shared === null) {
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    shared = new NodeSessions({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      registry: sharedRegistry(),
      // The same file as the Orchestrators' (app-orchestrators.ts): one per Project, keyed by Node id.
      settings: new SessionSettingsStore((projectId) => projectStore().dataDir(projectStore().get(projectId).id)),
      claude: (projectRoot) => claude.sessions(projectRoot),
      isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() === true,
      broadcast: (sessionId, event) => toEveryWindow((target) => emit(target, agentEvent, { sessionId, event })),
      publish: (view) => toEveryWindow((target) => emit(target, sessionsChanged, view)),
    })
  }
  return shared
}
