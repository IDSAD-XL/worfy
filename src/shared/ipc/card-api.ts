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
export const cardApiDataGet = invokeChannel('cardApi.dataGet', z.object(card), z.object({ value: cardDataSchema }))

/** Replaces the Card's data; `bytes` is the size of its compact JSON. */
export const cardApiDataSet = invokeChannel(
  'cardApi.dataSet',
  z.object({ ...card, value: cardDataSchema }),
  z.object({ bytes: z.number().int().nonnegative() }),
)

/**
 * Shows the user the text and who gets it; only after "Send" does the text go to the Session
 * that last edited the Card, or to the Project's Orchestrator when no live Session did.
 * `sent: false` — the user said no; `recipient` is null then.
 */
export const cardApiAsk = invokeChannel(
  'cardApi.ask',
  z.object({ ...card, text: askTextSchema }),
  z.object({ sent: z.boolean(), recipient: z.enum(['session', 'orchestrator']).nullable() }),
)

declare module './channels' {
  interface IpcContract {
    'cardApi.dataGet': typeof cardApiDataGet
    'cardApi.dataSet': typeof cardApiDataSet
    'cardApi.ask': typeof cardApiAsk
  }
}
