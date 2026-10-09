// The `cardApi` domain: what the window's Card bridge (src/renderer/canvas/card-bridge.ts) asks
// of main on behalf of a Card (ticket 26) — the Card's own data and `session.ask`. The window has
// already checked that the message came from that Card's frame; main checks the input again here
// and handles it in src/main/ipc/card-api.ts (ADR-0006). There is no channel that writes the
// workflow: a Card reads it, the window builds the snapshot from what it already reads.
import { z } from 'zod'
import { askTextSchema, cardDataSchema } from '../cards/bridge'
import { cardIdSchema } from './cards'
import { invokeChannel } from './channels'

const card = { projectId: z.string().min(1), cardId: cardIdSchema }

/** The Card's data, or null when it has stored none. */
export const cardApiDataGet = invokeChannel('cardApi.dataGet', z.object(card), z.object({ value: cardDataSchema }), 'project')

/** Replaces the Card's data; `bytes` is the size of its compact JSON. */
export const cardApiDataSet = invokeChannel(
  'cardApi.dataSet',
  z.object({ ...card, value: cardDataSchema }),
  z.object({ bytes: z.number().int().nonnegative() }),
  'project',
)

// `session.ask` (worfy-link ticket 10; ADR-0053): the Machine of the Project prepares the question
// and sends the message, the Machine of the screen shows the dialog. A window calls askPrepare,
// then confirm, then askFinish; in a window that shows a Project of a Linked machine the first and
// the last go to that Machine (they are `project`), confirm stays on the window's own (`local`).

/** What the dialog shows: the Card, who gets the message, and the message exactly as it will be sent. */
export const cardPromptSchema = z.object({
  // No length limit on the title and the message: the Card's <title> has none, and a waiting
  // question whose answer failed its schema would hold the Card until it timed out.
  cardTitle: z.string(),
  recipientLabel: z.string().min(1).max(200),
  message: z.string().min(1),
})
export type CardPrompt = z.output<typeof cardPromptSchema>

/**
 * Picks who gets the text — the Session that last edited the Card, or the Project's Orchestrator
 * when no live Session did — and keeps the question waiting under `askId`, until askFinish, until
 * the screen that asked leaves, or for 10 minutes. Refused while the Card has a question waiting,
 * and when the recipient runs unattended (Autopilot): no one would answer the dialog.
 */
export const cardApiAskPrepare = invokeChannel(
  'cardApi.askPrepare',
  z.object({ ...card, text: askTextSchema }),
  cardPromptSchema.extend({ askId: z.uuid() }),
  'project',
)

/**
 * The message box of `session.ask` on the window that asks, on the window's own Machine: "Send"
 * gives `send: true`, anything else false.
 */
export const cardApiConfirm = invokeChannel('cardApi.confirm', cardPromptSchema, z.object({ send: z.boolean() }), 'local')

/**
 * Ends the question: with `send: true` the text goes to the recipient askPrepare picked, with
 * `send: false` nothing is sent. `recipient` is null when nothing was sent.
 */
export const cardApiAskFinish = invokeChannel(
  'cardApi.askFinish',
  z.object({ projectId: card.projectId, askId: z.uuid(), send: z.boolean() }),
  z.object({ sent: z.boolean(), recipient: z.enum(['session', 'orchestrator']).nullable() }),
  'project',
)

declare module './channels' {
  interface IpcContract {
    'cardApi.dataGet': typeof cardApiDataGet
    'cardApi.dataSet': typeof cardApiDataSet
    'cardApi.askPrepare': typeof cardApiAskPrepare
    'cardApi.confirm': typeof cardApiConfirm
    'cardApi.askFinish': typeof cardApiAskFinish
  }
}
