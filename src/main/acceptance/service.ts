// The Acceptance service (worfy-acceptance ticket 01; spec, "The service in main"): the checks that wait for the owner
// in every Project of the Machine, kept in main for every window. It follows the workflow model of each Project of the
// list through the workflow hub, as the "is waiting for you" notifications do (src/main/workflow/waits-notify.ts): the
// hub watches the Ticket files, so no gh, git or `bin/profile` runs while nothing changes, and the queue is computed
// again only when a model, the Project list or a Sent mark changes. The rule and the groups are
// src/shared/acceptance/queue.ts; the decisions sent and not recorded yet are src/main/acceptance/sent-store.ts; the
// Stable copy line of the items of Ready to check and Update first (ticket 02) is src/main/acceptance/stable-line.ts,
// whose answers come later and compute the queue again, as does each tick, so a line asked again in time is seen.
import { acceptanceQueue, itemWaitsForOwner, type QueueProject } from '../../shared/acceptance/queue'
import { ACCEPTANCE_GROUPS, type AcceptanceSent, type AcceptanceState } from '../../shared/ipc/acceptance'
import type { EvidenceItem, Ticket, WorkflowModel } from '../../shared/workflow/types'
import { MAX_INTERVAL_MS } from '../github/prs'
import type { WorkflowHub, WorkflowSubscriber } from '../workflow/watch'
import { itemTextHash, readSentDecisions, writeSentDecisions, type SentDecision } from './sent-store'
import { StableLine, type StableLineSources } from './stable-line'

/** What of the workflow hub (src/main/ipc/workflow.ts, workflowHub) the service follows. */
export type AcceptanceHub = Pick<WorkflowHub, 'open' | 'close' | 'model'>

/** A Project of the Machine's list. */
export interface AcceptanceProject {
  readonly id: string
  readonly name: string
  readonly path: string
}

export interface AcceptanceSources {
  hub: AcceptanceHub
  /** Every Project of the Machine, in the order of its list. */
  projects: () => readonly AcceptanceProject[]
  /** The data folder of a Project (src/main/projects/store.ts, dataDir), where its Sent decisions are kept. */
  dataDir: (projectId: string) => string
  /** Calls the listener whenever the Project list changed; returns the unsubscribe. */
  onProjectsChange?: (listener: () => void) => () => void
  /** What the Stable copy line asks (worfy-acceptance ticket 02); without it no row has a line. */
  stable?: StableLineSources
  log?: (message: string, error: unknown) => void
}

export interface AcceptanceTiming {
  now: () => number
  /** How often the Project list is read again for Projects that came or went. */
  tickMs: number
}

/** A decision the owner made on one item: what the Acceptance view sends (worfy-acceptance ticket 03). */
export interface OwnerDecision {
  epic: string
  num: number
  item: number
  verdict: 'pass' | 'fail'
}

/** After this long without its `owner-check` line a Sent decision reads "Not recorded yet". */
export const NOT_RECORDED_AFTER_MS = 24 * 60 * 60 * 1000

const SUBSCRIBER_ID = 'acceptance'

/** The longest delay setTimeout keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1

const ACCEPTANCE_TIMING: AcceptanceTiming = { now: () => Date.now(), tickMs: 60_000 }

const EMPTY: AcceptanceState = { groups: ACCEPTANCE_GROUPS.map((group) => ({ group, rows: [] })) }

const nn = (num: number): string => String(num).padStart(2, '0')

/** The `owner-check` lines of an item with the verdict. */
const ownerLines = (item: EvidenceItem, verdict: 'pass' | 'fail'): number => item.evidence.filter((line) => line.kind === 'owner-check' && line.verdict === verdict).length

/** The item a decision was made on: the one at its number with its text, else the one with its text that has moved. */
function itemOf(ticket: Ticket, decision: SentDecision): EvidenceItem | null {
  const items = ticket.evidence ?? []
  const same = (item: EvidenceItem) => itemTextHash(item.text) === decision.textHash
  return items.find((item) => item.index === decision.item && same(item)) ?? items.find(same) ?? null
}

/**
 * Whether a decision is done with: its `owner-check` line has come (more lines with its verdict than when it was sent),
 * or its item is gone or no longer waits for the owner. A Ticket the model does not have keeps its decisions.
 */
function settled(model: WorkflowModel, decision: SentDecision): boolean {
  const ticket = model.tickets.find((each) => each.epic === decision.epic && each.num === decision.num)
  if (ticket === undefined) return false
  const item = itemOf(ticket, decision)
  return item === null || !itemWaitsForOwner(item) || ownerLines(item, decision.verdict) > decision.lines
}

interface Followed {
  root: string
  /** The model of the Project; null until the hub has answered the open. */
  model: WorkflowModel | null
  /** The open under way; null once it has ended. */
  opening: Promise<void> | null
}

