// The Orchestrator of each Project: its main Session (CONTEXT.md, "Orchestrator") and the locked
// Node that shows it on the Canvas.
//
// open() finds the Project's Orchestrator Node in the Layout or creates it, then starts the
// Session in the Project's root: a new one, or the SDK session saved in the Node's `data`, resumed.
//
// The Node's data keeps only the SDK session id and the summed cost (ADR-0010). The model, effort
// and permission mode the user picked (ticket 19) are kept under the Node id in worfy's data folder
// (session-settings.ts); the Session starts (and resumes) with them. Everything else the Node
// shows lives in memory, in the Orchestrator's view: the model and the last status block come from the saved session's transcript when the
// Orchestrator opens (orchestrator-transcript.ts) and then from the live Session's events; the
// state is the live Session's. Views go to the windows on `orchestrator.changed`.
//
// Autopilot (worfy-daily ticket 04, ADR-0024) runs the Orchestrator unattended for the time of a
// run (setUnattended): its Session is started again with the unattended launch (ADR-0022),
// continuing the same SDK session, and started again attended when the run ends — at once, or once
// a turn that still runs has ended and the Session has no live background task (ADR-0029: starting
// it again would kill them). The settings of an unattended Session are not saved: its forced
// bypassPermissions would overwrite the mode the user picked for the Node. Going unattended is
// refused while a turn runs (also the last turn of a run that was just stopped), while background
// tasks of an attended Session live and while messages wait in the queue. A stopped run's Session
// that still waits to be given back is taken over by the next run as it is, without a relaunch, so
// its tasks live on (worfy-polish ticket 50). Going back to attended carries the queue over
// to the new Session. Before each Wave after a run's first, Autopilot asks for a new SDK session of
// the unattended Orchestrator (newUnattendedSession, worfy-throughput ticket 52): the old Session
// closes, as on "New conversation", only while no turn, background task or queued message would be
// lost. Stop in Autopilot (worfy-week ticket 17, ADR-0050) gives the Orchestrator back
// at once instead (giveBackNow): its halted Session's process closes, and with it every background
// task and the turn the interrupt did not end.
//
// Every relaunch (worfy-week ticket 20, ADR-0064) starts the new Claude Code process only once the
// old one has exited (Session.exited: SIGKILL past the limit), so two processes never continue one
// SDK session. The new Session is live at once, `starting`, and holds what is sent to it meanwhile;
// setUnattended and giveBackNow answer once its process has started.
//
// The Orchestrator runs on the Project's defaultVendor (worfy-multi-vendor ticket 37), read when it
// starts — when it opens, and at "New conversation" — and kept for every relaunch, so Autopilot's
// unattended Session and the give-back continue the same Vendor's session. The Node's data names
// the Vendor of the saved session (ADR-0095); when the Project's Vendor is another one, the
// Orchestrator starts a new session on it rather than resuming one its agent does not know. The
// Node's data keeps the old session, its Vendor and its cost until the new session's first init, so
// a start that fails on the new Vendor (nobody signed in, no binary) leaves the old one resumable.
// The Node's picked model and effort, which were the other Vendor's, go back to "Default"; the
// permission setting stays, and the new Vendor's driver reads it as its own nearest one
// (SessionPart.settingsFor). Autopilot drives the Orchestrator of either Vendor the same way,
// through its Session, but only on a Vendor whose `harness` capability holds: the guarantees of the
// workflow (gate, guards, read-only reviewers) are proven there (unattendedRefusal).
import type { AgentEvent } from '../../shared/agent/events'
import { DEFAULT_SETTINGS, sameSettings, type SessionSettings } from '../../shared/agent/settings'
import { findStatusBlock } from '../../shared/agent/status-block'
import {
  ORCHESTRATOR_HEIGHT,
  ORCHESTRATOR_KIND,
  ORCHESTRATOR_WIDTH,
  readOrchestratorData,
  type OrchestratorData,
  type OrchestratorView,
} from '../../shared/ipc/orchestrator'
import type { LayoutNode, LayoutOpInput, LayoutState } from '../../shared/layout/types'
import type { Capabilities } from '../../shared/vendors/capabilities'
import { UNNAMED_VENDOR, vendorLabel, type VendorId } from '../../shared/vendors/vendor'
import { placeNewNode } from '../layout/place'
import type { TranscriptFacts } from './orchestrator-transcript'
import { closeRefusal } from './resume'
import { EXIT_WAIT_MS, type EventSink, type Session, type SessionRegistry } from './session'
import { ATTENDED, type SessionLaunch } from './session-settings'

