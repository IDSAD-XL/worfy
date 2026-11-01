// The start of Autopilot from a chat (worfy-flight-recorder ticket 21, ADR-0091): the one entry point of
// the command typed in a chat (`/worfy:epic-wave …`, ticket 22) and of the Orchestrator's tool
// `autopilot_start` (ticket 23). Both start the same run as the Autopilot button (run.ts,
// Autopilot.start), over the whole Epic or over named Tickets.
//
// - The Epic must be one of the Project's and every named Ticket one of the Epic's (startRefusal):
//   otherwise the answer is a refusal that names it.
// - While a run of the Project goes on or starts the answer is a refusal with chatRunningHint; while
//   a start from a chat waits for its turn's end, with chatWaitingHint. Nothing reaches the journal:
//   there is no run.
// - Asked from a running turn of the Project's own Orchestrator (the tool), the run cannot start yet:
//   Autopilot.start refuses an Orchestrator in a turn. Before it promises AFTER_TURN_MESSAGE it asks
//   every refusal it can know now: the Orchestrator's live background tasks and queued messages
//   (orchestratorRefusal), and Autopilot.startCheck (the template, the workflow, a run elsewhere).
//   Then the run starts once that Session is idle; a Session that closes or fails first starts
//   nothing. A refusal that comes only then is told on the Orchestrator's Session as a notice
//   (lateRefusalNotice), since the tool's answer has gone.
// - Who started the run (`command` or `tool`) goes to Autopilot.start, which keeps it on the run;
//   the journal gets it with ticket 11. So does the Run mode the person chose in the tool's dialog
//   (worfy-resource-planner ticket 06); a command typed in a chat names none and starts in the default
//   mode of Settings, as the Autopilot button does.
import type { AgentEvent, SessionState } from '../../shared/agent/events'
import type { BackgroundTask } from '../../shared/agent/background-tasks'
import type { RunMode } from '../../shared/autopilot/run-mode'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import type { WorkflowModel } from '../../shared/workflow/types'
import { ORCHESTRATOR_HAS_QUEUE, ORCHESTRATOR_HAS_TASKS } from '../agent/orchestrator'
import { startRefusal, type Autopilot, type AutopilotStartOptions } from './run'

/** What the Orchestrator's tool answers when the run waits for the end of the turn that asked. */
export const AFTER_TURN_MESSAGE = 'Autopilot starts after this turn'

/** The refusal of a start from a chat while a run of `epic` goes on in the Project (as "Run wave" by hand is refused). */
export const chatRunningHint = (epic: string): string => `Autopilot is already running Epic ${epic}. Stop it first.`

/** The refusal while a start of `epic` from a chat waits for the end of the Orchestrator's turn: there is no run to stop yet. */
export const chatWaitingHint = (epic: string): string => `Autopilot is about to start Epic ${epic} after the Orchestrator's turn.`

/** What the Orchestrator's Session shows when the start promised after its turn is refused then. */
export const lateRefusalNotice = (epic: string, message: string): string => `Autopilot did not start Epic ${epic}: ${message}`

/** Why the Orchestrator could not go unattended once its turn ends, as Orchestrators.setUnattended says it; null when it could. */
export function orchestratorRefusal(session: { backgroundTasks(): readonly BackgroundTask[]; queued(): { items: readonly unknown[] } }): string | null {
  if (session.backgroundTasks().length > 0) return ORCHESTRATOR_HAS_TASKS
  if (session.queued().items.length > 0) return ORCHESTRATOR_HAS_QUEUE
  return null
}

export interface ChatStartRequest {
  projectId: string
  epic: string
  /** A run over these Tickets of the Epic only; absent: the whole Epic. */
  tickets?: readonly number[]
  /** A command typed in a chat, or the Orchestrator's tool. */
  by: 'command' | 'tool'
  /** The Session whose turn asked, when known: the Project's Orchestrator in a turn makes the run wait for its end. */
  session?: string | null
  /**
   * The Run mode the person chose in the dialog of the tool (worfy-resource-planner ticket 06); absent:
   * the default mode of Settings at the start. A command typed in a chat names none.
   */
  mode?: RunMode
}

export type ChatStartAnswer =
  /** The run has started: its first state. */
  | { kind: 'started'; state: AutopilotState }
  /** The run starts once the Orchestrator's turn is over (AFTER_TURN_MESSAGE). */
  | { kind: 'after-turn'; message: string }
  /** Nothing started, and why in words. */
  | { kind: 'refused'; message: string }

export interface ChatStartDeps {
  autopilot: Pick<Autopilot, 'runningEpic' | 'startCheck'> & { start(projectId: string, epic: string, options?: AutopilotStartOptions): Promise<AutopilotState> }
  /** A fresh read of the Project's workflow model; throws for a Project that is not in the list. */
  workflow(projectId: string): Promise<WorkflowModel>
  /** The Session of the Project's Orchestrator; null when it has none. */
  orchestratorSession(projectId: string): Promise<string | null>
  /** Whether the Session runs a turn now. */
  inTurn(sessionId: string): boolean
  /** Settles once the Session is idle: true; false when it closed or failed first (whenIdle). */
  whenIdle(sessionId: string): Promise<boolean>
  /** Why the Orchestrator behind this Session could not go unattended after its turn (orchestratorRefusal); null when it could. */
  orchestratorRefusal(sessionId: string): string | null
  /** Shows `text` on the Session as a notice; a Session that is gone shows nothing. */
  notify(sessionId: string, text: string): void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The starts from a chat of the app; one per app, as the Autopilot it starts. */
export class ChatStarts {
  /** Projects whose start waits for the end of their Orchestrator's turn, with the Epic; each entry its own object. */
  private readonly waiting = new Map<string, { epic: string }>()