export class AcceptanceService {
  private readonly followed = new Map<string, Followed>()
  /** The Projects whose model could not be read: the pause in ticks, and the ticks still to wait. */
  private readonly retries = new Map<string, { pause: number; left: number }>()
  /** The Sent decisions of each Project followed, as its file holds them. */
  private readonly sent = new Map<string, SentDecision[]>()
  private readonly subscribers = new Map<number | string, (state: AcceptanceState) => void>()
  private state: AcceptanceState = EMPTY
  private stamp = JSON.stringify(EMPTY)
  private timer: ReturnType<typeof setInterval> | null = null
  /** Computes the queue again when the oldest Sent decision turns "Not recorded yet". */
  private recheck: ReturnType<typeof setTimeout> | null = null
  private stopProjects: (() => void) | null = null
  private readonly stableLine: StableLine | null

  constructor(
    private readonly sources: AcceptanceSources,
    private readonly timing: AcceptanceTiming = ACCEPTANCE_TIMING,
  ) {
    this.stableLine = sources.stable === undefined ? null : new StableLine({ now: timing.now, ...sources.stable }, () => this.compute())
  }

  /** Starts following the Projects of the list; a second call does nothing. */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.timing.tickMs)
    this.timer.unref?.()
    this.stopProjects = this.sources.onProjectsChange?.(() => this.tick()) ?? null
    this.tick()
  }

  /** Stops following: every subscription of the hub is closed, and the subscribers are dropped. */
  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer)
    if (this.recheck !== null) clearTimeout(this.recheck)
    this.timer = null
    this.recheck = null
    this.stopProjects?.()
    this.stopProjects = null
    this.subscribers.clear()
    const roots = [...this.followed.values()].map((entry) => entry.root)
    this.followed.clear()
    this.retries.clear()
    this.sent.clear()
    await Promise.all(roots.map((root) => this.sources.hub.close(root, SUBSCRIBER_ID).catch(() => false)))
  }

  /** The queue now, once every open under way has ended; starts the service when it has not started. */
  async get(): Promise<AcceptanceState> {
    this.start()
    await Promise.all([...this.followed.values()].map((entry) => entry.opening))
    return this.state
  }

  /** Subscribes `id` (once; a second call replaces its `send`) to every change of the queue, and answers it now. */
  subscribe(id: number | string, send: (state: AcceptanceState) => void): Promise<AcceptanceState> {
    this.subscribers.set(id, send)
    return this.get()
  }

  /** Ends `id`'s subscription. False when it was not subscribed. */
  unsubscribe(id: number | string): boolean {
    return this.subscribers.delete(id)
  }

  /**
   * Keeps a decision the owner sent on a manual item that waits for the owner: the item shows "Sent" until the Ticket file
   * has a new `owner-check` line with its verdict. A second decision on the item replaces the first. Throws when the
   * Project is not read yet or the item is not such an item.
   */
  markSent(projectId: string, decision: OwnerDecision): void {
    const model = this.followed.get(projectId)?.model
    if (!model) throw new Error(`acceptance: the Project ${projectId} is not read yet`)
    const ticket = model.tickets.find((each) => each.epic === decision.epic && each.num === decision.num)
    if (ticket === undefined) throw new Error(`acceptance: no Ticket ${decision.epic} ${nn(decision.num)} in ${projectId}`)
    const item = ticket.evidence?.find((each) => each.index === decision.item)
    if (item === undefined || !itemWaitsForOwner(item)) {
      throw new Error(`acceptance: item ${decision.item} of ${decision.epic} ${nn(decision.num)} is not a manual item that waits for the owner`)
    }
    const kept: SentDecision = {
      projectId,
      epic: decision.epic,
      num: decision.num,
      item: decision.item,
      textHash: itemTextHash(item.text),
      verdict: decision.verdict,
      at: new Date(this.timing.now()).toISOString(),
      lines: ownerLines(item, decision.verdict),
    }
    const others = (this.sent.get(projectId) ?? []).filter((each) => !(each.epic === kept.epic && each.num === kept.num && each.item === kept.item))
    this.keep(projectId, [...others, kept])
    this.compute()
  }

  /** Writes a Project's decisions and keeps them. */
  private keep(projectId: string, decisions: SentDecision[]): void {
    writeSentDecisions(this.sources.dataDir(projectId), decisions)
    this.sent.set(projectId, decisions)
  }

  /** Reads the Project list: follows the Projects that came, leaves those that went. */
  private tick(): void {
    if (this.timer === null) return
    const projects = this.sources.projects()
    const ids = new Set(projects.map((project) => project.id))
    for (const id of [...this.retries.keys()]) if (!ids.has(id)) this.retries.delete(id)
    for (const project of projects) {
      if (this.followed.has(project.id)) continue
      const retry = this.retries.get(project.id)
      if (retry !== undefined && --retry.left > 0) continue
      this.follow(project)
    }
    let left = false
    for (const [id, entry] of [...this.followed.entries()]) {
      if (ids.has(id)) continue
      left = true
      this.followed.delete(id)
      this.sent.delete(id)
      void this.sources.hub.close(entry.root, SUBSCRIBER_ID).catch(() => false)
    }
    // A Stable copy line asks again after a while (a commit fetched since, an Update installed): each tick looks.
    if (left || this.stableLine !== null) this.compute()
  }

  private follow(project: AcceptanceProject): void {
    const entry: Followed = { root: project.path, model: null, opening: null }
    this.followed.set(project.id, entry)
    this.sent.set(project.id, readSentDecisions(this.sources.dataDir(project.id)))
    // The Project left the list (and maybe came back) meanwhile, or the service stopped: no one's.
    const current = (): boolean => this.followed.get(project.id) === entry
    const subscriber: WorkflowSubscriber = {
      id: SUBSCRIBER_ID,
      // The queue reads the Tickets' fields (their items and Evidence lines), never their text.
      fieldsOnly: true,
      // The hub sends what changed; the model it keeps already holds the change.
      send: () =>
        void this.sources.hub.model(entry.root).then((model) => {
          if (!current() || model === null) return
          entry.model = model
          this.compute()
        }),
    }
    entry.opening = this.sources.hub.open(entry.root, subscriber).then(
      (model) => {
        entry.opening = null
        if (!current()) return
        this.retries.delete(project.id)
        entry.model = model
        this.compute()
      },
      (error: unknown) => {
        entry.opening = null
        if (!current()) return
        const maxPause = Math.max(1, Math.ceil(MAX_INTERVAL_MS / this.timing.tickMs))
        const pause = Math.min(maxPause, (this.retries.get(project.id)?.pause ?? 0.5) * 2)
        this.retries.set(project.id, { pause, left: pause })
        ;(this.sources.log ?? ((message, cause) => console.warn(message, cause)))(
          `[acceptance] ${entry.root}: the workflow model could not be read; tried again in ${Math.round((pause * this.timing.tickMs) / 1000)} s`,
          error,
        )
        this.followed.delete(project.id)
        this.sent.delete(project.id)
        void this.sources.hub.close(entry.root, SUBSCRIBER_ID).catch(() => false)
      },
    )
  }

  /** Computes the queue again; the subscribers get it when it changed. Drops the decisions whose line has come. */
  private compute(): void {
    const now = this.timing.now()
    const projects: QueueProject[] = []
    const models = new Map<string, WorkflowModel>()
    for (const project of this.sources.projects()) {
      const model = this.followed.get(project.id)?.model
      if (!model) continue
      models.set(project.id, model)
      const decisions = this.sent.get(project.id) ?? []
      // A model that failed has no Tickets: it settles nothing.
      if (model.error === null && decisions.some((decision) => settled(model, decision))) {
        this.keep(
          project.id,
          decisions.filter((decision) => !settled(model, decision)),
        )
      }
      projects.push({ projectId: project.id, name: project.name, model })
    }
    const sentOf = (projectId: string, ticket: Ticket, item: EvidenceItem): AcceptanceSent | null => {
      const decision = (this.sent.get(projectId) ?? []).find((each) => each.epic === ticket.epic && each.num === ticket.num && itemOf(ticket, each)?.index === item.index)
      if (decision === undefined) return null
      const state = now - Date.parse(decision.at) >= NOT_RECORDED_AFTER_MS ? 'not-recorded' : 'sent'
      return { verdict: decision.verdict, at: decision.at, state }
    }
    const line = this.stableLine
    const stableOf =
      line === null
        ? undefined
        : (projectId: string, ticket: Ticket) => {
            const model = models.get(projectId)!
            return line.line({ projectId, root: model.root, repoUrl: model.repoUrl, tickets: model.tickets }, ticket)
          }
    const next: AcceptanceState = { groups: acceptanceQueue(projects, { now, sent: sentOf, ...(stableOf === undefined ? {} : { stable: stableOf }) }) }
    this.recheckAt(now)
    const stamp = JSON.stringify(next)
    if (stamp === this.stamp) return
    this.state = next
    this.stamp = stamp
    for (const send of this.subscribers.values()) send(next)
  }

  /** Computes the queue again when the next Sent decision turns "Not recorded yet". */
  private recheckAt(now: number): void {
    if (this.recheck !== null) clearTimeout(this.recheck)
    this.recheck = null
    const due = [...this.sent.values()]
      .flat()
      .map((decision) => Date.parse(decision.at) + NOT_RECORDED_AFTER_MS)
      .filter((at) => at > now)
    if (due.length === 0 || this.timer === null) return
    // A delay past the most setTimeout takes (about 24.8 days: a decision dated ahead by a skewed clock) would fire at
    // once, again and again; the longest delay fires and simply sets the next one.
    this.recheck = setTimeout(() => this.compute(), Math.min(Math.min(...due) - now, MAX_TIMER_MS))
    this.recheck.unref?.()
  }
}
