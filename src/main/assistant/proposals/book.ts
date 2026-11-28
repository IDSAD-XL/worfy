// The open proposals of the Assistant in main (worfy-assistant tickets 09 and 10): the Assistant creates, updates and
// removes them through `worfy-app`; the window reads them and is told of each change (ticket 14).
//
// They live in the Assistant's memory file (ADR-0114, point 2; src/main/assistant/duties/memory.ts, its part
// `proposals`), so a restart of worfy keeps them and each new Session of the Assistant reads them there. The book reads
// the file once, at its first use, and writes it before it takes a change: a change the file refuses throws and changes
// nothing.
//
// A proposal the Assistant closed with a why (worfy-polish 172) stays in the book, marked `closed`, for
// PROPOSAL_CLOSED_KEEP_DAYS: it is not open any more, so list() and every reader of open proposals leave it out, and the
// next change after those days drops it from the file.
import { randomUUID } from 'node:crypto'
import { PROPOSAL_CLOSED_KEEP_DAYS, type AssistantProposal, type PreparedSession } from '../../../shared/assistant/proposals'
import type { SettingsChange } from '../../../shared/assistant/settings-change'
import { appNow } from '../../clock'
import { dataRoot } from '../../storage/paths'
import { assistantMemoryPath, sessionMemoryStore } from '../duties/memory'

/** Where the book keeps its proposals; absent: in memory only. */
export interface ProposalStore {
  read(): AssistantProposal[]
  /** Throws when it cannot write. */
  write(proposals: readonly AssistantProposal[]): void
}

export interface ProposalBookOptions {
  now: () => number
  /** A new proposal's id; a random UUID by default. */
  id?: () => string
  store?: ProposalStore
}

export interface ProposalDraft {
  title: string
  why: string
  item: string | null
  prepare: PreparedSession | null
  /** A change of the Assistant's settings for the card «before → after» (ticket 15); absent: none. */
  change?: SettingsChange | null
}

/** What may change of a proposal; `applied` only by the user's Apply and Undo (AssistantWindow), never by `worfy-app`. */
export type ProposalChange = Partial<ProposalDraft> & { applied?: AssistantProposal['applied'] }

export type ProposalListener = (proposals: readonly AssistantProposal[]) => void

const DAY_MS = 24 * 60 * 60_000
const isOpen = (proposal: AssistantProposal): boolean => proposal.closed == null

export class ProposalBook {
  private proposals: Map<string, AssistantProposal> | null = null
  private readonly listeners = new Set<ProposalListener>()

  constructor(private readonly options: ProposalBookOptions) {}

  /** Every open proposal, oldest first. */
  list(): AssistantProposal[] {
    return [...this.kept().values()].filter(isOpen).map((each) => ({ ...each }))
  }

  /** The proposals the Assistant closed with a why in the last PROPOSAL_CLOSED_KEEP_DAYS, oldest first. */
  closed(): AssistantProposal[] {
    return [...this.kept().values()].filter((each) => !isOpen(each)).map((each) => ({ ...each }))
  }

  /** Told of every change, with the whole list; answers the function that stops it. */
  subscribe(listener: ProposalListener): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  create(draft: ProposalDraft): AssistantProposal {
    const at = this.options.now()
    const proposal: AssistantProposal = { id: (this.options.id ?? randomUUID)(), ...draft, createdAt: at, updatedAt: at }
    this.commit(new Map([...this.kept(), [proposal.id, proposal]]))
    return { ...proposal }
  }

  /** Throws for an unknown id, and changes nothing. */
  update(id: string, change: ProposalChange): AssistantProposal {
    const before = this.get(id)
    const next: AssistantProposal = { ...before, ...Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined)), updatedAt: this.options.now() }
    this.commit(new Map([...this.kept(), [id, next]]))
    return { ...next }
  }

  /**
   * Removes an open proposal; with `closed` (the Assistant read that it is done, worfy-polish 172) it is kept closed
   * instead, with when and why. Throws for an id of no open proposal.
   */
  remove(id: string, closed?: { by: 'assistant'; why: string }): void {
    const before = this.get(id)
    const next = new Map(this.kept())
    if (closed === undefined) next.delete(id)
    else next.set(id, { ...before, closed: { at: this.options.now(), by: closed.by, why: closed.why } })
    this.commit(next)
  }

  private kept(): Map<string, AssistantProposal> {
    this.proposals ??= new Map((this.options.store?.read() ?? []).map((proposal) => [proposal.id, proposal]))
    return this.proposals
  }

  private get(id: string): AssistantProposal {
    const found = this.kept().get(id)
    if (found === undefined || !isOpen(found)) throw new Error(`No open proposal ${id}`)
    return found
  }

  /** Writes `next` first, then takes it and tells the listeners. */
  private commit(next: Map<string, AssistantProposal>): void {
    const oldest = this.options.now() - PROPOSAL_CLOSED_KEEP_DAYS * DAY_MS
    for (const [id, proposal] of next) if (proposal.closed != null && proposal.closed.at < oldest) next.delete(id)
    this.options.store?.write([...next.values()])
    this.proposals = next
    const list = this.list()
    for (const listener of this.listeners) listener(list)
  }
}

/** The proposals of the memory file `file`: the Assistant's part of it, the rest kept as the file has it. */
export function memoryProposalStore(file: string): ProposalStore {
  const store = sessionMemoryStore(file)
  return {
    read: () => store.read().proposals ?? [],
    write: (proposals) => store.write({ ...store.read(), proposals: [...proposals] }),
  }
}

let shared: ProposalBook | undefined

/** The proposals of the running app, in the Assistant's memory file: `worfy-app` writes them, the window reads them (ticket 14). */
export function appProposals(): ProposalBook {
  shared ??= new ProposalBook({ now: appNow, store: memoryProposalStore(assistantMemoryPath(dataRoot())) })
  return shared
}
