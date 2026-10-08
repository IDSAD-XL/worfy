// Handlers of the `bindings` domain (src/shared/ipc/bindings.ts): the manual Bindings of a Project
// (src/main/layout/bindings.ts) and the signals of Bindings in a Session's transcripts
// (src/main/claude-home/binding-signals.ts). A client (src/main/clients.ts) that asks for a
// Project's manual Bindings gets every later change of any Project's manual Bindings on
// `bindings.changed`, until it is destroyed.
import { resolve } from 'node:path'
import { EMPTY_AGENT_SIGNALS } from '../../shared/binding/resolve'
import { bindingsChanged, bindingsGet, bindingsRemove, bindingsSet, bindingsSignals } from '../../shared/ipc/bindings'
import { BindingSignalReader } from '../claude-home/binding-signals'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { clientOf, type Client } from '../clients'
import { bindingStore, type BindingStore } from '../layout/bindings'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

/** Finds a Session's transcript among a Project's folders; the app's registry, or a fake in tests. */
export type TranscriptFinder = Pick<ClaudeHomeRegistry, 'transcriptPath'>

/** The handlers over a store, a transcript finder and a reader; tests pass their own. */
export function bindingsHandlers(store: () => BindingStore, transcripts: () => TranscriptFinder, reader = new BindingSignalReader()): HandlerModule {
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
    defineHandler(bindingsSignals, async ({ projectRoot, sessionId }) => {
      const path = await transcripts().transcriptPath(resolve(projectRoot), sessionId)
      if (path === null) return { found: false, session: EMPTY_AGENT_SIGNALS, subagents: [] }
      return { found: true, ...(await reader.session(path)) }
    }),
  ]
}

let registry: ClaudeHomeRegistry | undefined

export default bindingsHandlers(bindingStore, () => (registry ??= new ClaudeHomeRegistry({ home: claudeHome() }))) satisfies HandlerModule
