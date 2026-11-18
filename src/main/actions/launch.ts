// "Ship ticket", "Run wave" (ticket 23), "Process gate queue" (worfy-windows ticket 17) and "Draft
// replies" (worfy-pr-inbox ticket 04); the contract is in src/shared/ipc/actions.ts.
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
//   (`launchedHint`); the button learns of it through `actions.launches.changed`. The Session runs on
//   Claude Code whatever the Project's `defaultVendor`: the Harness's skills run under Claude Code
//   only until worfy-multi-vendor tickets 35 and 36 bring them to Codex (ticket 24, decided without the
//   owner — to confirm).
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
// - Build of the team reviewer (worfy-human-review ticket 09): a new Session Node in the Project's
//   root, as "Ship ticket" makes one and on Claude Code alike, whose first message is the generator
//   skill (TEAM_REVIEWER_COMMAND). No template and no Binding: the Session is about the Project, not
//   a Ticket or an Epic; the skill asks the user before it reads anything. "Update" (ticket 10) is the
//   same Session with TEAM_REVIEWER_REFRESH_COMMAND.
// - Draft replies (worfy-pr-inbox ticket 04, ADR-0105): a new Session Node in the Project's root, as "Ship ticket"
//   makes one and on Claude Code alike, whose first message is the "Draft replies" template filled in with one pull
//   request ({repo}, {pr}). No Binding: the Session is about a pull request, not a Ticket. It is a Session with a
//   person and never Autopilot's: Autopilot drives only the Orchestrator, and its calls here (autopilotWave,
//   autopilotRefusal, autopilotGateQueue) do not include this one; a run of Autopilot in the Project does not stop
//   it. The skill writes drafts into files on this machine and posts nothing; worfy posts a reply only on the user's
//   click (ticket 05 of that Epic).
// - Fix checks, Resolve conflicts, Address comments (worfy-pr-follow ticket 01): the Project's template of the action
//   filled in with one pull request and its head ({repo}, {pr}, {sha}), on Claude Code. Before anything starts the PR
//   is read again (PrInbox.refresh) and the verdict of the button (src/shared/actions/pr-follow.ts) is taken over that
//   row, so {sha} is the head now and a reason gone meanwhile refuses the click. A refresh skipped for an account
//   waiting for its rate limit leaves the row as last read; that is accepted, as the skill checks the head itself.
//   Refused while Autopilot runs in the Project, and while its Orchestrator is busy with a Binding to the Epic of the
//   PR's Ticket: that Wave fixes its own PRs (harness/skills/epic-wave/SKILL.md). The text goes to the Session Node
//   bound (manual or launch) to the PR's Ticket — on Claude Code, not archived, its transcript's last record younger
//   than FOLLOW_SESSION_MS (spec Q7) — the way worfy-continuity continues a Session (ADR-0108, point 5):
//   NodeSessions.started resumes it when no process runs, Session.send sends or queues, Session.notice tells the user
//   where the text came from. Else a new Session Node, its first message the text, bound by launch to the PR's Ticket.
//
// The agent is then bound to what it was launched for, with source `launch` (resolve.ts): once
// Claude Code has reported the session id that names its transcript, the Binding goes into
// `<Project data folder>/bindings.json` (src/main/layout/bindings.ts), so it outlives a restart.
// The Ticket's status is changed by the agent and the `ticket` script inside the skill, never here;
// worfy sees the change through its watch on `.scratch` (ticket 10).
import { emptyTemplateHint, prFollowState, prReplyState, runWaveState, shipTicketState, ticketNumber } from '../../shared/actions/render-template'
import type { SkippedTicket } from '../../shared/workflow/waves'
import { waveWithContinuation } from '../../shared/autopilot/continuation'
import type { BindingTarget } from '../../shared/binding/resolve'
import type { LaunchesSnapshot } from '../../shared/ipc/actions'
import { isLaunchBinding, type BindingAgent, type ManualBinding } from '../../shared/ipc/bindings'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { PrInboxRow } from '../../shared/ipc/pr-inbox'
import { SESSION_NODE_KIND, type SessionNodeView } from '../../shared/ipc/sessions'
import { isArchived, type LayoutNode } from '../../shared/layout/types'
import { ticketOfRow } from '../../shared/pr-inbox/rows'
import {
  ACTION_LABELS,
  AUTOPILOT_TEMPLATE_HINT,
  isActionConfigured,
  namesWaveTickets,
  PR_REPLY_VENDOR,
  SHIP_TICKET_VENDOR,
  TEAM_REVIEWER_COMMAND,
  TEAM_REVIEWER_REFRESH_COMMAND,
  TEAM_REVIEWER_VENDOR,
  type PrFollowAction,
  type ProjectSettings,
} from '../../shared/projects/action-templates'
import { UNNAMED_VENDOR, type VendorId } from '../../shared/vendors/vendor'
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
   * "New session": a new Session Node with a new Session of `vendor` in the Project's root; with
   * `near`, on the first clear spot at `near.x`, from `near.y` down (src/main/layout/place.ts,
   * `placeDownFrom`).
   */
  sessions: { create(projectId: string, near: CanvasSpot | undefined, vendor: VendorId): SessionNodeView }
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
  /** What "Fix checks", "Resolve conflicts" and "Address comments" read and start; without it they are refused. */
  prFollow?: PrFollowDeps
  /** The clock, in ms: the age of a transcript's last record. Date.now by default. */
  now?(): number
}

