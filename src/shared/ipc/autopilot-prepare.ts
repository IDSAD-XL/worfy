// The `autopilot.prepare` channel (worfy-autopilot-queue ticket 09): the facts of the Start Autopilot
// window (src/renderer/autopilot/StartAutopilotModal.tsx) before a start — the Project, what is left of
// each Epic, the Orchestrator's Vendor and Session, the forecast against the budget, the Limits now, the
// default Run mode and whether the Orchestrator is busy. Built in src/main/autopilot/prepare.ts from the
// sources of the autopilot_start dialog (appAutopilotStarter, src/main/autopilot/chat-confirm.ts), so the
// window and that dialog say the same lines. Reads only; handled in src/main/ipc/autopilot-prepare.ts.
// The Modes of the window (Eco mode, Auto-approval, Auto-continue) are not here: the window reads them
// through the channels of the Modes menu (src/renderer/session/modes/), as that menu does.
import { z } from 'zod'
import { RUN_MODES } from '../autopilot/run-mode'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { vendorIdSchema } from '../vendors/vendor'
import { invokeChannel } from './channels'
import { MAX_NAMED_TICKETS } from './autopilot'

/** The most Epics one window names: the queue limit of the worfy-autopilot-queue spec (its decisions made without the owner, item 8). */
export const PREPARE_EPICS_MAX = 10

const share = z.number().nonnegative()

export const autopilotPrepareInputSchema = z
  .object({
    projectId: z.string().min(1),
    epics: z.array(epicNameSchema).min(1).max(PREPARE_EPICS_MAX),
    /** Named Tickets: a run over one Epic only (the spec's decision 19). */
    tickets: z.array(ticketNumSchema).min(1).max(MAX_NAMED_TICKETS).optional(),
  })
  .refine((input) => input.tickets === undefined || input.epics.length === 1, { message: 'named Tickets go with one Epic only', path: ['tickets'] })

export const autopilotPrepareAnswerSchema = z.object({
  project: z.object({ id: z.string().min(1), name: z.string() }),
  /** Each Epic asked for, in order. */
  epics: z.array(
    z.object({
      epic: epicNameSchema,
      /** The Tickets the run would still take: not done (only the named ones in a run over named Tickets), in number order. */
      tickets: z.array(ticketNumSchema),
      /** How many Waves are left of them (remainingWaves). */
      waves: z.number().int().nonnegative(),
      /** When the owner accepted the Epic's spec, YYYY-MM-DD (`acceptedAt` of epic-status --json); null when the spec is not accepted. */
      accepted: z.string().nullable(),
    }),
  ),
  orchestrator: z.object({
    /** The Vendor the Project's Orchestrator runs on (Orchestrators.runsOn). */
    vendor: vendorIdSchema,
    /** The Orchestrator's saved Session id; null before its first Session. */
    session: z.string().min(1).nullable(),
  }),
  forecast: z.object({
    /** The forecast lines of the autopilot_start dialog for the same Epics (dialogLines); empty when the run journals cannot be read. */
    lines: z.array(z.string()),
    /** The Waves left, all Epics together. */
    waves: z.number().int().nonnegative(),
    /** p10 and p90 of the share of the week those Waves take, 0..1; null with too few samples. */
    range: z.object({ low: share, high: share }).nullable(),
    /** About how long they take: the Waves left times the p90 of a Wave's duration, in ms; null without enough Wave durations. */
    duration: z.number().nonnegative().nullable(),
  }),
  /** Settings → Autopilot: whether the daily budget is on, and the reserve of the week left for work by hand, 0..1. */
  budget: z.object({ enabled: z.boolean(), reserve: share }),
  /** The week as the forecast reads it (the longest window of a Vendor other than Claude): `text` is the "Used now" sentence of the forecast line. */
  limits: z.object({ utilization: share.nullable(), text: z.string().min(1) }),
  /** The default Run mode of Settings → Autopilot, and its Start window in whole local hours. */
  mode: z.enum(RUN_MODES),
  window: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }),
  /** What keeps the Orchestrator busy now (Orchestrators.busy, worfy-autopilot-queue ticket 07); null when it is free. A start then waits for it. */
  busy: z
    .object({
      turn: z.boolean(),
      queued: z.number().int().nonnegative(),
      tasks: z.array(z.object({ id: z.string().min(1), type: z.string().nullable(), description: z.string().nullable() })),
    })
    .nullable(),
})
export type AutopilotPrepareAnswer = z.infer<typeof autopilotPrepareAnswerSchema>
export type AutopilotPrepareInput = z.infer<typeof autopilotPrepareInputSchema>

/** The facts of the Start Autopilot window for `epics` of the Project. Refused for an Epic or a named Ticket the Project does not have. */
export const autopilotPrepare = invokeChannel('autopilot.prepare', autopilotPrepareInputSchema, autopilotPrepareAnswerSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'autopilot.prepare': typeof autopilotPrepare
  }
}
