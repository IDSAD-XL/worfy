// The manual Bindings of each Project (ticket 16): which Ticket or Epic the user bound an agent to
// by dropping its Node there. Kept in `<Project data folder>/bindings.json` (ADR 0005), worfy's own
// state: never in the Project's repository, never in ~/.claude. main is the only writer, as for the
// Layout (ADR 0003); the renderer asks through src/main/ipc/bindings.ts.
//
// A manual Binding overrides every automatic one (src/shared/binding/resolve.ts); removing it lets
// the automatic Binding apply again. One Binding per agent: binding it again replaces the old one.
//
// The rest of a Binding — the signals of the agent's work — is not stored: it is read from the
// transcripts each time (ADR 0002). A later ticket (23) adds what its actions need here.
import { join } from 'node:path'
import { z } from 'zod'
import { sameTarget, type BindingTarget } from '../../shared/binding/resolve'
import { manualBindingSchema, type BindingAgent, type ManualBinding, type ManualBindings } from '../../shared/ipc/bindings'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

export const BINDINGS_FILE = 'bindings.json'

export const bindingsFileSchema = z.object({ bindings: z.array(manualBindingSchema) })
export type BindingsFile = z.infer<typeof bindingsFileSchema>

const sameAgent = (a: BindingAgent, b: BindingAgent): boolean => a.sessionId === b.sessionId && (a.agentId ?? null) === (b.agentId ?? null)

export class BindingStore {
  private readonly loaded = new Map<string, ManualBinding[]>()
  private readonly listeners = new Set<(change: ManualBindings) => void>()

  /** `dirOf` gives a Project's data folder and throws for a Project that is not in the list. Does no I/O. */
  constructor(private readonly dirOf: (projectId: string) => string) {}

  file(projectId: string): string {
    return join(this.dirOf(projectId), BINDINGS_FILE)
  }

  private bindings(projectId: string): ManualBinding[] {
    // Asked every time, so a Project removed from the list is refused even when it is in memory.
    const file = this.file(projectId)
    let bindings = this.loaded.get(projectId)
    if (bindings === undefined) {
      bindings = readJsonFile(file, bindingsFileSchema)?.bindings ?? []
      this.loaded.set(projectId, bindings)
    }
    return bindings
  }

  get(projectId: string): ManualBindings {
    return { projectId, bindings: this.bindings(projectId) }
  }

  /** Binds `agent` to `target` by hand, replacing its manual Binding; writes the file at once. */
  set(projectId: string, agent: BindingAgent, target: BindingTarget): ManualBindings {
    const current = this.bindings(projectId)
    const before = current.find((binding) => sameAgent(binding, agent))
    if (before && sameTarget(before.target, target)) return this.get(projectId)
    const next = [...current.filter((binding) => !sameAgent(binding, agent)), { sessionId: agent.sessionId, agentId: agent.agentId ?? null, target }]
    return this.commit(projectId, next)
  }

  /** Removes `agent`'s manual Binding; nothing is written when it had none. */
  remove(projectId: string, agent: BindingAgent): ManualBindings {
    const current = this.bindings(projectId)
    if (!current.some((binding) => sameAgent(binding, agent))) return this.get(projectId)
    return this.commit(
      projectId,
      current.filter((binding) => !sameAgent(binding, agent)),
    )
  }

  /** Called after every change, whoever made it. Returns the function that unsubscribes. */
  onChange(listener: (change: ManualBindings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(projectId: string, bindings: ManualBinding[]): ManualBindings {
    // Written before it is kept: a failed write changes nothing and reaches the caller.
    writeJsonFile(this.file(projectId), bindingsFileSchema, { bindings })
    this.loaded.set(projectId, bindings)
    const change = this.get(projectId)
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch (error) {
        console.error('[bindings] a change listener threw', error)
      }
    }
    return change
  }
}

let shared: BindingStore | undefined

/** The store of the running app, over the Projects' data folders. Creating it does no I/O. */
export function bindingStore(): BindingStore {
  shared ??= new BindingStore((projectId) => {
    const projects = projectStore()
    return projects.dataDir(projects.get(projectId).id)
  })
  return shared
}
