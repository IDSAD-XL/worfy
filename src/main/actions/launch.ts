// "Ship ticket" and "Run wave" (ticket 23; contract in src/shared/ipc/actions.ts).
//
// worfy starts the work with the same skills as the terminal and does not know what they do
// (ADR 0002): the text comes from the Project's action template (`<Project data folder>/settings.json`,
// ticket 04), filled in by src/shared/actions/render-template.ts. Before anything starts, the same
// verdict the button shows is taken again over a fresh read of the workflow model, so a Ticket
// claimed meanwhile in a terminal is not shipped twice.
//
// - Ship ticket: a new Session Node in the Project's root (as "New session", ticket 18), with the
//   permission mode a new Session has (bypassPermissions); the text is its first message. The
//   Ticket stays open until the launched agent runs `ticket claim`, so the launcher remembers the
//   launch while its Session lives and refuses a second one for the same Ticket meanwhile
//   (`launchedHint`); the button learns of it through `actions.launches.changed`.
// - Run wave: the text goes to the Project's Orchestrator; while a turn runs it waits in the
//   Orchestrator's queue (ticket 19). Autopilot (worfy-daily ticket 04) sends its Waves the same
//   way (autopilotWave); while it runs in a Project, "Run wave" by hand is refused there, so a
//   person's click does not put a second Wave on top of the run's.
//
// The agent is then bound to what it was launched for, with source `launch` (resolve.ts): once
// Claude Code has reported the session id that names its transcript, the Binding goes into
// `<Project data folder>/bindings.json` (src/main/layout/bindings.ts), so it outlives a restart.
// The Ticket's status is changed by the agent and the `ticket` script inside the skill, never here;
// worfy sees the change through its watch on `.scratch` (ticket 10).
import { runWaveState, shipTicketState, ticketNumber } from '../../shared/actions/render-template'
import { readyWave } from '../../shared/workflow/waves'
import type { BindingTarget } from '../../shared/binding/resolve'
import type { LaunchesSnapshot } from '../../shared/ipc/actions'
import type { BindingAgent } from '../../shared/ipc/bindings'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { SessionNodeView } from '../../shared/ipc/sessions'
import type { ProjectSettings } from '../../shared/projects/action-templates'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { Session } from '../agent/session'

/** The live Session an action talks to, as far as it needs it. */
export type LaunchedSession = Pick<Session, 'send' | 'sdkId' | 'state'>

export interface LaunchDeps {
  /** The Project's repository root; throws for a Project that is not in the list. */
  projectRoot(projectId: string): string
  /** The Project's settings: its action templates. */
  settings(projectId: string): ProjectSettings
  /** The branch checked out in the root; null when git cannot say. */
  branch(root: string): Promise<string | null>
  /** A fresh read of the Project's workflow model. */
  workflow(root: string): Promise<WorkflowModel>
  /** "New session": a new Session Node with a new Session in the Project's root. */
  sessions: { create(projectId: string): SessionNodeView }
  /** The Project's Orchestrator, opened (and started) when it is not yet. */
  orchestrators: { open(projectId: string): Promise<OrchestratorView> }
  /** The app's live Sessions, by any of their ids. */
  registry: { get(sessionId: string): LaunchedSession }
  bindings: { setLaunch(projectId: string, agent: BindingAgent, target: BindingTarget): unknown }
  /** Told whenever a Project's launched Tickets change (a launch, its Session closing). */
  onLaunchesChange?(snapshot: LaunchesSnapshot): void
  /**
   * How often to look whether Claude Code has reported the session id, and for how long; also how
   * often a launched Session is looked at to see whether it has closed (default CLOSE_POLL_MS).
   */
  pollMs?: number
  waitMs?: number
}

export interface ShipTicketResult {
  nodeId: string
  sessionId: string
  text: string
}

export interface RunWaveResult {
  sessionId: string
  text: string
  delivery: 'sent' | 'queued'
}

/** What Autopilot's "Run wave" sent, with the Tickets of the ready Wave it was sent for. */
export interface AutopilotWaveResult extends RunWaveResult {
  tickets: number[]
}

/** Why "Run wave" by hand is refused while Autopilot runs in the Project. */
export const AUTOPILOT_RUNNING_HINT = 'Autopilot is running in this Project: stop it to run a Wave by hand'

const POLL_MS = 250
/** How often the Sessions "Ship ticket" launched are looked at to see whether they have closed. */
const CLOSE_POLL_MS = 1000
/** A Session that has not started its turn in this time is not bound by its launch. */
const WAIT_MS = 10 * 60_000

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A Ticket "Ship ticket" launched a Session for, kept while that Session lives. */
interface TicketLaunch {
  projectId: string
  epic: string
  num: number
  session: LaunchedSession
}

const launchKey = (projectId: string, epic: string, num: number): string => JSON.stringify([projectId, epic, num])

export class ActionLauncher {
  private readonly pending = new Set<Promise<void>>()
  /** By launchKey. */
  private readonly launches = new Map<string, TicketLaunch>()
  /** Launches between the click and the new Session: their fresh read of the workflow is in flight. */
  private readonly starting = new Set<string>()
  private revision = 0
  private watching = false
  /** Whether Autopilot runs in a Project now; "Run wave" by hand is refused meanwhile. */
  private autopilot: { running(projectId: string): boolean } | null = null

  constructor(private readonly deps: LaunchDeps) {}

  /** Autopilot tells the launcher where it runs, once it exists (src/main/ipc/autopilot.ts). */
  attachAutopilot(autopilot: { running(projectId: string): boolean }): void {
    this.autopilot = autopilot
  }