/** A Session "Fix checks", "Resolve conflicts" or "Address comments" sends its text to, as far as they need it. */
export type FollowSession = Pick<Session, 'id' | 'send' | 'notice'>

/** The parts of the app the actions on a pull request read (worfy-pr-follow ticket 01). */
export interface PrFollowDeps {
  /**
   * A fresh read of the PR (PrInbox.refresh), then its row in the Project's snapshot — undefined when the snapshot
   * holds none: closed, merged, or not the Project's — and the login the PR inbox reads as.
   */
  pull(projectId: string, repo: string, pr: number): Promise<{ row: PrInboxRow | undefined; viewer: string | null }>
  /** The Project's Layout Nodes; the Session Nodes of worfy among them may take the text. */
  nodes(projectId: string): readonly LayoutNode[]
  /** The time of the last record of each of these Sessions' transcripts, in ms; a Session without one is absent. */
  lastAt(projectId: string, sessionIds: readonly string[]): Promise<ReadonlyMap<string, number>>
  /** The Project's stored Bindings (bindings.json): manual ones and launch ones. */
  stored(projectId: string): readonly ManualBinding[]
  /** The Project's Orchestrator while it is busy (Orchestrators.busy), with the session id its Bindings are stored under; null when it is not. */
  busyOrchestrator(projectId: string): Promise<{ sessionId: string | null } | null>
  /** The Node's Session started — resumed by its transcript when no process runs (NodeSessions.started) — and live. */
  started(projectId: string, nodeId: string): Promise<FollowSession>
}

export interface PrFollowResult {
  nodeId: string
  sessionId: string
  text: string
  delivery: 'sent' | 'queued' | 'new'
}

/** A Ticket's Session whose transcript's last record is older than this gets no text: a new Session starts (spec Q7, as the automatic archive's 24 h, ADR-0076). */
export const FOLLOW_SESSION_MS = 24 * 60 * 60_000

/** Why an action on a pull request is refused while Autopilot runs in the Project. */
export const PR_FOLLOW_AUTOPILOT_HINT = 'Autopilot is running in this Project: stop it to follow a pull request by hand'

/** Why an action on a pull request of `epic` is refused while the Orchestrator bound to that Epic is busy. */
export const prFollowWaveHint = (epic: string): string => `The Orchestrator is busy with a Wave of ${epic}: the Wave fixes its own pull requests`

/** Why a second action on a PR is refused while the Session the first one started has not reported its id yet. */
export const prFollowStartingHint = (action: PrFollowAction, repo: string, pr: number): string =>
  `${ACTION_LABELS[action]} is already starting for ${repo}#${pr}: wait for its Session, or close its Node to start again`

/** The notice line a Ticket's Session gets with the text: only the user sees it, the model does not. */
export function prFollowNotice(action: PrFollowAction, repo: string, pr: number, delivery: 'sent' | 'queued'): string {
  return `worfy: ${ACTION_LABELS[action]} for ${repo}#${pr} ${delivery === 'sent' ? 'sent to' : 'queued in'} this Session`
}

