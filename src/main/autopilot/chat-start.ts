// The start of Autopilot from a chat (worfy-flight-recorder ticket 21, ADR-0091): the one entry point of
// the command typed in a chat (`/worfy:epic-wave …`, ticket 22) and of the Orchestrator's tool
// `autopilot_start` (ticket 23). Both start the same run as the Autopilot button (run.ts,
// Autopilot.start), over the whole Epic or over named Tickets.
//
// - The Epic must be one of the Project's and every named Ticket one of the Epic's (startRefusal):
//   otherwise the answer is a refusal that names it.
// - While a run of the Project goes on or starts — or a start from a chat waits for its turn's end —
//   the answer is a refusal with chatRunningHint. Nothing reaches the journal: there is no run.
// - Asked from a running turn of the Project's own Orchestrator (the tool), the run cannot start yet:
//   Autopilot.start refuses an Orchestrator in a turn. The answer is AFTER_TURN_MESSAGE, and the run
//   starts once that Session is idle; a Session that closes or fails first starts nothing.
// - Who started the run (`command` or `tool`) goes to Autopilot.start, which keeps it on the run;
//   the journal gets it with ticket 11.
import type { AgentEvent, SessionState } from '../../shared/agent/events'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import type { WorkflowModel } from '../../shared/workflow/types'
import { startRefusal, type Autopilot, type AutopilotStartOptions } from './run'

/** What the Orchestrator's tool answers when the run waits for the end of the turn that asked. */
export const AFTER_TURN_MESSAGE = 'Autopilot starts after this turn'

/** The refusal of a start from a chat while a run of `epic` goes on in the Project (as "Run wave" by hand is refused). */
export const chatRunningHint = (epic: string): string => `Autopilot is already running Epic ${epic}. Stop it first.`

export interface ChatStartRequest {
  projectId: string
  epic: string
  /** A run over these Tickets of the Epic only; absent: the whole Epic. */
  tickets?: readonly number[]
  /** A command typed in a chat, or the Orchestrator's tool. */
  by: 'command' | 'tool'
  /** The Session whose turn asked, when known: the Project's Orchestrator in a turn makes the run wait for its end. */
  session?: string | null
}

export type ChatStartAnswer =
  /** The run has started: its first state. */
  | { kind: 'started'; state: AutopilotState }
  /** The run starts once the Orchestrator's turn is over (AFTER_TURN_MESSAGE). */
  | { kind: 'after-turn'; message: string }
  /** Nothing started, and why in words. */
  | { kind: 'refused'; message: string }

export interface ChatStartDeps {
  autopilot: Pick<Autopilot, 'runningEpic'> & { start(projectId: string, epic: string, options?: AutopilotStartOptions): Promise<AutopilotState> }
  /** A fresh read of the Project's workflow model; throws for a Project that is not in the list. */
  workflow(projectId: string): Promise<WorkflowModel>
  /** The Session of the Project's Orchestrator; null when it has none. */
  orchestratorSession(projectId: string): Promise<string | null>
  /** Whether the Session runs a turn now. */
  inTurn(sessionId: string): boolean
  /** Settles once the Session is idle: true; false when it closed or failed first (whenIdle). */
  whenIdle(sessionId: string): Promise<boolean>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The starts from a chat of the app; one per app, as the Autopilot it starts. */
export class ChatStarts {
  /** Projects whose start waits for the end of their Orchestrator's turn, with the Epic. */
  private readonly waiting = new Map<string, string>()

  constructor(private readonly deps: ChatStartDeps) {}

  /** Checks the Epic and the Tickets, refuses while a run goes on, and starts the run, now or after the asking turn. */
  async startFromChat(request: ChatStartRequest): Promise<ChatStartAnswer> {
    const { projectId, epic, tickets, by } = request
    const busy = this.busyEpic(projectId)
    if (busy !== null) return { kind: 'refused', message: chatRunningHint(busy) }
    let model: WorkflowModel
    try {
      model = await this.deps.workflow(projectId)
    } catch (error) {
      return { kind: 'refused', message: messageOf(error) }
    }
    if (model.error !== null) return { kind: 'refused', message: `Cannot read the workflow: ${model.error.message}` }
    const refusal = startRefusal(model, epic, tickets)
    if (refusal !== null) return { kind: 'refused', message: refusal }
    // The same arguments as the button's start (src/main/ipc/autopilot.ts), with the list and who asked.
    const options: AutopilotStartOptions = { override: false, by, ...(tickets === undefined ? {} : { tickets }) }

    const session = request.session ?? null
    if (session !== null && this.deps.inTurn(session) && session === (await this.deps.orchestratorSession(projectId))) {
      // Asked again while the Orchestrator's Session was read.
      const again = this.busyEpic(projectId)
      if (again !== null) return { kind: 'refused', message: chatRunningHint(again) }
      this.waiting.set(projectId, epic)
      void this.afterTurn(session, projectId, epic, options)
      return { kind: 'after-turn', message: AFTER_TURN_MESSAGE }
    }
    try {
      return { kind: 'started', state: await this.deps.autopilot.start(projectId, epic, options) }
    } catch (error) {
      // A start of another click or ask got there first: the same hint as above.
      const running = this.busyEpic(projectId)
      return { kind: 'refused', message: running !== null ? chatRunningHint(running) : messageOf(error) }
    }
  }

  /** The Epic of the Project's run that goes on or starts, or of a start that waits for a turn's end; null when none. */
  private busyEpic(projectId: string): string | null {
    return this.deps.autopilot.runningEpic(projectId) ?? this.waiting.get(projectId) ?? null
  }

  /** Starts the run once the Orchestrator's turn is over; no one waits for the answer, so a refusal is logged. */
  private async afterTurn(session: string, projectId: string, epic: string, options: AutopilotStartOptions): Promise<void> {
    try {
      if (!(await this.deps.whenIdle(session))) return
      this.waiting.delete(projectId)
      await this.deps.autopilot.start(projectId, epic, options)
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: the start asked in the Orchestrator's turn did not go`, error)
    } finally {
      this.waiting.delete(projectId)
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
