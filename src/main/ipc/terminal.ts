// Handlers of the `terminal` domain (src/shared/ipc/terminal.ts): the shells of Terminal Nodes.
//
// A shell is started only for a Node of kind `terminal` that is in its Project's Layout, and
// always in the Project's root: the renderer names the Node, never a folder or a program. A shell
// ends when its Node is closed (terminal.close), when its Node leaves the Layout by any route,
// when the window that opened it is destroyed, and when the app quits; the quit waits until every
// shell has exited.
import { app, type WebContents } from 'electron'
import { agentEnv } from '../agent/env'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { TerminalRegistry, type TerminalSink } from '../terminal/pty'
import { TERMINAL_NODE_KIND, terminalClose, terminalExit, terminalInput, terminalOpen, terminalOutput, terminalResize } from '../../shared/ipc/terminal'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

/** One shell per Terminal Node of a Project. */
export function terminalKey(projectId: string, nodeId: string): string {
  return JSON.stringify([projectId, nodeId])
}

type Window = EventTarget & Partial<Pick<WebContents, 'isDestroyed'>> & { once(event: 'destroyed', listener: () => void): unknown }

/** Sends a terminal's output and exit to a window, as long as the window is alive. */
function windowSink(target: Window, projectId: string, nodeId: string): TerminalSink {
  const alive = () => target.isDestroyed?.() !== true
  return {
    output: (data, end) => {
      if (alive()) emit(target, terminalOutput, { projectId, nodeId, data, end })
    },
    exit: (exitCode, signal) => {
      if (alive()) emit(target, terminalExit, { projectId, nodeId, exitCode, signal })
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
  /** The window each terminal reports to: the one that opened it last. */
  const owners = new Map<string, Window>()
  const watched = new WeakSet<Window>()

  const own = (window: Window, key: string): void => {
    owners.set(key, window)
    if (watched.has(window)) return
    watched.add(window)
    window.once('destroyed', () => {
      const keys = [...owners].flatMap(([each, owner]) => (owner === window ? [each] : []))
      for (const each of keys) owners.delete(each)
      void deps
        .registry()
        .closeWhere((key) => keys.includes(key))
        .catch((error: unknown) => console.warn('[terminal] closing the terminals of a closed window failed', error))
    })
  }

  return [
    defineHandler(terminalOpen, async ({ projectId, nodeId, cols, rows }, { event }) => {
      const cwd = deps.projectRoot(projectId)
      if (!deps.isTerminalNode(projectId, nodeId)) throw new Error(`${nodeId} is not a Terminal Node of ${projectId}`)
      const key = terminalKey(projectId, nodeId)
      const window = event.sender as unknown as Window
      const result = await deps.registry().open(key, { cwd, cols, rows }, windowSink(window, projectId, nodeId))
      own(window, key)
      return result
    }),
    defineHandler(terminalInput, ({ projectId, nodeId, data }) => {
      deps.registry().write(terminalKey(projectId, nodeId), data)
    }),
    defineHandler(terminalResize, ({ projectId, nodeId, cols, rows }) => {
      deps.registry().resize(terminalKey(projectId, nodeId), cols, rows)
    }),
    defineHandler(terminalClose, async ({ projectId, nodeId }) => {
      await deps.registry().close(terminalKey(projectId, nodeId))
    }),
  ]
}

/** How long quitting waits for the shells beyond their own SIGKILL grace period. */
const QUIT_WAIT_MS = 3000

let appRegistry: TerminalRegistry | null = null

/** The app's registry, made on first use, wired to the Layout and to quitting. */
function sharedRegistry(): TerminalRegistry {
  if (appRegistry !== null) return appRegistry
  const registry = new TerminalRegistry({ env: async () => (await agentEnv()).env })

  // A Terminal Node removed from the Layout, by the Node's close button or any other route,
  // takes its shell with it.
  layoutStore().onChange(({ projectId, op }) => {
    if (op.op === 'remove') void registry.close(terminalKey(projectId, op.id))
  })

  // Quitting waits for the shells to exit, then quits again with nothing left to wait for.
  app.on('will-quit', (event) => {
    if (registry.size === 0) return
    event.preventDefault()
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_WAIT_MS))
    void Promise.race([registry.closeAll(), timeout]).finally(() => app.quit())
  })

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