/** The target of each stored Binding of a Session (not of a Subagent): the manual one, else the launch one, as resolveBinding ranks them. */
function storedTargets(stored: readonly ManualBinding[]): Map<string, BindingTarget> {
  const sessions = stored.filter((binding) => (binding.agentId ?? null) === null)
  // The manual ones last, so each overwrites a launch one of its Session.
  return new Map([...sessions.filter(isLaunchBinding), ...sessions.filter((binding) => !isLaunchBinding(binding))].map((binding) => [binding.sessionId, binding.target]))
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

type Ends = ReadonlySet<LaunchedSession['state']>
/** A closed Session never reports an id: every wait for one ends there. */
const CLOSED: Ends = new Set(['closed'])
/**
 * The wait of an action on a PR also ends on `error` (Claude Code not signed in, no network, the process exited): its
 * lock refuses every click on the PR, and the user's next click is the retry. "Ship ticket" and "Run wave" keep waiting
 * through `error`: a Session there starts again on the user's next send, and its Binding still comes.
 */
const ENDED: Ends = new Set(['error', 'closed'])

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
  /** Actions on a pull request between the click and the Session that takes the text, by Project and PR. */
  private readonly following = new Set<string>()
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
      const view = this.deps.sessions.create(projectId, near, SHIP_TICKET_VENDOR)
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

  /**
   * "Build" of the team reviewer: a new Session Node of the Project on Claude Code whose first message
   * is TEAM_REVIEWER_COMMAND; with `refresh` ("Update", worfy-human-review ticket 10)
   * TEAM_REVIEWER_REFRESH_COMMAND. Throws for a Project that is not in the list.
   */
  buildTeamReviewer(projectId: string, options: { refresh?: boolean } = {}): ShipTicketResult {
    this.deps.projectRoot(projectId)
    const text = options.refresh === true ? TEAM_REVIEWER_REFRESH_COMMAND : TEAM_REVIEWER_COMMAND
    const view = this.deps.sessions.create(projectId, undefined, TEAM_REVIEWER_VENDOR)
    this.deps.registry.get(view.sessionId).send(text)
    return { nodeId: view.nodeId, sessionId: view.sessionId, text }
  }

  /**
   * "Draft replies" on the pull request `repo`#`pr`: a new Session Node of the Project on Claude Code whose first
   * message is the Project's template filled in. Throws, with the reason, for a Project that is not in the list, an
   * empty template or one that does not render; then nothing is created.
   */
  prReply(projectId: string, repo: string, pr: number): ShipTicketResult {
    this.deps.projectRoot(projectId)
    const state = prReplyState({ template: this.deps.settings(projectId).actionTemplates.prReply, repo, pr })
    if (!state.enabled) throw new Error(state.reason)
    const view = this.deps.sessions.create(projectId, undefined, PR_REPLY_VENDOR)
    this.deps.registry.get(view.sessionId).send(state.text)
    return { nodeId: view.nodeId, sessionId: view.sessionId, text: state.text }
  }

  /**
   * "Fix checks", "Resolve conflicts" or "Address comments" on the pull request `repo`#`pr` (worfy-pr-follow ticket
   * 01): the PR read again, the verdict taken over that read, then the text to the Ticket's Session or to a new Session
   * Node (`near`: where the renderer wants it, as for "Ship ticket"). Throws, with the reason, and starts nothing, for
   * every refusal of actions.prFollow.
   */
  async prFollow(projectId: string, repo: string, pr: number, action: PrFollowAction, near?: CanvasSpot): Promise<PrFollowResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(PR_FOLLOW_AUTOPILOT_HINT)
    const follow = this.deps.prFollow
    if (follow === undefined) throw new Error('This build cannot follow pull requests')
    const key = JSON.stringify([projectId, repo.toLowerCase(), pr])
    // Taken before the first await: two clicks that arrive together do not start two Sessions. A new Session keeps it
    // until its Binding is written (or given up): before that the route cannot find it, and a second click on the same
    // PR would start a second Session on the same Ticket and branch.
    if (this.following.has(key)) throw new Error(prFollowStartingHint(action, repo, pr))
    this.following.add(key)
    let held: Promise<void> | null = null
    try {
      const root = this.deps.projectRoot(projectId)
      const template = this.deps.settings(projectId).actionTemplates[action]
      if (!isActionConfigured(template)) throw new Error(emptyTemplateHint(action))
      const [{ row, viewer }, model] = await Promise.all([follow.pull(projectId, repo, pr), this.deps.workflow(root)])
      const state = prFollowState({ action, template, repo, pr, row, viewer })
      if (!state.enabled) throw new Error(state.reason)
      // A PR outside the workflow (no Ticket names it, or the workflow cannot be read) still gets its Session, unbound.
      const ticket = row === undefined || model.error !== null ? undefined : ticketOfRow(row, model.tickets)
      const target: BindingTarget | null = ticket === undefined ? null : { kind: 'ticket', epic: ticket.epic, num: ticket.num }
      const stored = storedTargets(follow.stored(projectId))
      if (target !== null) {
        // shortcut: only a stored Binding (Run wave's launch one, or a manual one) ties the Orchestrator to the Epic; a Wave typed into it by hand binds by its transcript's signals, which this does not read. Read them (sessionBindings) when such a Wave gets a second Session on its PR.
        const orchestrator = await follow.busyOrchestrator(projectId)
        const bound = orchestrator?.sessionId == null ? undefined : stored.get(orchestrator.sessionId)
        if (bound?.kind === 'epic' && bound.epic === target.epic) throw new Error(prFollowWaveHint(target.epic))
      }
      const node = target === null ? null : await this.ticketSession(projectId, target, stored)
      if (node !== null) {
        try {
          const session = await follow.started(projectId, node)
          const delivery = session.send(state.text)
          session.notice(prFollowNotice(action, repo, pr, delivery))
          return { nodeId: node, sessionId: session.id, text: state.text, delivery }
        } catch (error) {
          console.warn(`[actions] ${projectId}: the Session of ${node} did not take ${ACTION_LABELS[action]}; a new one starts`, error)
        }
      }
      const view = this.deps.sessions.create(projectId, near, PR_REPLY_VENDOR)
      const session = this.deps.registry.get(view.sessionId)
      session.send(state.text)
      held = target === null ? this.untilKnown(session, ENDED) : this.bindWhenKnown(projectId, session, target, ENDED)
      return { nodeId: view.nodeId, sessionId: view.sessionId, text: state.text, delivery: 'new' }
    } finally {
      if (held === null) this.following.delete(key)
      else void held.finally(() => this.following.delete(key))
    }
  }

  /**
   * The Session Node that takes the text of an action on a PR of the Ticket `target`: a Node of worfy bound to it,
   * manual or launch, on Claude Code, not archived, whose transcript's last record is younger than FOLLOW_SESSION_MS;
   * of several, the one with the newest record. Null when none is.
   */
  private async ticketSession(projectId: string, target: Extract<BindingTarget, { kind: 'ticket' }>, stored: ReadonlyMap<string, BindingTarget>): Promise<string | null> {
    const bound = this.deps.prFollow!.nodes(projectId).flatMap((node) => {
      if (node.kind !== SESSION_NODE_KIND || node.data.origin !== 'worfy' || isArchived(node)) return []
      const vendor = node.data.vendor ?? UNNAMED_VENDOR
      const sessionId = node.data.sessionId
      if (vendor !== PR_REPLY_VENDOR || typeof sessionId !== 'string' || sessionId === '') return []
      const bindingTarget = stored.get(sessionId)
      if (bindingTarget?.kind !== 'ticket' || bindingTarget.epic !== target.epic || bindingTarget.num !== target.num) return []
      return [{ nodeId: node.id, sessionId }]
    })
    if (bound.length === 0) return null
    const lastAt = await this.deps.prFollow!.lastAt(projectId, bound.map((each) => each.sessionId))
    const now = this.deps.now?.() ?? Date.now()
    const young = bound.flatMap((each) => {
      const at = lastAt.get(each.sessionId)
      return at !== undefined && now - at < FOLLOW_SESSION_MS ? [{ ...each, at }] : []
    })
    young.sort((a, b) => b.at - a.at)
    return young[0]?.nodeId ?? null
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
   * `named`: a run over named Tickets (worfy-flight-recorder ticket 21): the Wave takes only those.
   * `continuation`: worfy's line over a Wave that continues stuck Tickets (worfy-stuck-agents ticket 05), put on
   * the text by waveWithContinuation before the brief.
   */
  autopilotWave(projectId: string, epic: string, resume: readonly number[] = [], brief = false, named?: readonly number[], continuation?: string): Promise<AutopilotWaveResult> {
    return this.sendWave(projectId, epic, true, resume, brief, named, continuation)
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

  private async sendWave(projectId: string, epic: string, autopilot: boolean, resumable: readonly number[] = [], brief = false, named?: readonly number[], continuation?: string): Promise<AutopilotWaveResult> {
    const root = this.deps.projectRoot(projectId)
    const [model, branch] = await Promise.all([this.model(root), this.deps.branch(root)])
    if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new Error(`The Project has no Epic ${epic}`)
    // One read: the text, the Tickets it names and the skipped ones all come from `model`.
    const state = runWaveState({ epic, tickets: model.tickets, template: this.deps.settings(projectId).actionTemplates.runWave, branch, autopilot, resumable, ...(named === undefined ? {} : { named }) })
    if (!state.enabled) throw new Error(state.reason)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const session = this.deps.registry.get(view.sessionId)
    const wave = continuation === undefined ? state.text : waveWithContinuation(state.text, continuation)
    const text = brief ? waveBriefText(epic, wave) : wave
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
  private bindWhenKnown(projectId: string, session: LaunchedSession, target: BindingTarget, ends: Ends = CLOSED): Promise<void> {
    const task = (async () => {
      await this.untilKnown(session, ends)
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
    return task
  }

  /**
   * Settles once Claude Code has reported the Session's id, the Session is in one of the states `ends`, or the wait is
   * over.
   */
  private async untilKnown(session: LaunchedSession, ends: Ends): Promise<void> {
    const pollMs = this.deps.pollMs ?? POLL_MS
    const until = Date.now() + (this.deps.waitMs ?? WAIT_MS)
    while (session.sdkId === null && !ends.has(session.state) && Date.now() < until) await delay(pollMs)
  }
}
