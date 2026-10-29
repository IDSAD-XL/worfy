// "Ship ticket", "Run wave" (ticket 23) and "Process gate queue" (worfy-windows ticket 17); the
// contract is in src/shared/ipc/actions.ts.
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
//   person's click does not put a second Wave on top of the run's. Autopilot's text must name the
//   Wave's Tickets ({tickets}, ADR-0033); the text, those Tickets and the skipped ones come from
//   one read of the workflow model, so the run's journal names exactly what went. A run after a
//   Stop passes the interrupted Wave's Tickets (worfy-week ticket 17): those still in work join it.
//   A Wave the run sends to a new SDK session of the Orchestrator (worfy-throughput ticket 52) goes
//   with `brief`: the template's text as is, and the instruction to run `wave-brief <epic>` first
//   (after a slash command, so Claude Code still expands it; in front of any other text).
// - Process gate queue: the template's text (no placeholders, /worfy:gate-queue by default) goes to
//   the Project's Orchestrator, as "Run wave" does. Only on the machine whose Profile gives it the
//   role `serve` of the cross-machine gate (ADR-0069), read again on every click; refused while
//   Autopilot runs in the Project, which sends it itself when it has no Wave (src/main/autopilot/run.ts).
//   worfy only sends the text: the skill rebases, checks, comments and merges (ADR-0002).
//
// The agent is then bound to what it was launched for, with source `launch` (resolve.ts): once
// Claude Code has reported the session id that names its transcript, the Binding goes into
// `<Project data folder>/bindings.json` (src/main/layout/bindings.ts), so it outlives a restart.
// The Ticket's status is changed by the agent and the `ticket` script inside the skill, never here;
// worfy sees the change through its watch on `.scratch` (ticket 10).
import { emptyTemplateHint, runWaveState, shipTicketState, ticketNumber } from '../../shared/actions/render-template'
import type { SkippedTicket } from '../../shared/workflow/waves'
import type { BindingTarget } from '../../shared/binding/resolve'
import type { LaunchesSnapshot } from '../../shared/ipc/actions'
import type { BindingAgent } from '../../shared/ipc/bindings'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { SessionNodeView } from '../../shared/ipc/sessions'
import { AUTOPILOT_TEMPLATE_HINT, isActionConfigured, namesWaveTickets, type ProjectSettings } from '../../shared/projects/action-templates'
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
  /**
   * "New session": a new Session Node with a new Session in the Project's root; with `near`, on the
   * first clear spot at `near.x`, from `near.y` down (src/main/layout/place.ts, `placeDownFrom`).
   */
  sessions: { create(projectId: string, near?: CanvasSpot): SessionNodeView }
  /** The Project's Orchestrator, opened (and started) when it is not yet. */
  orchestrators: { open(projectId: string): Promise<OrchestratorView> }
  /** The app's live Sessions, by any of their ids. */
  registry: { get(sessionId: string): LaunchedSession }
  bindings: { setLaunch(projectId: string, agent: BindingAgent, target: BindingTarget): unknown }
  /**
   * This Machine's role in the cross-machine gate of the Project at `root`, read from its Profile
   * again (src/main/github/gate-queue.ts); null without cross_machine_gate. Without it "Process gate
   * queue" is refused.
   */
  gateRole?(root: string): Promise<'serve' | 'request' | null>
  /** Told whenever a Project's launched Tickets change (a launch, its Session closing). */
  onLaunchesChange?(snapshot: LaunchesSnapshot): void
  /**
   * How often to look whether Claude Code has reported the session id, and for how long; also how
   * often a launched Session is looked at to see whether it has closed (default CLOSE_POLL_MS).
   */
  pollMs?: number
  waitMs?: number
}

/** A spot on the Canvas, in canvas units. */
export interface CanvasSpot {
  x: number
  y: number
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

/**
 * What Autopilot's "Run wave" sent, with the Tickets of the ready Wave it was sent for and the
 * Tickets left out of it for not being open, all from the read the text was made from.
 */
export interface AutopilotWaveResult extends RunWaveResult {
  tickets: number[]
  skipped: SkippedTicket[]
}

/**
 * Autopilot's text for a Wave that starts a new SDK session of the Orchestrator (worfy-throughput
 * ticket 52): the Wave's own text, unchanged, and the instruction to run `wave-brief <epic>` first,
 * as skill epic-wave says a new session starts ("How to resume a wave"). A text that is a slash
 * command (the templates are) stays first, or Claude Code would not expand it: the instruction goes
 * after it, past a blank line, and reaches the skill as part of its arguments. A text that is not
 * one gets the instruction in front.
 */
export function waveBriefText(epic: string, text: string): string {
  const brief = `This is a new session for the next Wave: before anything else, run \`wave-brief ${epic}\` (skill epic-wave, "How to resume a wave").`
  return text.trimStart().startsWith('/') ? `${text}\n\n${brief}` : `${brief} Then:\n\n${text}`
}

/** Why "Run wave" by hand is refused while Autopilot runs in the Project. */
export const AUTOPILOT_RUNNING_HINT = 'Autopilot is running in this Project: stop it to run a Wave by hand'

/** Why "Process gate queue" by hand is refused while Autopilot runs in the Project. */
export const GATE_QUEUE_AUTOPILOT_HINT = 'Autopilot is running in this Project: it processes the gate queue itself'

/** Why "Process gate queue" is refused on a machine whose role is not `serve`. */
export function gateQueueRoleHint(role: 'request' | null): string {
  return role === 'request'
    ? 'This machine has the role request in the cross-machine gate: the machine with serve processes the gate queue'
    : 'The Profile of this machine has no cross_machine_gate: there is no gate queue'
}

export interface GateQueueResult {
  sessionId: string
  text: string
  delivery: 'sent' | 'queued'
}

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

