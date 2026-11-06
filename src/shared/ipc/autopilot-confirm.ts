// The `autopilot.confirm` channels (worfy-autopilot-queue ticket 11): an agent's `autopilot_start`
// asks the person in the Start Autopilot window of worfy (src/renderer/autopilot/StartAutopilotModal.tsx,
// the "Agent asks" view) instead of a native message box. Main sends the ask to one window of this
// Machine (dialogOwner, src/main/autopilot/chat-confirm.ts) and waits for its answer; handled in
// src/main/ipc/autopilot-confirm.ts.
//
// Every channel here is `local`: a Linked machine's screen never gets the ask and cannot answer it
// (the spec's decisions made without the owner, item 7). Main takes an answer only from the window it
// asked.
//
// An ask for a queue of Epics (worfy-autopilot-queue ticket 15) carries `epics` besides `epic`, its
// first; the window's view of the queue is ticket 16.
import { z } from 'zod'
import { MAX_QUEUE_EPICS } from '../autopilot/epic-queue'
import { RUN_MODES } from '../autopilot/run-mode'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'
import { MAX_NAMED_TICKETS } from './autopilot'

export const autopilotConfirmAskSchema = z.object({
  /** The ask's own id: its answer and its close name it. */
  id: z.string().min(1).max(100),
  projectId: z.string().min(1),
  /** The Project's name, as its list shows it. */
  project: z.string(),
  epic: epicNameSchema,
  /** The queue of Epics of the run, in order, the first being `epic`, when it has more than one; absent: the Epic alone. */
  epics: z.array(epicNameSchema).min(2).max(MAX_QUEUE_EPICS).optional(),
  /** The named Tickets; absent: the whole Epic. */
  tickets: z.array(ticketNumSchema).min(1).max(MAX_NAMED_TICKETS).optional(),
  /** The id of the Session that asked (its SDK id). */
  session: z.string().min(1),
  /** The default Run mode of Settings → Autopilot. */
  mode: z.enum(RUN_MODES),
  /** The forecast lines of the start (dialogLines); empty: none. */
  forecast: z.array(z.string()),
  /** How long main waits for the answer from now; the window counts it down. */
  waitMs: z.number().int().positive(),
})
export type AutopilotConfirmAsk = z.output<typeof autopilotConfirmAskSchema>

/** An agent asks for a start: the window shows the "Agent asks" view. */
export const autopilotConfirmAsk = eventChannel('autopilot.confirm.ask', autopilotConfirmAskSchema, 'local')

/** Main stopped waiting (the 10 minutes are up): the window says so and closes; an answer now changes nothing. */
export const autopilotConfirmClose = eventChannel('autopilot.confirm.close', z.object({ id: z.string().min(1).max(100) }), 'local')

/**
 * What the window answers: a Run mode — the person started in it; `cancel` — Cancel, Esc or "change
 * in Modes"; `occupied` — the window was open for another start already, so this ask was not shown.
 */
export const AUTOPILOT_CONFIRM_ANSWERS = [...RUN_MODES, 'cancel', 'occupied'] as const
export type AutopilotConfirmAnswer = (typeof AUTOPILOT_CONFIRM_ANSWERS)[number]

/** The window's answer to ask `id`. Refused for a window main did not ask; an ask that is over takes it and changes nothing. */
export const autopilotConfirmAnswer = invokeChannel(
  'autopilot.confirm.answer',
  z.object({ id: z.string().min(1).max(100), answer: z.enum(AUTOPILOT_CONFIRM_ANSWERS) }),
  z.void(),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'autopilot.confirm.ask': typeof autopilotConfirmAsk
    'autopilot.confirm.close': typeof autopilotConfirmClose
    'autopilot.confirm.answer': typeof autopilotConfirmAnswer
  }
}
