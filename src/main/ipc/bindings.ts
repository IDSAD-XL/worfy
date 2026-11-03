// Handlers of the `bindings` domain (src/shared/ipc/bindings.ts): the manual Bindings of a Project
// (src/main/layout/bindings.ts) and the signals of Bindings in a Session's transcripts
// (src/main/claude-home/binding-signals.ts), or, for a Session of another Vendor, in its history
// (src/main/vendors/codex/binding.ts, worfy-multi-vendor ticket 41). A client (src/main/clients.ts) that asks for a
// Project's manual Bindings gets every later change of any Project's manual Bindings on
// `bindings.changed`, until it is destroyed.
import { resolve } from 'node:path'
import { EMPTY_AGENT_SIGNALS, type AgentSignals } from '../../shared/binding/resolve'
import { bindingsChanged, bindingsGet, bindingsRemove, bindingsSet, bindingsSignals } from '../../shared/ipc/bindings'
import { BindingSignalReader } from '../claude-home/binding-signals'
import { ClaudeHomeRegistry, gitWorktrees, type RegistryRoot } from '../claude-home/registry'
import { clientOf, type Client } from '../clients'
import { isRemoteCall, projectRootOf } from '../link/caller'
import { bindingStore, type BindingStore } from '../layout/bindings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { appCodexBindingSignals } from '../vendors/codex/binding'
import { appCodexSessions } from '../vendors/codex/sessions-on-canvas'
import { defineHandler, emit, type HandlerModule } from './index'

/** Finds a Session's transcript among a Project's folders; the app's registry, or a fake in tests. */
export type TranscriptFinder = Pick<ClaudeHomeRegistry, 'transcriptPath'>

/**
 * The Binding signals of the Sessions of a Vendor that keeps no Claude transcript: those of its
 * Session `sessionId` of the Project at `root`, or null when the Vendor has no such Session. The
 * Session's Vendor is the one whose history names it, so no Vendor is named here.
 */
export interface VendorBindingSignals {
  session(root: string, sessionId: string): Promise<AgentSignals | null>
}

/**
 * The handlers over a store, a transcript finder and a reader; tests pass their own. A call from a
 * Linked machine names the root of a Project of `projects` or one of its worktrees
 * (src/main/link/caller.ts).
 */
export function bindingsHandlers(
  store: () => BindingStore,
  transcripts: () => TranscriptFinder,
  reader = new BindingSignalReader(),
  projects: () => readonly { readonly path: string }[] = () => projectStore().list(),
  vendors: () => readonly VendorBindingSignals[] = () => [],
): HandlerModule {
  const subscribed = new WeakSet<Client>()
  const subscribe = (client: Client | undefined): void => {
    if (client === undefined || subscribed.has(client) || client.isDestroyed()) return
    subscribed.add(client)
    const unsubscribe = store().onChange((change) => {
      if (!client.isDestroyed()) emit(client, bindingsChanged, change)
    })
    client.once('destroyed', () => {
      unsubscribe()
      subscribed.delete(client)
    })
  }
  return [
    defineHandler(bindingsGet, ({ projectId }, { event }) => {
      subscribe(clientOf(event))
      return store().get(projectId)
    }),
    defineHandler(bindingsSet, ({ projectId, sessionId, agentId, target }) => store().set(projectId, { sessionId, agentId }, target)),
    defineHandler(bindingsRemove, ({ projectId, sessionId, agentId }) => store().remove(projectId, { sessionId, agentId })),
    defineHandler(bindingsSignals, async ({ projectRoot, sessionId }, { event }) => {
      const root = resolve(projectRoot)
      // A Claude home folder name stands for several paths: a Linked machine names a Project root
      // or one of its worktrees, not any folder inside (src/main/link/caller.ts, projectRootOf).
      // git runs at the real path the check answered, and the root is judged strictly; a window's
      // root is `local` (RegistryRoot), as in src/main/ipc/claude-home.ts.
      const at: RegistryRoot = isRemoteCall(event) ? { path: root, gitAt: await projectRootOf(event, root, projects, gitWorktrees, 'the Project root') } : { path: root, local: true }
      const path = await transcripts().transcriptPath(at, sessionId)
      if (path !== null) return { found: true, ...(await reader.session(path)) }
      // No Claude transcript: a Session of another Vendor, from its history (its Subagents are not read).
      for (const vendor of vendors()) {
        const session = await vendor.session(root, sessionId)
        if (session !== null) return { found: true, session, subagents: [] }
      }
      return { found: false, session: EMPTY_AGENT_SIGNALS, subagents: [] }
    }),
  ]
}

let registry: ClaudeHomeRegistry | undefined

const appRegistry = (): ClaudeHomeRegistry => (registry ??= new ClaudeHomeRegistry({ home: claudeHome() }))

/** The app's Vendors other than Claude Code: Codex, over the list of Codex Sessions the windows show. */
const appVendors = (): readonly VendorBindingSignals[] => [appCodexBindingSignals(appCodexSessions((root) => appRegistry().roots({ path: root, local: true })))]

export default bindingsHandlers(bindingStore, appRegistry, undefined, undefined, appVendors) satisfies HandlerModule