/**
 * What the agent answers when asked to resume a session it has no transcript for: Claude Code (it
 * removes transcripts older than `cleanupPeriodDays`, 30 by default), and Codex's app-server for a
 * thread it has no rollout of (test/fixtures/codex-messages/resume.jsonl).
 */
const NO_CONVERSATION = /No conversation found with session ID|no rollout found for thread id/i

/**
 * Where a new Orchestrator Node goes: the top-left corner of the Canvas when no Node there takes
 * it, otherwise under every Node, so it never covers one (src/main/layout/place.ts).
 */
export function orchestratorPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  return placeNewNode(nodes, { w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT })
}

/**
 * The cost of a Session across the Claude Code processes that ran it. Claude Code reports
 * `total_cost_usd` per process, growing with every turn (test/fixtures/sdk-messages/controls.jsonl);
 * a new process — after a crash, or after a restart of the app — counts from zero again.
 */
export class CostCounter {
  private run = 0

  /** `base`: what the earlier processes cost, as kept in the Node's data. */
  constructor(private base: number) {}

  get total(): number {
    return this.base + this.run
  }

  /** A turn's `result`; answers the new total. */
  result(costUsd: number): number {
    // A smaller figure than the last one can only come from a new process.
    if (costUsd < this.run) this.processEnded()
    this.run = costUsd
    return this.total
  }

  /** The process died; the next one starts from zero. */
  processEnded(): void {
    this.base += this.run
    this.run = 0
  }
}

export interface OrchestratorDeps {
  layout: {
    get(projectId: string): LayoutState
    apply(projectId: string, op: LayoutOpInput): LayoutState
  }
  /** The Project's repository root; throws for a Project that is not in the list. */
  projectPath(projectId: string): string
  registry: Pick<SessionRegistry, 'start'>
  /** Where the picked model, effort and permission mode of a Node are kept (session-settings.ts). */
  settings: {
    read(projectId: string, nodeId: string): SessionSettings | undefined
    write(projectId: string, nodeId: string, settings: SessionSettings): void
  }
  /**
   * The Project's Vendor (its settings' `defaultVendor`, worfy-multi-vendor ticket 37), asked when the
   * Orchestrator starts. Absent, undefined or throwing: Claude Code.
   */
  vendor?(projectId: string): VendorId | undefined
  /**
   * The model and the last status block of a saved session of `vendor`, read from its transcript
   * (Claude Code's under the Claude home); null when the Project has no transcript of that session.
   */
  transcript(projectRoot: string, sdkSessionId: string, vendor: VendorId): Promise<TranscriptFacts | null>
  /**
   * What `vendor` can do (its driver's capabilities): Autopilot takes the Orchestrator only on a
   * Vendor whose `harness` holds (unattendedRefusal). Absent: no Vendor is refused.
   */
  capabilities?(vendor: VendorId): Promise<Pick<Capabilities, 'harness' | 'unsupported'>>
  /** Gets every event of every Orchestrator, e.g. to send it to the windows. */
  broadcast: EventSink
  /** Gets every new view, e.g. to send it to the windows. */
  publish(view: OrchestratorView): void
  /**
   * How long a Session waiting to be given back waits, after its last background task ended, for
   * the turn the task-notification starts (default RETURN_GRACE_MS).
   */
  returnGraceMs?: number
  /**
   * How long a relaunch waits for the old Session's Claude Code process to exit before it sends
   * SIGKILL (default EXIT_WAIT_MS, Session.exited).
   */
  exitWaitMs?: number
}

/** After the last background task of a Session waiting to be given back ended: the wait for its task-notification turn. */
export const RETURN_GRACE_MS = 30_000

/** One Session started for an Orchestrator; `current` turns false when another replaces it. */
interface Run {
  current: boolean
  /** The SDK session it was asked to resume. */
  resume: string | undefined
  /** Claude Code has reported the session (system/init): the resume, if any, worked. */
  initSeen: boolean
  /**
   * A new SDK session in place of the saved one (newUnattendedSession): the Node keeps the saved id
   * and cost until this Session's first init, so a give-back before it continues the saved session.
   */
  fresh: boolean
  session: Session | null
}

