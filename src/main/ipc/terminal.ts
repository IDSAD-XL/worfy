// Handlers of the `terminal` domain (src/shared/ipc/terminal.ts): the shells of Terminal Nodes.
//
// A shell is started only for a Node of kind `terminal` that is in its Project's Layout, and
// always in the Project's root: the renderer names the Node, never a folder or a program (a command
// to type comes only from the fixed list of src/shared/ipc/terminal.ts, TERMINAL_COMMANDS). A shell
// ends when its Node is closed (terminal.close), when its Node leaves the Layout by any route,
// when its Project leaves the list, when the last client that opened it is destroyed, and when the
// app quits; the quit waits until every shell has exited.
//
// Every client that opened a shell (a window, or later a Linked machine's connection; the clients
// of src/main/clients.ts) gets its output, its exit and the start of a new shell. Which client's
// size the pty has is decided in the registry (src/main/terminal/pty.ts): the one that typed or
// clicked last (worfy-link ticket 05, ADR-0053).
import { app } from 'electron'
import { agentEnv } from '../agent/env'
import { clientOf, type Client } from '../clients'
import { layoutStore, type LayoutChange } from '../layout/store'
import { projectStore } from '../projects/store'
import { TerminalRegistry, type TerminalSink } from '../terminal/pty'
import {
  TERMINAL_NODE_KIND,
  terminalClose,
  terminalExit,
  terminalInput,
  terminalOpen,
  terminalOutput,
  terminalResize,
  terminalStarted,
  terminalTakeSize,
} from '../../shared/ipc/terminal'
import { defineHandler, emit, type HandlerModule } from './index'

/** One shell per Terminal Node of a Project. */
export function terminalKey(projectId: string, nodeId: string): string {
  return JSON.stringify([projectId, nodeId])
}

/** Sends a terminal's output, exit and new start to a client, as long as the client is alive. */
function clientSink(client: Client, projectId: string, nodeId: string): TerminalSink {
  const alive = () => !client.isDestroyed()
  return {
    output: (data, end) => {
      if (alive()) emit(client, terminalOutput, { projectId, nodeId, data, end })
    },
    exit: (exitCode, signal) => {
      if (alive()) emit(client, terminalExit, { projectId, nodeId, exitCode, signal })
    },
    started: (pid) => {
      if (alive()) emit(client, terminalStarted, { projectId, nodeId, pid })
    },
  }
}

export interface TerminalDeps {
  registry: () => TerminalRegistry
  /** The Project's root folder; throws for a Project that is not in the list. */
  projectRoot: (projectId: string) => string
  /** True when the Project's Layout has a Node of kind `terminal` with this id. */
  isTerminalNode: (projectId: string, nodeId: string) => boolean
}

/** The handlers over a registry; tests pass their own registry, Projects and Layout. */
export function terminalHandlers(deps: TerminalDeps): HandlerModule {
  const watched = new WeakSet<Client>()
  const leave = (client: Client): void =>
    void deps
      .registry()
      .leave(client)
      .catch((error: unknown) => console.warn('[terminal] closing the terminals of a closed client failed', error))
  /** A client leaves every terminal it opened when it is destroyed; one listener per client. */
  const watch = (client: Client): void => {
    if (watched.has(client)) return
    watched.add(client)
    client.once('destroyed', () => leave(client))
  }

  return [
    defineHandler(terminalOpen, async ({ projectId, nodeId, cols, rows, restart, command }, { event }) => {
      const client = clientOf(event)
      if (client === undefined) throw new Error('terminal.open needs the client that calls it')
      // A destroyed client would never leave: its `destroyed` has already come.
      if (client.isDestroyed()) throw new Error('the client is gone')
      const cwd = deps.projectRoot(projectId)
      if (!deps.isTerminalNode(projectId, nodeId)) throw new Error(`${nodeId} is not a Terminal Node of ${projectId}`)
      watch(client)
      const result = await deps.registry().open(terminalKey(projectId, nodeId), { cwd, cols, rows, restart, command }, client, clientSink(client, projectId, nodeId))
      // Destroyed while the shell was starting: its `destroyed` may have come before it subscribed.
      if (client.isDestroyed()) leave(client)
      return result
    }),
    defineHandler(terminalInput, ({ projectId, nodeId, data }, { event }) => {
      deps.registry().write(terminalKey(projectId, nodeId), data, clientOf(event))
    }),
    defineHandler(terminalResize, ({ projectId, nodeId, cols, rows }, { event }) => {
      deps.registry().resize(terminalKey(projectId, nodeId), cols, rows, clientOf(event))
    }),
    defineHandler(terminalTakeSize, ({ projectId, nodeId, cols, rows }, { event }) => {
      deps.registry().takeSize(terminalKey(projectId, nodeId), cols, rows, clientOf(event))
    }),
    defineHandler(terminalClose, async ({ projectId, nodeId }) => {
      await deps.registry().close(terminalKey(projectId, nodeId))
    }),
  ]
}

