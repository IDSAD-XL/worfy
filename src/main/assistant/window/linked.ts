// What waits on the Linked machine, as this Machine's Assistant reads it (worfy-assistant ticket 18; spec, two machines;
// boundary 5; ADR-0066). Each Machine has its own Assistant over its own Projects; this one only reads the other's, over
// the `project` channel `assistant.waiting`, marked `read`, so a Linked machine that shares its Projects read-only answers
// too. The Linked machine checks access on its side (src/main/link/ipc-adapter.ts); nothing here goes around it.
//
// - One call per Linked machine that is online; a Machine offline is not called. Its answer is held to the channel's
//   schema again (RemoteCalls parses it already in the app; a stand-in in a test does not), and an answer outside it
//   carries nothing.
// - A refusal (access off, an older build that has no such channel, no answer in time) is the Machine's problem, in its
//   words, shown in the section and answered to the Assistant. Nothing rejects.
// - The section reads the last answers (snapshot); the reads of `worfy-app` read afresh (refresh). A read that ends after
//   a newer one is dropped. Listeners hear of a change only.
import { linkedWaitsSchema, type LinkedMachineWaits } from '../../../shared/assistant/linked'
import type { IpcResult } from '../../../shared/ipc/channels'

export interface LinkedWaitsDeps {
  /** The Linked machines and whether a connection to each is open now. */
  machines(): readonly { id: string; name: string; online: boolean }[]
  /** Calls `assistant.waiting` on Linked machine `machine`; resolves with its IpcResult. */
  call(machine: string): Promise<IpcResult<unknown>>
}

const empty = (machine: { id: string; name: string; online: boolean }, problem: string): LinkedMachineWaits => ({ id: machine.id, name: machine.name, online: machine.online, projects: [], items: [], problem })

export class LinkedWaits {
  private last: LinkedMachineWaits[] = []
  private reads = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: LinkedWaitsDeps) {}

  /** What each Linked machine answered on the last read; empty before the first one. */
  snapshot(): readonly LinkedMachineWaits[] {
    return this.last
  }

  /** Told after a read that changed what the Linked machines answered; answers the function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Reads every Linked machine afresh; never rejects. */
  async refresh(): Promise<readonly LinkedMachineWaits[]> {
    const read = ++this.reads
    const next = await Promise.all(this.deps.machines().map((machine) => this.readOne(machine)))
    // A newer read started meanwhile: its answer stands, whichever ends first.
    if (read !== this.reads) return next
    const changed = JSON.stringify(next) !== JSON.stringify(this.last)
    this.last = next
    if (changed) for (const listener of [...this.listeners]) listener()
    return next
  }

  private async readOne(machine: { id: string; name: string; online: boolean }): Promise<LinkedMachineWaits> {
    if (!machine.online) return empty(machine, `${machine.name} is offline`)
    let result: IpcResult<unknown>
    try {
      result = await this.deps.call(machine.id)
    } catch (error) {
      return empty(machine, error instanceof Error ? error.message : String(error))
    }
    if (!result.ok) return empty(machine, result.error)
    const parsed = linkedWaitsSchema.safeParse(result.value)
    if (!parsed.success) return empty(machine, `${machine.name} answered outside the contract`)
    return { id: machine.id, name: machine.name, online: true, projects: parsed.data.projects, items: parsed.data.items, problem: null }
  }
}
