// Handlers of the `terminalAi.fix` domain (src/shared/ipc/terminal-ai-fix.ts): the "Fix" button in
// the header of a Terminal Node.
//
// The button is there while the last command of the Terminal failed and nothing started since, its
// line is known, its zsh is connected to Terminal AI and Fix is on in Settings (`available`). Which
// command failed comes from the events of the shell integration (FailedCommands of
// src/main/terminal-ai/fix.ts); they are listened to from the first call of any channel here, which
// the Node makes when it mounts, before its shell has run anything. A client that asks for the state
// of a Terminal gets every later change of it on `terminalAi.fix.changed` until the client is
// destroyed.
//
// `terminalAi.fix.run` asks the model through runFix(), which puts the corrected command into the line
// of the shell; it never runs. One Fix per Terminal: a new one, and the client going, cancel the one
// before. Neither the command, nor its output, nor the answer reach the log or an error.
import { clientOf, type Client } from '../clients'
import type { ShellEvent, ShellState } from '../terminal/osc'
import { appAssist, type AssistService } from '../terminal-ai/assist'
import { FailedCommands, runFix, type FixContext } from '../terminal-ai/fix'
import type { ShellLink } from '../terminal-ai/shell-link'
import { terminalAiFixChanged, terminalAiFixRun, terminalAiFixState, type TerminalAiFixState } from '../../shared/ipc/terminal-ai-fix'
import { featureEnabled } from '../../shared/terminal-ai/settings'
import { defineHandler, emit, type HandlerModule } from './index'
import { terminalKey, terminalNodeRegistry, terminalShellLink } from './terminal'

export interface TerminalAiFixDeps {
  /** The shells of the Terminal Nodes: their state and the events of the shell integration. */
  registry: () => { shellState(key: string): ShellState | null; onShellEvent(listener: (key: string, event: ShellEvent) => void): () => void }
  link: () => Pick<ShellLink, 'connected' | 'push' | 'onConnection'>
  assist: () => Promise<Pick<AssistService, 'state' | 'subscribe' | 'request'>>
}

/** The handlers over the shells and the assist service; tests pass their own. */
export function terminalAiFixHandlers(deps: TerminalAiFixDeps): HandlerModule {
  const failed = new FailedCommands()
  /** The clients that follow each Terminal, and the state they were sent last. */
  const followed = new Map<string, { projectId: string; nodeId: string; clients: Set<Client>; last: string }>()
  const watched = new WeakSet<Client>()
  /** The Fix in flight, by Terminal. */
  const inFlight = new Map<string, { abort: AbortController; client: Client | undefined }>()
  let shellsWired = false
  let assistWired: Promise<void> | null = null

  const stateOf = async (key: string): Promise<TerminalAiFixState> => {
    const assist = await deps.assist()
    const shell = deps.registry().shellState(key)
    return {
      available: failed.get(key) !== undefined && shell !== null && !shell.commandRunning && deps.link().connected(key) && featureEnabled(assist.state().settings, 'fix'),
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
      if (!client.isDestroyed()) emit(client, terminalAiFixChanged, { projectId: entry.projectId, nodeId: entry.nodeId, ...state })
    }
  }
  const refreshAll = (): void => {
    for (const key of followed.keys()) void refresh(key).catch(() => undefined)
  }

  /**
   * The sources of a change. The shells first and at once, so no failure of a shell is missed while
   * the assist service loads; the settings after it.
   */
  const wire = (): Promise<void> => {
    if (!shellsWired) {
      shellsWired = true
      deps.registry().onShellEvent((key, event) => {
        // A new command starts: the Fix of the one before has nothing to correct any more.
        if (event.type === 'command-started') inFlight.get(key)?.abort.abort()
        failed.event(key, event)
        // A command that starts or ends changes the button; a prompt alone does not.
        if (event.type !== 'prompt') void refresh(key).catch(() => undefined)
      })
      deps.link().onConnection((key, connected) => {
        if (!connected) {
          failed.forget(key)
          inFlight.get(key)?.abort.abort()
        }
        void refresh(key).catch(() => undefined)
      })
    }
    assistWired ??= (async () => {
      const assist = await deps.assist()
      assist.subscribe(refreshAll)
    })()
    return assistWired
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
    defineHandler(terminalAiFixState, async ({ projectId, nodeId }, { event }) => {
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
    defineHandler(terminalAiFixRun, async ({ projectId, nodeId }, { event }) => {
      await wire()
      const key = terminalKey(projectId, nodeId)
      const link = deps.link()
      const client = clientOf(event)
      const abort = new AbortController()
      inFlight.get(key)?.abort.abort()
      inFlight.set(key, { abort, client })
      if (client !== undefined) watch(client)
      try {
        if (!link.connected(key)) return { ok: false, message: 'The shell is not connected to Terminal AI' }
        const context: FixContext = {
          shellState: (terminal) => deps.registry().shellState(terminal),
          assist: deps.assist,
          push: (terminal, message) => link.push(terminal, message),
          failed,
        }
        const result = await runFix(context, key, abort.signal)
        // The answer is in the line: the button goes on every screen until the next failure.
        if (result.ok) await refresh(key)
        return result
      } finally {
        if (inFlight.get(key)?.abort === abort) inFlight.delete(key)
      }
    }),
  ]
}

export default terminalAiFixHandlers({ registry: terminalNodeRegistry, link: terminalShellLink, assist: appAssist }) satisfies HandlerModule