  constructor(private readonly deps: ChatStartDeps) {}

  /** Checks the Epic and the Tickets, refuses while a run goes on, and starts the run, now or after the asking turn. */
  async startFromChat(request: ChatStartRequest): Promise<ChatStartAnswer> {
    const { projectId, epic, tickets, by, mode } = request
    const busy = this.busy(projectId)
    if (busy !== null) return { kind: 'refused', message: busy }
    let model: WorkflowModel
    try {
      model = await this.deps.workflow(projectId)
    } catch (error) {
      return { kind: 'refused', message: messageOf(error) }
    }
    if (model.error !== null) return { kind: 'refused', message: `Cannot read the workflow: ${model.error.message}` }
    const refusal = startRefusal(model, epic, tickets)
    if (refusal !== null) return { kind: 'refused', message: refusal }
    // The same arguments as the button's start (src/main/ipc/autopilot.ts), with the list, who asked and the mode.
    const options: AutopilotStartOptions = { override: false, by, ...(tickets === undefined ? {} : { tickets }), ...(mode === undefined ? {} : { mode }) }

    const session = request.session ?? null
    let ownTurn: boolean
    try {
      ownTurn = session !== null && this.deps.inTurn(session) && session === (await this.deps.orchestratorSession(projectId))
    } catch (error) {
      return { kind: 'refused', message: messageOf(error) }
    }
    if (session !== null && ownTurn) return this.startAfterTurn(session, projectId, epic, options)
    try {
      return { kind: 'started', state: await this.deps.autopilot.start(projectId, epic, options) }
    } catch (error) {
      // A start of another click or ask got there first: the same hint as above.
      return { kind: 'refused', message: this.busy(projectId) ?? messageOf(error) }
    }
  }

  /**
   * Asked in the turn of the Project's Orchestrator: every refusal known now, then the promise to
   * start after the turn. Nothing is awaited between the last check and the note in `waiting`, so a
   * second ask sees it.
   */
  private async startAfterTurn(session: string, projectId: string, epic: string, options: AutopilotStartOptions): Promise<ChatStartAnswer> {
    const orchestrator = this.deps.orchestratorRefusal(session)
    if (orchestrator !== null) return { kind: 'refused', message: orchestrator }
    const check = await this.deps.autopilot.startCheck(projectId, epic, options)
    // Asked again, or the button pressed, while the checks were read.
    const busy = this.busy(projectId)
    if (busy !== null) return { kind: 'refused', message: busy }
    if (check !== null) return { kind: 'refused', message: check }
    const entry = { epic }
    this.waiting.set(projectId, entry)
    void this.afterTurn(session, projectId, entry, options)
    return { kind: 'after-turn', message: AFTER_TURN_MESSAGE }
  }

  /** busy() for the Orchestrator's tool, which asks it before its dialog (chat-confirm.ts, ticket 23). */
  busyRefusal(projectId: string): string | null {
    return this.busy(projectId)
  }

  /** Why a start from a chat is refused now for a run under way or a start waiting for a turn's end; null when none. */
  private busy(projectId: string): string | null {
    const running = this.deps.autopilot.runningEpic(projectId)
    if (running !== null) return chatRunningHint(running)
    const waiting = this.waiting.get(projectId)
    return waiting === undefined ? null : chatWaitingHint(waiting.epic)
  }

  /**
   * Starts the run once the Orchestrator's turn is over. The tool has answered already, so a refusal
   * then is told on the Orchestrator's Session (lateRefusalNotice) and logged.
   */
  private async afterTurn(session: string, projectId: string, entry: { epic: string }, options: AutopilotStartOptions): Promise<void> {
    const { epic } = entry
    // Only this start's own note: a later ask may have put its own by the time this one ends.
    const forget = () => {
      if (this.waiting.get(projectId) === entry) this.waiting.delete(projectId)
    }
    try {
      if (!(await this.deps.whenIdle(session))) return
      // Autopilot.start counts the run as starting before its first await: no gap for a second ask.
      forget()
      await this.deps.autopilot.start(projectId, epic, options)
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: the start asked in the Orchestrator's turn did not go`, error)
      try {
        this.deps.notify(session, lateRefusalNotice(epic, messageOf(error)))
      } catch (failed) {
        console.warn(`[autopilot] ${projectId}: could not tell the Orchestrator's Session`, failed)
      }
    } finally {
      forget()
    }
  }
}

/** The Sessions as whenIdle reads them (MessageRegistry). */
export interface IdleRegistry {
  get(sessionId: string): { state: SessionState }
  observe(sink: (sessionId: string, event: AgentEvent) => void): () => void
}

/**
 * Settles once the Session is idle: at once when it is now; false when it is gone, or closes or
 * fails before it is idle.
 */
export function whenIdle(registry: IdleRegistry, sessionId: string): Promise<boolean> {
  let state: SessionState
  try {
    state = registry.get(sessionId).state
  } catch {
    return Promise.resolve(false)
  }
  if (state === 'idle') return Promise.resolve(true)
  if (state === 'closed' || state === 'error') return Promise.resolve(false)
  return new Promise((done) => {
    const stop = registry.observe((id, event) => {
      if (id !== sessionId || event.type !== 'state') return
      if (event.state !== 'idle' && event.state !== 'closed' && event.state !== 'error') return
      stop()
      done(event.state === 'idle')
    })
  })
}