/** Ends the shell of a Terminal Node that left the Layout, whoever removed it. */
export function closeRemovedNode(registry: TerminalRegistry, change: Pick<LayoutChange, 'projectId' | 'op'>): Promise<void> {
  return change.op.op === 'remove' ? registry.close(terminalKey(change.projectId, change.op.id)) : Promise.resolve()
}

/** Ends the shells of Projects no longer in the list. */
export function closeRemovedProjects(registry: TerminalRegistry, projectIds: ReadonlySet<string>): Promise<void> {
  return registry.closeWhere((key) => {
    const [projectId] = JSON.parse(key) as [string, string]
    return !projectIds.has(projectId)
  })
}

/** How long quitting waits for the shells beyond their own SIGKILL grace period. */
export const QUIT_WAIT_MS = 3000

/** What the registry is wired to: the Layout, the list of Projects and the app quitting. */
export interface RegistryWiring {
  layout: { onChange(listener: (change: Pick<LayoutChange, 'projectId' | 'op'>) => void): unknown }
  projects: { onChange(listener: () => void): unknown; list(): readonly { id: string }[] }
  app: { on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown; quit(): void }
  quitWaitMs?: number
}

/**
 * Ends the shells when what owns them goes: their Node leaving the Layout, their Project leaving
 * the list, the app quitting. Quitting waits for the shells to exit (at most `quitWaitMs`), then
 * quits again with nothing left to wait for.
 */
export function wireRegistry(registry: TerminalRegistry, wiring: RegistryWiring): void {
  const warn = (what: string) => (error: unknown) => console.warn(`[terminal] ${what} failed`, error)
  // A Terminal Node removed from the Layout, by the Node's close button or any other route,
  // takes its shell with it.
  wiring.layout.onChange((change) => void closeRemovedNode(registry, change).catch(warn('closing the shell of a removed Node')))
  // A Project removed from the list takes its shells with it.
  wiring.projects.onChange(
    () => void closeRemovedProjects(registry, new Set(wiring.projects.list().map((project) => project.id))).catch(warn('closing the shells of a removed Project')),
  )
  wiring.app.on('will-quit', (event) => {
    if (registry.size === 0) return
    event.preventDefault()
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, wiring.quitWaitMs ?? QUIT_WAIT_MS))
    void Promise.race([registry.closeAll(), timeout]).finally(() => wiring.app.quit())
  })
}

let appRegistry: TerminalRegistry | null = null

/** The app's registry, made on first use, wired to the Layout, the Projects and quitting. */
function sharedRegistry(): TerminalRegistry {
  if (appRegistry !== null) return appRegistry
  const registry = new TerminalRegistry({ env: async () => (await agentEnv()).env })
  wireRegistry(registry, { layout: layoutStore(), projects: projectStore(), app })
  appRegistry = registry
  return registry
}

export default terminalHandlers({
  registry: sharedRegistry,
  projectRoot: (projectId) => projectStore().get(projectId).path,
  isTerminalNode: (projectId, nodeId) =>
    layoutStore()
      .get(projectId)
      .layout.nodes.some((node) => node.id === nodeId && node.kind === TERMINAL_NODE_KIND),
}) satisfies HandlerModule