interface Entry {
  projectId: string
  nodeId: string
  path: string
  /** Set when the Project left the list before or while the Orchestrator started. */
  cancelled: boolean
  /** Settles once the first Session is started, or the start was given up. */
  ready: Promise<void>
  run: Run | null
  cost: CostCounter
  /** The session id last written to the Node's data. */
  savedSessionId: string | null
  /** The Vendor the Node's data names for that session (absent there: Claude Code). */
  savedVendor: VendorId
  /** Whose agent runs the Orchestrator's Sessions: the Project's Vendor as it was at the Orchestrator's start. */
  vendor: VendorId
  /** The settings last saved for the Node (or the defaults); every Session of the Orchestrator starts with them. */
  settings: SessionSettings
  /** How the current Session runs: unattended while Autopilot has the Orchestrator. */
  launch: SessionLaunch
  /** A launch to switch to once the running turn ends; null when none waits. */
  wanted: SessionLaunch | null
  /** The grace time after the last background task, before the waiting launch goes on without its turn; null when none runs. */
  grace: ReturnType<typeof setTimeout> | null
}

/** Why "New conversation" is refused while Autopilot runs the Orchestrator. */
export const AUTOPILOT_OWNS_ORCHESTRATOR = 'Autopilot runs this Orchestrator: stop Autopilot before starting a new conversation'

/** Why Autopilot cannot take the Orchestrator while a turn runs: starting its Session again would kill the turn. */
export const ORCHESTRATOR_IN_TURN = 'The Orchestrator is in a turn: wait for it to end, or Interrupt it, before starting Autopilot'

/** Why Autopilot cannot take the Orchestrator while messages wait in its queue: they were meant for a person's Session. */
export const ORCHESTRATOR_HAS_QUEUE = 'Messages wait in the Orchestrator\'s queue: send or remove them before starting Autopilot'

/** Why Autopilot cannot take the Orchestrator while its background tasks live: starting its Session again would kill them. */
export const ORCHESTRATOR_HAS_TASKS = 'The Orchestrator\'s background tasks are still running: wait for them to end before starting Autopilot'

/** Why the Orchestrator's Session cannot be started again now: a turn is running. */
const inTurn = (state: string): boolean => state === 'busy' || state === 'needs_permission'

/** The live background tasks of the Orchestrator's current Session (ADR-0029). */
const liveTasksOf = (entry: Entry): number => entry.run?.session?.backgroundTasks().length ?? 0

