// The `pipeline` domain: the Pipeline of a Project and the Stage of each of its Tickets (ADR-0067),
// computed in main from the workflow model, the PRs, the agents' marks, the Deployments and the e2e
// lock (src/main/workflow/stages.ts). A domain of its own, not a field of `workflow`: epic-status
// has none of those facts. Nothing is written anywhere (ADR-0002, ADR-0005).
import { z } from 'zod'
import { absolutePathSchema } from '../paths'
import { pipelineStageSchema, ticketStageSchema } from '../workflow/pipeline'
import { eventChannel, invokeChannel } from './channels'

/** One Stage of the Project's Pipeline, with its id and its name on the board. */
export const pipelineColumnSchema = pipelineStageSchema.extend({
  /** `kind`, or `check/<name>` (stageId). */
  id: z.string(),
  /** The Profile's label, else the catalogue's name (stageLabel). */
  title: z.string(),
})
export type PipelineColumn = z.infer<typeof pipelineColumnSchema>

/** A Ticket's Stage, named by Epic and number. */
export const pipelineTicketSchema = ticketStageSchema.extend({
  epic: z.string(),
  num: z.number().int().nonnegative(),
})
export type PipelineTicket = z.infer<typeof pipelineTicketSchema>

export const pipelineSnapshotSchema = z.object({
  root: z.string(),
  pipeline: z.array(pipelineColumnSchema),
  /** Every Ticket of the model, in its order. */
  tickets: z.array(pipelineTicketSchema),
  /**
   * Why the Stages may be short of facts: the Profile could not be read (the default Pipeline
   * stands in), its Pipeline did not read, the workflow model failed, or gh is unavailable. Null
   * when nothing is missing.
   */
  error: z.string().nullable(),
})
export type PipelineSnapshot = z.infer<typeof pipelineSnapshotSchema>

/** A Project is named by the absolute path of its root. */
const projectRoot = z.object({ root: absolutePathSchema })

/**
 * The Pipeline and the Stages of the Project's Tickets, and from now on `pipeline.changed` to the
 * calling window whenever a Stage changes — after a change of the workflow model, a PR read, a mark
 * — until `pipeline.close` (or until the window is gone). Read-only git and gh, as `checks.get`.
 */
export const pipelineGet = invokeChannel('pipeline.get', projectRoot, pipelineSnapshotSchema, 'project', 'read')

/** Stops `pipeline.changed` for this Project in the calling window. `closed` is false if it was not open. */
export const pipelineClose = invokeChannel('pipeline.close', projectRoot, z.object({ closed: z.boolean() }), 'project', 'read')

/** The whole snapshot again, when anything in it changed. */
export const pipelineChanged = eventChannel('pipeline.changed', pipelineSnapshotSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'pipeline.get': typeof pipelineGet
    'pipeline.close': typeof pipelineClose
    'pipeline.changed': typeof pipelineChanged
  }
}
