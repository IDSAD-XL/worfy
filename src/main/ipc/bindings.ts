// Handlers of the `bindings` domain (src/shared/ipc/bindings.ts): the manual Bindings of a Project
// (src/main/layout/bindings.ts) and the signals of Bindings in a Session's transcripts
// (src/main/claude-home/binding-signals.ts). A window that asks for a Project's manual Bindings
// gets every later change of any Project's manual Bindings on `bindings.changed`, until it is
// destroyed.
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import { EMPTY_AGENT_SIGNALS } from '../../shared/binding/resolve'
import { bindingsChanged, bindingsGet, bindingsRemove, bindingsSet, bindingsSignals } from '../../shared/ipc/bindings'
import { BindingSignalReader } from '../claude-home/binding-signals'
import { ClaudeHomeRegistry } from '../claude-home/registry'
import { bindingStore, type BindingStore } from '../layout/bindings'
import { claudeHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

/** The window as far as sending it changes needs. */
export type BindingsWindow = Pick<WebContents, 'send' | 'isDestroyed' | 'once'>

/** Finds a Session's transcript among a Project's folders; the app's registry, or a fake in tests. */
export type TranscriptFinder = Pick<ClaudeHomeRegistry, 'transcriptPath'>

/** The handlers over a store, a transcript finder and a reader; tests pass their own. */
export function bindingsHandlers(store: () => BindingStore, transcripts: () => TranscriptFinder, reader = new BindingSignalReader()): HandlerModule {
  const subscribed = new WeakSet<BindingsWindow>()
  const subscribe = (window: BindingsWindow | undefined): void => {
    if (window === undefined || subscribed.has(window) || window.isDestroyed()) return
    subscribed.add(window)
    const unsubscribe = store().onChange((change) => {
      if (!window.isDestroyed()) emit(window, bindingsChanged, change)
    })
    window.once('destroyed', () => {
      unsubscribe()
      subscribed.delete(window)
    })
  }
  return [
    defineHandler(bindingsGet, ({ projectId }, { event }) => {
      subscribe(event.sender as BindingsWindow | undefined)
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
