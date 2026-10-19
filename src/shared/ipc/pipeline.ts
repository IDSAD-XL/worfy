// The `pipeline` domain: the Pipeline of a Project and the Stage of each of its Tickets (ADR-0067),
// computed in main from the workflow model, the PRs, the agents' marks, the Deployments and the e2e
// lock (src/main/workflow/stages.ts). A domain of its own, not a field of `workflow`: epic-status
// has none of those facts. The Stages are only read; the one write is the Pipeline editor of Settings
// (`pipeline.write`), which goes through the Harness's `bin/profile-set` (ADR-0073) and never writes
// the Profile itself (ADR-0002, ADR-0005).
import { z } from 'zod'
import { absolutePathSchema } from '../paths'
import { pipelineSchema, pipelineStageSchema, ticketStageSchema } from '../workflow/pipeline'
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

// ── the Pipeline editor (worfy-pipeline ticket 08) ───────────────────────────────

/** The fingerprint `bin/profile-set --read` gives of `workflow.pipeline`: the write goes ahead only while the Profile still has the Pipeline the editor read. */
export const pipelineFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u)

/** What the editor reads of a Project's Profile through `bin/profile-set --read`. */
export const pipelineEditorReadSchema = z.discriminatedUnion('available', [
  /** The Harness on the Machine has no `bin/profile-set`: it is older than the editor. */
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    /** Whether the Profile has `workflow.pipeline`; without it the default Pipeline stands. */
    custom: z.boolean(),
    /** The Pipeline the Profile resolves to: its own, or the default one. */
    pipeline: z.array(pipelineStageSchema),
    /** The fingerprint of `workflow.pipeline` as the file has it; null without the field. */
    fingerprint: pipelineFingerprintSchema.nullable(),
  }),
])
export type PipelineEditorRead = z.infer<typeof pipelineEditorReadSchema>

/**
 * The Pipeline of the Profile for the editor, read on the Project's Machine: an editor on a Linked
 * machine's window shows that Machine's Pipeline, read-only. Changes nothing.
 */
export const pipelineRead = invokeChannel('pipeline.read', projectRoot, pipelineEditorReadSchema, 'project', 'read')

export const pipelineWriteInputSchema = z.object({
  root: absolutePathSchema,
  /** The fingerprint the editor read (`pipeline.read`); null when the Profile had no `workflow.pipeline`. */
  expected: pipelineFingerprintSchema.nullable(),
  /** The new Pipeline; null resets it to the default: `bin/profile-set --reset` removes the field. */
  pipeline: pipelineSchema.nullable(),
})

export const pipelineWriteResultSchema = z.discriminatedUnion('status', [
  /** Written. `warning`: why the change was not committed in the Harness home's git; the write stays. */
  z.object({ status: z.literal('saved'), fingerprint: pipelineFingerprintSchema.nullable(), warning: z.string().nullable() }),
  /** The Profile's Pipeline is not the one the editor read: nothing written. */
  z.object({ status: z.literal('conflict') }),
  /** `bin/profile-set` refused the Pipeline (exit 1) with this reason: nothing written. */
  z.object({ status: z.literal('invalid'), reason: z.string() }),
  /** The Harness has no `bin/profile-set`: the editor offers its Update. */
  z.object({ status: z.literal('too-old') }),
])
export type PipelineWriteResult = z.infer<typeof pipelineWriteResultSchema>

/**
 * Writes the Pipeline of a Project of this Machine through `bin/profile-set` (ADR-0073). `local`, not
 * `project`: main refuses it to every Linked machine, with full access too —
 * the Pipeline is edited only in worfy on the Machine the Project lives on.
 */
export const pipelineWrite = invokeChannel('pipeline.write', pipelineWriteInputSchema, pipelineWriteResultSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'pipeline.get': typeof pipelineGet
    'pipeline.close': typeof pipelineClose
    'pipeline.changed': typeof pipelineChanged
    'pipeline.read': typeof pipelineRead
    'pipeline.write': typeof pipelineWrite
  }
}
