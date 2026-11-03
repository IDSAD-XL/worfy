// The app's Sessions of Session Nodes (node-sessions.ts, ticket 18), made on first use. They run in
// the app's registry (app-registry.ts), so `agent.send`, `agent.interrupt` and `agent.close` reach
// them too, and they stop with every other Session when the app quits. Like the Orchestrator, they
// belong to the app rather than to a window: their events and views go to every window.
//
// Each Node's Session runs on its Vendor's driver (worfy-multi-vendor ticket 23); New session takes the
// Project's `defaultVendor` from its settings when it names no Vendor.
import { stat } from 'node:fs/promises'
import { agentEvent } from '../../shared/ipc/agent'
import { sessionsChanged } from '../../shared/ipc/sessions'
import type { VendorId } from '../../shared/vendors/vendor'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry, rootPath, type RegistryRoot } from '../claude-home/registry'
import { emit } from '../ipc/index'
import { layoutStore } from '../layout/store'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { vendorDriver } from '../vendors/registry'
import { sharedRegistry } from './app-registry'
import { NodeSessions, signInRefusal, type KnownSessions } from './node-sessions'
import { SessionSettingsStore } from './session-settings'

let shared: NodeSessions | null = null

/**
 * The Vendors whose sign-in the first-run check already demands (spec decision 6: the first release
 * needs Claude Code): New session does not start a process of theirs only to ask it again.
 */
const SIGNED_IN_AT_FIRST_RUN: ReadonlySet<VendorId> = new Set(['claude'])

/**
 * Where the rule of Resume learns what each Vendor knows of a Project's Sessions. Claude Code: the
 * Claude home, its live processes and transcripts. Codex: its driver's history, the cwd of each thread;
 * which of them still runs in a terminal Codex does not tell (spec decision 9).
 */
function vendorSessions(claude: ClaudeHomeRegistry): Record<VendorId, (projectRoot: RegistryRoot) => Promise<KnownSessions>> {
  return {
    claude: (projectRoot) => claude.sessions(projectRoot),
    codex: async (projectRoot) => {
      const threads = await vendorDriver('codex').history.list(rootPath(projectRoot))
      return { live: [], history: threads.map((thread) => ({ sessionId: thread.id, ...(thread.cwd === null ? {} : { cwd: thread.cwd }) })) }
    },
  }
}

/** The app's Node Sessions, made on first use. */
export function sharedNodeSessions(): NodeSessions {
  if (shared === null) {
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    const known = vendorSessions(claude)
    shared = new NodeSessions({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      defaultVendor: (projectId) => readProjectSettings(projectStore().dataDir(projectStore().get(projectId).id)).defaultVendor,
      vendorRefusal: signInRefusal((vendor) => vendorDriver(vendor).account, { trusted: SIGNED_IN_AT_FIRST_RUN }),
      vendorSessions: (vendor, projectRoot) => known[vendor](projectRoot),
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
