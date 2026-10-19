// Handlers of the `bindings` domain (src/shared/ipc/bindings.ts): the manual Bindings of a Project
// (src/main/layout/bindings.ts) and the signals of Bindings in a Session's transcripts
// (src/main/claude-home/binding-signals.ts). A client (src/main/clients.ts) that asks for a
// Project's manual Bindings gets every later change of any Project's manual Bindings on
// `bindings.changed`, until it is destroyed.
import { resolve } from 'node:path'
import { EMPTY_AGENT_SIGNALS } from '../../shared/binding/resolve'
import { bindingsChanged, bindingsGet, bindingsRemove, bindingsSet, bindingsSignals } from '../../shared/ipc/bindings'
import { BindingSignalReader } from '../claude-home/binding-signals'
import { ClaudeHomeRegistry, gitWorktrees, type RegistryRoot } from '../claude-home/registry'
import { clientOf, type Client } from '../clients'
import { isRemoteCall, projectRootOf } from '../link/caller'
import { bindingStore, type BindingStore } from '../layout/bindings'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

/** Finds a Session's transcript among a Project's folders; the app's registry, or a fake in tests. */
export type TranscriptFinder = Pick<ClaudeHomeRegistry, 'transcriptPath'>

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
      if (path === null) return { found: false, session: EMPTY_AGENT_SIGNALS, subagents: [] }
      return { found: true, ...(await reader.session(path)) }
    }),
  ]
}

let registry: ClaudeHomeRegistry | undefined

export default bindingsHandlers(bindingStore, () => (registry ??= new ClaudeHomeRegistry({ home: claudeHome() }))) satisfies HandlerModule
