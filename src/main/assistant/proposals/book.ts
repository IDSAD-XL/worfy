// The open proposals of the Assistant in main (worfy-assistant ticket 09): the Assistant creates, updates and removes them
// through `worfy-app`; the window reads them and is told of each change (ticket 14).
//
// shortcut: kept in memory only, so a restart of worfy forgets them; the Assistant's state file keeps its open
// proposals (ADR-0114, point 2), and ticket 10, which writes it, gives them back here at the start of its Session.
import { randomUUID } from 'node:crypto'
import type { AssistantProposal, PreparedSession } from '../../../shared/assistant/proposals'
import { appNow } from '../../clock'

export interface ProposalBookOptions {
  now: () => number
  /** A new proposal's id; a random UUID by default. */
  id?: () => string
}

export interface ProposalDraft {
  title: string
  why: string
  item: string | null
  prepare: PreparedSession | null
}

export type ProposalChange = Partial<ProposalDraft>

export type ProposalListener = (proposals: readonly AssistantProposal[]) => void

export class ProposalBook {
  private readonly proposals = new Map<string, AssistantProposal>()
  private readonly listeners = new Set<ProposalListener>()

  constructor(private readonly options: ProposalBookOptions) {}

  /** Every open proposal, oldest first. */
  list(): AssistantProposal[] {
    return [...this.proposals.values()].map((each) => ({ ...each }))
  }

  /** Told of every change, with the whole list; answers the function that stops it. */
  subscribe(listener: ProposalListener): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  create(draft: ProposalDraft): AssistantProposal {
    const at = this.options.now()
    const proposal: AssistantProposal = { id: (this.options.id ?? randomUUID)(), ...draft, createdAt: at, updatedAt: at }
    this.proposals.set(proposal.id, proposal)
    this.changed()
    return { ...proposal }
  }

  /** Throws for an unknown id, and changes nothing. */
  update(id: string, change: ProposalChange): AssistantProposal {
    const before = this.get(id)
    const next: AssistantProposal = { ...before, ...Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)), updatedAt: this.options.now() }
    this.proposals.set(id, next)
    this.changed()
    return { ...next }
  }

  /** Throws for an unknown id. */
  remove(id: string): void {
    this.get(id)
    this.proposals.delete(id)
    this.changed()
  }

  private get(id: string): AssistantProposal {
    const found = this.proposals.get(id)
    if (found === undefined) throw new Error(`No open proposal ${id}`)
    return found
  }

  private changed(): void {
    const list = this.list()
    for (const listener of this.listeners) listener(list)
  }
}

let shared: ProposalBook | undefined

/** The proposals of the running app: `worfy-app` writes them, the window reads them (ticket 14). */
export function appProposals(): ProposalBook {
  shared ??= new ProposalBook({ now: appNow })
  return shared
}