/** A stopped run's unattended Session that waits to be given back, for its turn or its background tasks. */
const awaitsGiveBack = (entry: Entry): boolean => entry.launch.unattended && entry.wanted !== null && !entry.wanted.unattended

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The running Orchestrators of the app, one per Project at most. */
export class Orchestrators {
  private readonly entries = new Map<string, Entry>()
  /** The last view of each Orchestrator Node, also after its Session closed. */
  private readonly views = new Map<string, OrchestratorView>()
  private version = 0

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Makes sure the Project has its Node and a running Session, and answers its view; a second call
   * while the Session runs (or starts) changes nothing. Rejects for a Project that is not in the
   * list, or that left it while the Orchestrator started. `firstSettings`: the picks a Node with
   * none saved starts with, saved for it (the Demo project's cheaper Orchestrator, worfy-onboarding
   * ticket 05); an Orchestrator already open, or a Node with saved picks, keeps its own.
   */
  async open(projectId: string, options: { firstSettings?: SessionSettings } = {}): Promise<OrchestratorView> {
    const path = this.deps.projectPath(projectId)
    let entry = this.entries.get(projectId)
    if (entry === undefined) {
      entry = this.begin(projectId, path, options.firstSettings)
      this.entries.set(projectId, entry)
    }
    await entry.ready
    const view = this.views.get(entry.nodeId)
    if (entry.cancelled || view === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    return view
  }

  /**
   * "New conversation" (ticket 18): the current Session closes and stays in the history as its
   * transcript; a new Session becomes the Project's Orchestrator, with its cost from zero. Refused
   * during a turn, like closing any Session (resume.ts).
   */
  async newConversation(projectId: string): Promise<OrchestratorView> {
    await this.open(projectId)
    const entry = this.entries.get(projectId)
    if (entry === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    if (entry.launch.unattended) throw new Error(AUTOPILOT_OWNS_ORCHESTRATOR)
    const refusal = closeRefusal(this.current(entry).state)
    if (refusal !== null) throw new Error(refusal)
    const old = entry.run
    if (old) {
      old.current = false
      old.session?.close()
    }
    // A new session is a start of the Orchestrator: it runs on the Project's Vendor as it is now. On
    // another Vendor the Node keeps the old session until the new one's first init.
    if (this.takeVendor(entry, this.vendorOf(projectId))) this.leaveSession(entry)
    else this.forgetSession(entry)
    this.launch(entry, undefined, { model: null, statusBlock: null })
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${projectId} has no view`)
    return view
  }

  /**
   * Autopilot (worfy-daily ticket 04): starts the Orchestrator's Session again unattended, or
   * attended again, continuing the same SDK session. Going unattended opens the Orchestrator first
   * and is refused while a turn runs — also an unattended turn left over from a stopped run — while
   * an attended Session has live background tasks, and while messages wait in the queue; a stopped
   * run's Session that still waits to be given back is kept as it is (worfy-polish ticket 50).
   * Going back to attended while a turn runs waits for the turn's end; the queue goes over to the
   * attended Session. Answers the view, after a relaunch once the new Session's process has started
   * (ADR-0064); for an Orchestrator that is not open, going attended does nothing.
   */
  async setUnattended(projectId: string, unattended: boolean): Promise<OrchestratorView | null> {
    if (!unattended) {
      const entry = this.entries.get(projectId)
      if (entry === undefined) return null
      await entry.ready
      if (this.entries.get(projectId) !== entry || entry.cancelled) return null
      if (!entry.launch.unattended) {
        entry.wanted = null
      } else if (inTurn(this.current(entry).state) || liveTasksOf(entry) > 0) {
        entry.wanted = ATTENDED
      } else {
        await this.relaunch(entry, ATTENDED)
      }
      return this.views.get(entry.nodeId) ?? null
    }
    // Before anything starts: a Vendor without the Harness's guarantees opens no Session for a run.
    const refusal = await this.unattendedRefusal(projectId)
    if (refusal !== null) throw new Error(refusal)
    await this.open(projectId)
    const entry = this.entries.get(projectId)
    if (entry === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    if (inTurn(this.current(entry).state)) throw new Error(ORCHESTRATOR_IN_TURN)
    // A stopped run's Session that waits to be given back — for its tasks, or for the turn the last
    // one's task-notification starts — is taken over as it runs, unattended: the give-back is called
    // off and nothing starts again, so its tasks live on (worfy-polish ticket 50). An attended
    // Session with live tasks is refused: starting it again unattended would kill them.
    if (!awaitsGiveBack(entry) && (liveTasksOf(entry) > 0 || entry.wanted !== null)) throw new Error(ORCHESTRATOR_HAS_TASKS)
    if ((entry.run?.session?.queued().items.length ?? 0) > 0) throw new Error(ORCHESTRATOR_HAS_QUEUE)
    entry.wanted = null
    // The grace time of the stopped run's give-back would otherwise fire into the new run's own one.
    this.cancelGrace(entry)
    if (!entry.launch.unattended) await this.relaunch(entry, { unattended: true })
    // The Project may have left the list while the old process was waited for.
    if (this.entries.get(projectId) !== entry || entry.cancelled) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${projectId} has no view`)
    return view
  }

  /**
   * Stop in Autopilot (worfy-week ticket 17, ADR-0050): starts the Orchestrator's Session again
   * attended at once, without waiting for a turn or background tasks — the Session has been halted
   * (Session.halt), and closing its process ends whatever outlived the interrupt. The queue goes
   * over held, as Session.halt left it. Answers the view once the new Session's process has started,
   * after the old one exited (ADR-0064); null for an Orchestrator that is not open.
   */
  async giveBackNow(projectId: string): Promise<OrchestratorView | null> {
    const entry = this.entries.get(projectId)
    if (entry === undefined) return null
    await entry.ready
    if (this.entries.get(projectId) !== entry || entry.cancelled) return null
    if (entry.launch.unattended) await this.relaunch(entry, ATTENDED)
    else entry.wanted = null
    return this.views.get(entry.nodeId) ?? null
  }

  /**
   * Autopilot's next Wave (worfy-throughput ticket 52): the unattended Orchestrator starts a new SDK
   * session instead of continuing the one of the last Wave. The old Session closes and stays in the
   * history as its transcript, as on "New conversation"; the new one runs unattended too, its cost
   * from zero. The Node keeps the old SDK session id and cost until the new session's first init
   * (after its first prompt): a give-back before that continues the old session. Only while the Orchestrator is free — no turn, no live background task, nothing in its
   * queue and no give-back waiting — since closing the old Session would end what runs there or
   * leave a person's message out; then, and for an Orchestrator that is not open or not unattended,
   * it does nothing and answers null. Otherwise answers the view once the new process has started.
   */
  async newUnattendedSession(projectId: string): Promise<OrchestratorView | null> {
    const entry = this.entries.get(projectId)
    if (entry === undefined) return null
    await entry.ready
    if (this.entries.get(projectId) !== entry || entry.cancelled || !entry.launch.unattended) return null
    if (inTurn(this.current(entry).state) || liveTasksOf(entry) > 0 || entry.wanted !== null) return null
    if ((entry.run?.session?.queued().items.length ?? 0) > 0) return null
    await this.relaunch(entry, entry.launch, true)
    // The Project may have left the list while the old process was waited for.
    if (this.entries.get(projectId) !== entry || entry.cancelled) return null
    return this.views.get(entry.nodeId) ?? null
  }

  /**
   * Why Autopilot may not take the Project's Orchestrator, or null: the Vendor its Session runs on —
   * the open Orchestrator's, else the Project's — lacks the `harness` capability, so the workflow's
   * guarantees are not proven there (worfy-multi-vendor ticket 37; ticket 39 adds the check that
   * turns it on for Codex). The reason is the capability's own; capabilities that cannot be read
   * refuse too. Without deps.capabilities, null.
   */
  async unattendedRefusal(projectId: string): Promise<string | null> {
    if (this.deps.capabilities === undefined) return null
    const vendor = this.entries.get(projectId)?.vendor ?? this.vendorOf(projectId)
    let capabilities: Pick<Capabilities, 'harness' | 'unsupported'>
    try {
      capabilities = await this.deps.capabilities(vendor)
    } catch (error) {
      console.warn(`[orchestrator] could not read what ${vendor} can do`, error)
      return `Autopilot did not start: worfy could not read what ${vendorLabel(vendor)} can do.`
    }
    if (capabilities.harness) return null
    return capabilities.unsupported.harness ?? `Autopilot does not run on ${vendorLabel(vendor)}: the Harness's guarantees are not proven there.`
  }

  /** Whether the Project's Orchestrator runs unattended now. */
  isUnattended(projectId: string): boolean {
    return this.entries.get(projectId)?.launch.unattended ?? false
  }

  /**
   * Whether `sessionId` is the unattended Session of an Orchestrator whose run has stopped and which
   * only waits to be given back, for its turn or its background tasks (worfy-polish ticket 50): no
   * run drives it, so a person may be at it again, and a new run takes it over (setUnattended).
   */
  awaitsGiveBack(sessionId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.run?.session?.id === sessionId) return awaitsGiveBack(entry)
    }
    return false
  }

  /** The last view of the Orchestrator behind a Node, or null. */
  view(nodeId: string): OrchestratorView | null {
    return this.views.get(nodeId) ?? null
  }

  /** Stops the Orchestrators of Projects that are no longer in the list. */
  retain(projectIds: ReadonlySet<string>): void {
    for (const [projectId, entry] of [...this.entries]) {
      if (projectIds.has(projectId)) continue
      this.entries.delete(projectId)
      entry.cancelled = true
      this.views.delete(entry.nodeId)
      const run = entry.run
      if (run) run.current = false
      run?.session?.close()
    }
  }

  private begin(projectId: string, path: string, firstSettings?: SessionSettings): Entry {
    const node = this.node(projectId)
    const saved = readOrchestratorData(node.data)
    const entry: Entry = {
      projectId,
      nodeId: node.id,
      path,
      cancelled: false,
      ready: Promise.resolve(),
      run: null,
      cost: new CostCounter(saved.costUsd ?? 0),
      savedSessionId: saved.sessionId ?? null,
      savedVendor: saved.vendor ?? UNNAMED_VENDOR,
      vendor: UNNAMED_VENDOR,
      settings: this.savedSettings(projectId, node.id, firstSettings),
      launch: ATTENDED,
      wanted: null,
      grace: null,
    }
    // A session of another Vendor than the Project's is not resumed: its agent does not know it.
    if (this.takeVendor(entry, this.vendorOf(projectId))) this.leaveSession(entry)
    entry.ready = this.start(entry)
    return entry
  }

  /**
   * The Node's saved picks; when there are none, `firstSettings` (saved for the Node) or the
   * defaults; the defaults also when they cannot be read, so the start goes on.
   */
  private savedSettings(projectId: string, nodeId: string, firstSettings?: SessionSettings): SessionSettings {
    let saved: SessionSettings | undefined
    try {
      saved = this.deps.settings.read(projectId, nodeId)
    } catch (error) {
      console.warn(`[orchestrator] could not read the saved settings of ${projectId}; starting with the defaults`, error)
      return DEFAULT_SETTINGS
    }
    if (saved !== undefined) return saved
    if (firstSettings === undefined) return DEFAULT_SETTINGS
    try {
      this.deps.settings.write(projectId, nodeId, firstSettings)
    } catch (error) {
      // The live Session keeps them; only the next start of the app loses them.
      console.warn(`[orchestrator] could not save the first settings of ${projectId}`, error)
    }
    return firstSettings
  }

  /** The Project's Vendor for its Orchestrator; Claude Code when it names none or cannot be read. */
  private vendorOf(projectId: string): VendorId {
    try {
      return this.deps.vendor?.(projectId) ?? UNNAMED_VENDOR
    } catch (error) {
      console.warn(`[orchestrator] could not read the Vendor of ${projectId}; starting on ${UNNAMED_VENDOR}`, error)
      return UNNAMED_VENDOR
    }
  }

  /**
   * The Orchestrator's next Session runs on `vendor`. Answers whether that is another Vendor than the
   * saved session's: the Node's picked model and effort were that Vendor's, so they go back to the
   * Vendor's default ("Default"), saved. The permission setting stays as saved: the new Vendor's
   * driver turns it into its own nearest one at the start (SessionPart.settingsFor: Claude Code's
   * bypassPermissions is Codex's full-access, and back), and the start's `settings` event saves that.
   */
  private takeVendor(entry: Entry, vendor: VendorId): boolean {
    entry.vendor = vendor
    if (vendor === entry.savedVendor) return false
    if (entry.settings.model !== null || entry.settings.effort !== null) {
      entry.settings = { ...entry.settings, model: null, effort: null }
      this.saveSettings(entry, entry.settings)
    }
    return true
  }

  /** Reads the saved session's transcript, then starts the Session: resumed, or new when it is gone. */
  private async start(entry: Entry): Promise<void> {
    let resume = entry.savedSessionId ?? undefined
    let facts: TranscriptFacts = { model: null, statusBlock: null }
    if (resume !== undefined) {
      try {
        const found = await this.deps.transcript(entry.path, resume, entry.vendor)
        if (found === null) {
          // Claude Code would refuse the resume, and every message after it.
          if (!entry.cancelled) this.forgetSession(entry)
          resume = undefined
        } else {
          facts = found
        }
      } catch (error) {
        // A transcript that cannot be read is not a missing one: keep the session and resume it.
        console.warn(`[orchestrator] could not read the transcript of ${resume}`, error)
      }
    }
    if (entry.cancelled) return
    this.launch(entry, resume, facts)
  }

  /** Starts the Orchestrator's Session; with `after`, its Claude Code process waits for `after` (relaunch). */
  private launch(entry: Entry, resume: string | undefined, facts: TranscriptFacts, after?: Promise<void>, fresh = false): void {
    const run: Run = { current: true, resume, initSeen: false, fresh, session: null }
    entry.run = run
    // The view goes first: the registry reports `starting` before start() returns.
    this.setView(entry, {
      projectId: entry.projectId,
      nodeId: entry.nodeId,
      sessionId: null,
      state: 'starting',
      error: null,
      vendor: entry.vendor,
      model: facts.model,
      costUsd: entry.cost.total,
      statusBlock: facts.statusBlock,
    })
    try {
      // Marked as the Orchestrator for its autocompact window; the launch kept in the entry stays as it is.
      const launch = { ...entry.launch, orchestrator: true }
      run.session = this.deps.registry.start(entry.path, resume, (sessionId, event) => this.onEvent(entry, run, sessionId, event), entry.settings, launch, after, entry.vendor)
    } catch (error) {
      // E.g. the session is already live in another Session; the next open tries again.
      run.current = false
      if (this.entries.get(entry.projectId) === entry) this.entries.delete(entry.projectId)
      this.setView(entry, { ...this.current(entry), state: 'error', error: messageOf(error) })
    }
  }

  private onEvent(entry: Entry, run: Run, sessionId: string, event: AgentEvent): void {
    if (run.current) this.apply(entry, run, sessionId, event)
    try {
      this.deps.broadcast(sessionId, event)
    } catch (error) {
      console.warn('[orchestrator] could not send an event to the windows', error)
    }
  }

  /** What one event of the current Session changes: the view, the Node's data for the session id and cost, and the saved settings. */
  private apply(entry: Entry, run: Run, sessionId: string, event: AgentEvent): void {
    const next = { ...this.current(entry), sessionId }
    switch (event.type) {
      case 'init':
        next.model = event.model
        if ((run.fresh && !run.initSeen) || entry.vendor !== entry.savedVendor) {
          // The new session is the Node's from now on, its cost from zero: a new SDK session
          // (newUnattendedSession), or the first session on the Project's new Vendor (leaveSession),
          // whose Vendor the Node then names.
          run.initSeen = true
          const vendor = entry.vendor === entry.savedVendor ? {} : { vendor: entry.vendor }
          entry.savedSessionId = event.sdkSessionId
          entry.savedVendor = entry.vendor
          entry.cost = new CostCounter(0)
          next.costUsd = 0
          this.patch(entry, { sessionId: event.sdkSessionId, costUsd: 0, ...vendor })
          break
        }
        run.initSeen = true
        if (event.sdkSessionId !== entry.savedSessionId) {
          entry.savedSessionId = event.sdkSessionId
          this.patch(entry, { sessionId: event.sdkSessionId })
        }
        break
      case 'state':
        next.state = event.state
        next.error = event.error
        if (event.state === 'error') {
          entry.cost.processEnded()
          if (run.resume !== undefined && !run.initSeen && NO_CONVERSATION.test(event.error ?? '')) {
            this.startOver(entry, run)
            return
          }
        }
        if (event.state === 'closed' && this.entries.get(entry.projectId) === entry) this.entries.delete(entry.projectId)
        if ((event.state === 'idle' || event.state === 'error') && entry.wanted !== null) this.relaunchLater(entry, run)
        break
      case 'settings':
        // The forced bypassPermissions of an unattended Session is not the user's pick (ADR-0022).
        if (entry.launch.unattended) break
        if (!sameSettings(entry.settings, event.settings)) {
          entry.settings = event.settings
          this.saveSettings(entry, event.settings)
        }
        break
      case 'background_tasks':
        // The last task ended: its task-notification starts a turn, which the relaunch waits for;
        // when none comes within the grace time, the relaunch goes on without it.
        if (event.tasks.length === 0 && entry.wanted !== null) this.relaunchAfterGrace(entry, run)
        break
      case 'result':
        next.costUsd = entry.cost.result(event.costUsd)
        // A result follows its Session's init on both Vendors (Claude Code's system init, Codex's
        // turn/started), so the Node already names the new Vendor's session here (leaveSession).
        this.patch(entry, { costUsd: next.costUsd })
        break
      case 'text': {
        // Only the Orchestrator's own answers: not a subagent's, and not text Claude Code wrote.
        if (event.parentToolUseId !== null || event.synthetic) break
        const block = findStatusBlock(event.text)
        if (block !== null) next.statusBlock = block.text
        break
      }
      default:
        // Nothing to show, but a `renamed` event carries the Session's final id.
        break
    }
    this.setView(entry, next)
  }

  /**
   * Claude Code refused to resume the saved session: its transcript is gone. The Orchestrator
   * starts a new session in a new Session, rather than failing every message the same way.
   */
  private startOver(entry: Entry, failed: Run): void {
    console.warn(`[orchestrator] ${failed.resume ?? ''} cannot be resumed; ${entry.projectId} starts a new session`)
    failed.current = false
    failed.session?.close()
    this.forgetSession(entry)
    this.launch(entry, undefined, { model: null, statusBlock: null })
  }

  /**
   * Starts the Orchestrator's Session again with `launch`, continuing the saved SDK session. What
   * waits in the old Session's queue goes over to the new one, held as it was. The old Session's
   * error is not carried: the new Session starts a new Claude Code process — once the old one has
   * exited (ADR-0064). The new Session is live at once and holds what is sent to it until then; a
   * second relaunch meanwhile closes it before it started, so it waits for the same old process.
   * Settles once the new process has started (or the new Session was closed first); never rejects.
   * `fresh`: a new SDK session instead (newUnattendedSession), with no status block; the saved id and
   * the cost go only at its first init (Run.fresh).
   */
  private relaunch(entry: Entry, launch: SessionLaunch, fresh = false): Promise<void> {
    entry.wanted = null
    entry.launch = launch
    const old = entry.run
    const queue = old?.session?.handOverQueue() ?? { items: [], paused: false }
    let oldExit: Promise<void> | undefined
    if (old) {
      old.current = false
      old.session?.close()
      oldExit = old.session?.exited(this.deps.exitWaitMs ?? EXIT_WAIT_MS)
    }
    // A new Claude Code process reports its cost from zero.
    entry.cost.processEnded()
    const view = this.current(entry)
    if (fresh) this.launch(entry, undefined, { model: view.model, statusBlock: null }, oldExit, true)
    else this.launch(entry, entry.savedSessionId ?? undefined, { model: view.model, statusBlock: view.statusBlock }, oldExit)
    const next = entry.run
    if (next === null || next === old || next.session === null) return oldExit ?? Promise.resolve()
    if (queue.items.length > 0) {
      try {
        next.session.adoptQueue(queue)
      } catch (error) {
        console.warn(`[orchestrator] could not carry the queue of ${entry.projectId} over`, error)
      }
    }
    return next.session.started()
  }

  /**
   * The launch that waited for the turn's end: applied after the Session has finished handling
   * the event that ended the turn (it may start a queued turn right after, which waits again).
   */
  private relaunchLater(entry: Entry, run: Run): void {
    queueMicrotask(() => this.relaunchIfFree(entry, run))
  }

  /** The waiting launch, once the Session has neither a turn nor a live background task. */
  private relaunchIfFree(entry: Entry, run: Run): void {
    const wanted = entry.wanted
    if (wanted === null || entry.run !== run || !run.current || entry.cancelled) return
    if (inTurn(this.current(entry).state) || liveTasksOf(entry) > 0) return
    void this.relaunch(entry, wanted)
  }

  private relaunchAfterGrace(entry: Entry, run: Run): void {
    this.cancelGrace(entry)
    const timer = setTimeout(() => {
      if (entry.grace === timer) entry.grace = null
      this.relaunchIfFree(entry, run)
    }, this.deps.returnGraceMs ?? RETURN_GRACE_MS)
    entry.grace = timer
    // A relaunch that never comes due must not keep the app (or a test) alive.
    ;(timer as { unref?: () => void }).unref?.()
  }

  /**
   * Drops the grace time that runs, if any (worfy-polish ticket 50): a new run took the Session
   * over, or a later last task starts its own. An older one would otherwise give the Session back
   * before the turn of the task that ended last.
   */
  private cancelGrace(entry: Entry): void {
    if (entry.grace !== null) clearTimeout(entry.grace)
    entry.grace = null
  }

  /**
   * The Orchestrator moves to another Vendor (takeVendor): its next Session is a new one, its cost from
   * zero, but the Node's data keeps the old session, Vendor and cost until the new session's first
   * init (apply). A start that fails on the new Vendor leaves the old session resumable.
   */
  private leaveSession(entry: Entry): void {
    entry.savedSessionId = null
    entry.cost = new CostCounter(0)
  }

  /**
   * A new session: no id to resume, and its cost starts from zero. Its Vendor is the Orchestrator's,
   * written to the Node's data when the data named another one.
   */
  private forgetSession(entry: Entry): void {
    entry.savedSessionId = null
    entry.cost = new CostCounter(0)
    const vendor = entry.vendor === entry.savedVendor ? {} : { vendor: entry.vendor }
    entry.savedVendor = entry.vendor
    this.patch(entry, { sessionId: null, costUsd: 0, ...vendor })
  }

  private current(entry: Entry): Omit<OrchestratorView, 'version'> {
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${entry.projectId} has no view`)
    return view
  }

  private setView(entry: Entry, view: Omit<OrchestratorView, 'version'>): void {
    if (entry.cancelled) return
    const before = this.views.get(entry.nodeId)
    if (before !== undefined && sameView(before, view)) return
    this.version += 1
    const next: OrchestratorView = { ...view, version: this.version }
    this.views.set(entry.nodeId, next)
    try {
      this.deps.publish(next)
    } catch (error) {
      console.warn('[orchestrator] could not send a view to the windows', error)
    }
  }

  /** The Project's Orchestrator Node: the first Node of the kind, or a new locked one. */
  private node(projectId: string): LayoutNode {
    const { layout } = this.deps.layout.get(projectId)
    const existing = layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND)
    if (existing) return existing
    const { x, y } = orchestratorPlace(layout.nodes)
    const after = this.deps.layout.apply(projectId, {
      op: 'create',
      node: { kind: ORCHESTRATOR_KIND, x, y, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT, locked: true, data: {} },
    })
    const created = after.layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND)
    if (!created) throw new Error(`the Orchestrator Node of ${projectId} was not created`)
    return created
  }

  private saveSettings(entry: Entry, settings: SessionSettings): void {
    try {
      this.deps.settings.write(entry.projectId, entry.nodeId, settings)
    } catch (error) {
      // The live Session keeps the picks; only the next start of the app loses them.
      console.warn(`[orchestrator] could not save the settings of ${entry.projectId}`, error)
    }
  }

  private patch(entry: Entry, data: Partial<OrchestratorData>): void {
    try {
      this.deps.layout.apply(entry.projectId, { op: 'patchData', id: entry.nodeId, data })
    } catch (error) {
      // The Project was removed from the list while its Session still reported.
      console.warn(`[orchestrator] could not update the Node of ${entry.projectId}`, error)
    }
  }
}

function sameView(a: Omit<OrchestratorView, 'version'>, b: Omit<OrchestratorView, 'version'>): boolean {
  return (
    a.projectId === b.projectId &&
    a.nodeId === b.nodeId &&
    a.sessionId === b.sessionId &&
    a.state === b.state &&
    a.error === b.error &&
    a.vendor === b.vendor &&
    a.model === b.model &&
    a.costUsd === b.costUsd &&
    a.statusBlock === b.statusBlock
  )
}
