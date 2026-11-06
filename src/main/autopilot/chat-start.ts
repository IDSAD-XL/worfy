// The start of Autopilot from a chat (worfy-flight-recorder ticket 21, ADR-0091): the one entry point of
// the command typed in a chat (`/worfy:epic-wave …`, ticket 22) and of the Orchestrator's tool
// `autopilot_start` (ticket 23). Both start the same run as the Autopilot button (run.ts,
// Autopilot.start), over the whole Epic or over named Tickets.
//
// - The Epic must be one of the Project's and every named Ticket one of the Epic's (startRefusal):
//   otherwise the answer is a refusal that names it.
// - A start may name a queue of Epics (`epics`, worfy-autopilot-queue ticket 15, ADR-0100): the
//   command `epics A, B` or `accepted` and the tool's `epics`. Every Epic of it must be the Project's;
//   the queue goes to Autopilot.start as its `epics` (the first is `epic`), which checks it again.
// - While a run of the Project goes on, starts or waits for its Orchestrator the answer is a refusal
//   with chatRunningHint, which points to "Add to queue…": neither the command nor the tool adds an Epic
//   to a run's queue (the spec's decision 4 made without the owner). Nothing reaches the journal: there
//   is no new run.
// - A busy Orchestrator — also the one whose turn asked, through the tool — is no refusal: the run is
//   accepted and waits for it, as a start by the button does (worfy-autopilot-queue ticket 07,
//   ADR-0099), and the answer is WAIT_MESSAGE. A refusal that comes only when the run takes the
//   Orchestrator (`start-refused`) is told on the Session that asked as a notice (lateRefusalNotice),
//   since the answer has gone; a start whose Session is not known tells no one.
// - Who started the run (`command` or `tool`) goes to Autopilot.start, which keeps it on the run;
//   the journal gets it with ticket 11. So does the Run mode the person chose in the tool's dialog
//   (worfy-resource-planner ticket 06); a command typed in a chat names none and starts in the default
//   mode of Settings, as the Autopilot button does.
import type { RunMode } from '../../shared/autopilot/run-mode'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import type { WorkflowModel } from '../../shared/workflow/types'
import { startRefusal, type Autopilot, type AutopilotStartOptions } from './run'

/** What a start from a chat answers when the run waits for the busy Orchestrator (worfy-autopilot-queue ticket 07). */
export const WAIT_MESSAGE = 'Autopilot waits for the Orchestrator and starts when it is free'

/** The refusal of a start from a chat while a run of `epic` goes on in the Project (as "Run wave" by hand is refused). */
export const chatRunningHint = (epic: string): string =>
  `Autopilot is already running Epic ${epic}. Stop it first, or add Epics to its queue with "Add to queue…" in the ⋯ menu.`

/** What the Session that asked shows when the run that waited for the Orchestrator is refused once it is free. */
export const lateRefusalNotice = (epic: string, message: string): string => `Autopilot did not start Epic ${epic}: ${message}`

export interface ChatStartRequest {
  projectId: string
  epic: string
  /** A run over these Tickets of the Epic only; absent: the whole Epic. */
  tickets?: readonly number[]
  /**
   * A run over this queue of Epics, in order, the first being `epic` (worfy-autopilot-queue ticket 15);
   * never with `tickets` when more than one. Absent: the Epic alone.
   */
  epics?: readonly string[]
  /** A command typed in a chat, or the Orchestrator's tool. */
  by: 'command' | 'tool'
  /** The Session whose turn asked, when known: a refusal after the answer is told there. */
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
  /**
   * The run is accepted and waits for the busy Orchestrator (WAIT_MESSAGE). The kind keeps its name
   * from ADR-0091, when only the end of the asking turn was waited for: the tool and the chat's toast read it.
   */
  | { kind: 'after-turn'; message: string }
  /** Nothing started, and why in words. */
  | { kind: 'refused'; message: string }

export interface ChatStartDeps {
  autopilot: Pick<Autopilot, 'runningEpic'> & { start(projectId: string, epic: string, options?: AutopilotStartOptions): Promise<AutopilotState> }
  /** A fresh read of the Project's workflow model; throws for a Project that is not in the list. */
  workflow(projectId: string): Promise<WorkflowModel>
  /** Shows `text` on the Session as a notice; a Session that is gone shows nothing. */
  notify(sessionId: string, text: string): void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The starts from a chat of the app; one per app, as the Autopilot it starts. */
export class ChatStarts {
  constructor(private readonly deps: ChatStartDeps) {}

  /** Checks the Epic and the Tickets, refuses while a run goes on, and starts the run, now or once the Orchestrator is free. */
  async startFromChat(request: ChatStartRequest): Promise<ChatStartAnswer> {
    const { projectId, epic, tickets, epics, by, mode } = request
    const busy = this.busy(projectId)
    if (busy !== null) return { kind: 'refused', message: busy }
    let model: WorkflowModel
    try {
      model = await this.deps.workflow(projectId)
    } catch (error) {
      return { kind: 'refused', message: messageOf(error) }
    }
    if (model.error !== null) return { kind: 'refused', message: `Cannot read the workflow: ${model.error.message}` }
    const queue = epics ?? [epic]
    // Every Epic of the queue, each told in the order named: a refusal names the first the Project has not.
    for (const each of queue) {
      const refusal = startRefusal(model, each, each === epic ? tickets : undefined)
      if (refusal !== null) return { kind: 'refused', message: refusal }
    }
    const session = request.session ?? null
    // The same arguments as the button's start (src/main/ipc/autopilot.ts), with the list, who asked and the mode.
    const options: AutopilotStartOptions = {
      override: false,
      by,
      ...(tickets === undefined ? {} : { tickets }),
      // A queue of one is the Epic alone: the run and its journal are as before the queue (ADR-0100).
      ...(queue.length > 1 ? { epics: queue } : {}),
      ...(mode === undefined ? {} : { mode }),
      ...(session === null ? {} : { onLateRefusal: (message: string) => this.tell(projectId, session, lateRefusalNotice(epic, message)) }),
    }
    try {
      const state = await this.deps.autopilot.start(projectId, epic, options)
      return state.waitingFor === 'orchestrator' ? { kind: 'after-turn', message: WAIT_MESSAGE } : { kind: 'started', state }
    } catch (error) {
      // A start of another click or ask got there first: the same hint as above.
      return { kind: 'refused', message: this.busy(projectId) ?? messageOf(error) }
    }
  }

  /** busy() for the Orchestrator's tool, which asks it before its dialog (chat-confirm.ts, ticket 23). */
  busyRefusal(projectId: string): string | null {
    return this.busy(projectId)
  }

  /** Why a start from a chat is refused now for a run under way, starting or waiting for its Orchestrator; null when none. */
  private busy(projectId: string): string | null {
    const running = this.deps.autopilot.runningEpic(projectId)
    return running === null ? null : chatRunningHint(running)
  }

  /** A refusal after the answer has gone: on the Session that asked, and in the log. */
  private tell(projectId: string, session: string, text: string): void {
    console.warn(`[autopilot] ${projectId}: ${text}`)
    try {
      this.deps.notify(session, text)
    } catch (failed) {
      console.warn(`[autopilot] ${projectId}: could not tell the Session that asked`, failed)
    }
  }
}