  async shipTicket(projectId: string, epic: string, num: number): Promise<ShipTicketResult> {
    const key = launchKey(projectId, epic, num)
    // Taken before the first await: two clicks that arrive together do not both pass the check.
    if (this.starting.has(key)) throw new Error(`Ship ticket is already starting a Session for ${ticketNumber(num)}`)
    this.starting.add(key)
    try {
      const root = this.deps.projectRoot(projectId)
      const [model, branch] = await Promise.all([this.model(root), this.deps.branch(root)])
      const ticket = model.tickets.find((each) => each.epic === epic && each.num === num)
      if (ticket === undefined) throw new Error(`${epic} has no Ticket ${num}`)
      const launched = this.liveLaunch(key) !== undefined
      const state = shipTicketState({ ticket, tickets: model.tickets, template: this.deps.settings(projectId).actionTemplates.shipTicket, branch, launched })
      if (!state.enabled) throw new Error(state.reason)
      const view = this.deps.sessions.create(projectId)
      const session = this.deps.registry.get(view.sessionId)
      session.send(state.text)
      this.launches.set(key, { projectId, epic, num, session })
      this.changed(projectId)
      this.watchCloses()
      this.bindWhenKnown(projectId, session, { kind: 'ticket', epic, num })
      return { nodeId: view.nodeId, sessionId: view.sessionId, text: state.text }
    } finally {
      this.starting.delete(key)
    }
  }

  /** The Project's Tickets that have a live Session launched by "Ship ticket". */
  launched(projectId: string): LaunchesSnapshot {
    this.prune()
    return this.snapshot(projectId)
  }

  async runWave(projectId: string, epic: string): Promise<RunWaveResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(AUTOPILOT_RUNNING_HINT)
    const { sessionId, text, delivery } = await this.sendWave(projectId, epic)
    return { sessionId, text, delivery }
  }

  /** Autopilot's "Run wave": the same text to the same Orchestrator, and the Tickets it was for. */
  autopilotWave(projectId: string, epic: string): Promise<AutopilotWaveResult> {
    return this.sendWave(projectId, epic)
  }

  private async sendWave(projectId: string, epic: string): Promise<AutopilotWaveResult> {
    const root = this.deps.projectRoot(projectId)
    const [model, branch] = await Promise.all([this.model(root), this.deps.branch(root)])
    if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new Error(`The Project has no Epic ${epic}`)
    const state = runWaveState({ epic, tickets: model.tickets, template: this.deps.settings(projectId).actionTemplates.runWave, branch })
    if (!state.enabled) throw new Error(state.reason)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const session = this.deps.registry.get(view.sessionId)
    const delivery = session.send(state.text)
    this.bindWhenKnown(projectId, session, { kind: 'epic', epic })
    const tickets = readyWave(model.tickets, epic).ready.map((entry) => entry.num)
    return { sessionId: view.sessionId, text: state.text, delivery, tickets }
  }

  /** Settles when every Binding started so far is written or given up; for tests. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
  }

  /** The launch of `key` while its Session lives; a closed one is forgotten here. */
  private liveLaunch(key: string): TicketLaunch | undefined {
    const launch = this.launches.get(key)
    if (launch === undefined || launch.session.state !== 'closed') return launch
    this.launches.delete(key)
    this.changed(launch.projectId)
    return undefined
  }

  /** Forgets every launch whose Session has closed. */
  private prune(): void {
    for (const key of [...this.launches.keys()]) this.liveLaunch(key)
  }

  private snapshot(projectId: string): LaunchesSnapshot {
    const tickets = [...this.launches.values()].filter((launch) => launch.projectId === projectId).map(({ epic, num }) => ({ epic, num }))
    return { projectId, revision: this.revision, tickets }
  }

  private changed(projectId: string): void {
    this.revision += 1
    if (this.deps.onLaunchesChange === undefined) return
    try {
      this.deps.onLaunchesChange(this.snapshot(projectId))
    } catch (error) {
      console.error('[actions] could not report the launched Tickets', error)
    }
  }

  /**
   * Looks at the launched Sessions until none is left, so a closed one frees its Ticket's button
   * without waiting for the next click. One loop for all of them; it ends with the last launch.
   */
  private watchCloses(): void {
    if (this.watching) return
    this.watching = true
    const pollMs = this.deps.pollMs ?? CLOSE_POLL_MS
    void (async () => {
      try {
        while (this.launches.size > 0) {
          await delay(pollMs)
          this.prune()
        }
      } finally {
        this.watching = false
      }
    })()
  }

  private async model(root: string): Promise<WorkflowModel> {
    const model = await this.deps.workflow(root)
    if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
    return model
  }

  /**
   * Writes the launch Binding under the session id that names the transcript. A new Session has
   * none until Claude Code reports it (system/init of its first turn); a resumed one has it at once.
   */
  private bindWhenKnown(projectId: string, session: LaunchedSession, target: BindingTarget): void {
    const pollMs = this.deps.pollMs ?? POLL_MS
    const waitMs = this.deps.waitMs ?? WAIT_MS
    const task = (async () => {
      const until = Date.now() + waitMs
      while (session.sdkId === null && session.state !== 'closed' && Date.now() < until) await delay(pollMs)
      const sdkId = session.sdkId
      if (sdkId === null) {
        console.warn(`[actions] no session id came for the launch Binding to ${JSON.stringify(target)}`)
        return
      }
      this.deps.bindings.setLaunch(projectId, { sessionId: sdkId, agentId: null }, target)
    })()
      .catch((error: unknown) => console.error('[actions] could not write the launch Binding', error))
      .finally(() => this.pending.delete(task))
    this.pending.add(task)
  }
}