  /**
   * `near`: where the renderer wants the Session, right of the Epic frames' column at the Ticket's
   * height (worfy-daily ticket 28); without it the Session goes where every new Node goes.
   */
  async shipTicket(projectId: string, epic: string, num: number, near?: CanvasSpot): Promise<ShipTicketResult> {
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
      const view = this.deps.sessions.create(projectId, near)
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
    const { sessionId, text, delivery } = await this.sendWave(projectId, epic, false)
    return { sessionId, text, delivery }
  }

  /**
   * "Process gate queue": the Project's template to its Orchestrator. Refused, with the reason, when
   * Autopilot runs in the Project, when this Machine's role (read again now) is not `serve`, or when
   * the template is empty.
   */
  async gateQueue(projectId: string): Promise<GateQueueResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(GATE_QUEUE_AUTOPILOT_HINT)
    const text = await this.gateQueueText(projectId)
    if (text.refusal !== null) throw new Error(text.refusal)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const delivery = this.deps.registry.get(view.sessionId).send(text.text)
    return { sessionId: view.sessionId, text: text.text, delivery }
  }

  /**
   * The text Autopilot sends its Orchestrator before it stops for want of a Wave (src/main/autopilot/run.ts):
   * the "Process gate queue" template on a `serve` machine; null when the role is not `serve`, the
   * template is empty, or the role cannot be read.
   */
  async autopilotGateQueue(projectId: string): Promise<string | null> {
    try {
      const text = await this.gateQueueText(projectId)
      return text.refusal === null ? text.text : null
    } catch (error) {
      console.warn(`[actions] ${projectId}: no gate queue for Autopilot`, error)
      return null
    }
  }

  private async gateQueueText(projectId: string): Promise<{ text: string; refusal: null } | { text: null; refusal: string }> {
    const root = this.deps.projectRoot(projectId)
    const role = this.deps.gateRole === undefined ? null : await this.deps.gateRole(root)
    if (role !== 'serve') return { text: null, refusal: gateQueueRoleHint(role) }
    const template = this.deps.settings(projectId).actionTemplates.gateQueue
    if (!isActionConfigured(template)) return { text: null, refusal: emptyTemplateHint('gateQueue') }
    return { text: template.trim(), refusal: null }
  }

  /**
   * Autopilot's "Run wave": the same text to the same Orchestrator, and the Tickets it was for.
   * `resume`: the Tickets of the Wave a Stop interrupted; those still in work join the Wave.
   * `brief`: the Orchestrator's Session is a new SDK session, so the text goes as waveBriefText.
   */
  autopilotWave(projectId: string, epic: string, resume: readonly number[] = [], brief = false): Promise<AutopilotWaveResult> {
    return this.sendWave(projectId, epic, true, resume, brief)
  }

  /**
   * Why Autopilot may not start with the Project's "Run wave" template, before a run begins: the
   * template is empty, or it does not name the Wave's Tickets (ADR-0033). Null when it may.
   */
  autopilotRefusal(projectId: string): string | null {
    const template = this.deps.settings(projectId).actionTemplates.runWave
    if (!isActionConfigured(template)) return emptyTemplateHint('runWave')
    return namesWaveTickets(template) ? null : AUTOPILOT_TEMPLATE_HINT
  }

  private async sendWave(projectId: string, epic: string, autopilot: boolean, resumable: readonly number[] = [], brief = false): Promise<AutopilotWaveResult> {
    const root = this.deps.projectRoot(projectId)
    const [model, branch] = await Promise.all([this.model(root), this.deps.branch(root)])
    if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new Error(`The Project has no Epic ${epic}`)
    // One read: the text, the Tickets it names and the skipped ones all come from `model`.
    const state = runWaveState({ epic, tickets: model.tickets, template: this.deps.settings(projectId).actionTemplates.runWave, branch, autopilot, resumable })
    if (!state.enabled) throw new Error(state.reason)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const session = this.deps.registry.get(view.sessionId)
    const text = brief ? waveBriefText(epic, state.text) : state.text
    const delivery = session.send(text)
    this.bindWhenKnown(projectId, session, { kind: 'epic', epic })
    return { sessionId: view.sessionId, text, delivery, tickets: state.tickets, skipped: state.skipped }
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
