// Handlers of the `terminalAi.request` domain (src/shared/ipc/terminal-ai-request.ts): the ⌘I panel
// of Command request over a Terminal Node.
//
// The panel is there only for a Terminal whose zsh is connected to Terminal AI, while Command request
// is on in Settings (`available`); `busy` while a command runs in it. A client that asks for the
// state of a Terminal gets every later change of it on `terminalAi.request.changed` until the client
// is destroyed: the shell connects or leaves (ShellLink.onConnection), a command starts or ends
// (the events of the shell integration), the settings change.
//
// A request goes to the assist service as the line `# …` does (requestCommand of
// src/main/terminal-ai/features/command-request.ts), and the command of the answer goes to the
// shell as `insert`: it lands in the line and never runs. One request per Terminal: a new one, the
// panel closing (`terminalAi.request.cancel`) and the client going cancel the one before. Neither the
// words, nor the line, nor the answer reach the log or an error.
import { clientOf, type Client } from '../clients'
import type { ShellEvent, ShellState } from '../terminal/osc'
import { appAssist, type AssistService } from '../terminal-ai/assist'
import { NOT_READY, refusalText, requestCommand } from '../terminal-ai/features/command-request'
import type { ShellLink } from '../terminal-ai/shell-link'
import { terminalAiRequest, terminalAiRequestCancel, terminalAiRequestChanged, terminalAiRequestState, type TerminalAiRequestState } from '../../shared/ipc/terminal-ai-request'
import { featureEnabled } from '../../shared/terminal-ai/settings'
import { defineHandler, emit, type HandlerModule } from './index'
import { terminalKey, terminalNodeRegistry, terminalShellLink } from './terminal'

export interface TerminalAiRequestDeps {
  /** The shells of the Terminal Nodes: their state and the events of the shell integration. */
  registry: () => { shellState(key: string): ShellState | null; onShellEvent(listener: (key: string, event: ShellEvent) => void): () => void }
  link: () => Pick<ShellLink, 'connected' | 'push' | 'onConnection'>
  assist: () => Promise<Pick<AssistService, 'state' | 'subscribe' | 'request'>>
}

/** The message of a request to a Terminal without a zsh connected to Terminal AI. */
export const NOT_CONNECTED = 'the Terminal has no zsh connected to Terminal AI'

/** The handlers over the shells and the assist service; tests pass their own. */
export function terminalAiRequestHandlers(deps: TerminalAiRequestDeps): HandlerModule {
  /** The clients that follow each Terminal, and the state they were sent last. */
  const followed = new Map<string, { projectId: string; nodeId: string; clients: Set<Client>; last: string }>()
  const watched = new WeakSet<Client>()
  /** The request of the panel in flight, by Terminal. */
  const inFlight = new Map<string, { abort: AbortController; client: Client | undefined }>()
  let wired: Promise<void> | null = null

  const stateOf = async (key: string): Promise<TerminalAiRequestState> => {
    const assist = await deps.assist()
    return {
      available: deps.link().connected(key) && featureEnabled(assist.state().settings, 'request'),
      busy: deps.registry().shellState(key)?.commandRunning ?? false,
    }
  }

  /** Sends the state of `key` to the clients that follow it, when it differs from the one sent last. */
  const refresh = async (key: string): Promise<void> => {
    const entry = followed.get(key)
    if (entry === undefined) return
    const state = await stateOf(key)
    const text = JSON.stringify(state)
    if (text === entry.last) return
    entry.last = text
    for (const client of entry.clients) {
      if (!client.isDestroyed()) emit(client, terminalAiRequestChanged, { projectId: entry.projectId, nodeId: entry.nodeId, ...state })
    }
  }
  const refreshAll = (): void => {
    for (const key of followed.keys()) void refresh(key).catch(() => undefined)
  }

  /** The sources of a change, listened to from the first call on. */
  const wire = (): Promise<void> => {
    wired ??= (async () => {
      const assist = await deps.assist()
      deps.link().onConnection((key) => void refresh(key).catch(() => undefined))
      deps.registry().onShellEvent((key) => void refresh(key).catch(() => undefined))
      assist.subscribe(refreshAll)
    })()
    return wired
  }

  const leave = (client: Client): void => {
    for (const [key, entry] of followed) {
      entry.clients.delete(client)
      if (entry.clients.size === 0) followed.delete(key)
    }
    for (const request of inFlight.values()) if (request.client === client) request.abort.abort()
  }
  const watch = (client: Client): void => {
    if (watched.has(client)) return
    watched.add(client)
    client.once('destroyed', () => leave(client))
  }

  return [
    defineHandler(terminalAiRequestState, async ({ projectId, nodeId }, { event }) => {
      await wire()
      const key = terminalKey(projectId, nodeId)
      // The clients that follow the Terminal already hear of a change before this one is told the state.
      await refresh(key)
      const state = await stateOf(key)
      const client = clientOf(event)
      if (client !== undefined && !client.isDestroyed()) {
        watch(client)
        const entry = followed.get(key) ?? { projectId, nodeId, clients: new Set<Client>(), last: '' }
        entry.clients.add(client)
        entry.last = JSON.stringify(state)
        followed.set(key, entry)
      }
      return state
    }),
    defineHandler(terminalAiRequest, async ({ projectId, nodeId, text }, { event }) => {
      const key = terminalKey(projectId, nodeId)
      const link = deps.link()
      // Only the name of the problem: the words stay out of the error and of the log.
      if (!link.connected(key)) throw new Error(NOT_CONNECTED)
      const client = clientOf(event)
      const abort = new AbortController()
      inFlight.get(key)?.abort.abort()
      inFlight.set(key, { abort, client })
      if (client !== undefined) watch(client)
      try {
        const answer = await requestCommand({ shellState: (terminal) => deps.registry().shellState(terminal), assist: deps.assist }, key, text, abort.signal)
        if (answer === null) return { ok: false, message: NOT_READY }
        if (!answer.ok) return { ok: false, message: refusalText(answer) ?? 'Cancelled' }
        if (abort.signal.aborted) return { ok: false, message: 'Cancelled' }
        // The command lands in the line; Enter stays the user's.
        if (!link.push(key, { type: 'insert', text: answer.command })) return { ok: false, message: 'The shell is gone' }
        return { ok: true }
      } finally {
        if (inFlight.get(key)?.abort === abort) inFlight.delete(key)
      }
    }),
    defineHandler(terminalAiRequestCancel, ({ projectId, nodeId }) => {
      inFlight.get(terminalKey(projectId, nodeId))?.abort.abort()
    }),
  ]
}

export default terminalAiRequestHandlers({ registry: terminalNodeRegistry, link: terminalShellLink, assist: appAssist }) satisfies HandlerModule
