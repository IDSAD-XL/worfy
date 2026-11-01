// The `runs` domain (worfy-flight-recorder ticket 17): the Autopilot Runs of a Project and the timeline
// of one Run, computed in main from the Journal, the transcripts, GitHub and the gate logs
// (src/main/flight-recorder/service.ts) each time it is opened; nothing is stored (decision 01, Q4).
// Handled in src/main/ipc/runs.ts. Every channel is `project` and `read`: a window on a Linked machine
// reads the Runs on the Machine where they ran (decision 01, Q7); «Retry» only reads gh again.
import { z } from 'zod'
import { epicNameSchema } from '../binding/resolve'
import { isRunId } from '../autopilot/journal'
import { AGENT_SUBKINDS, FACT_SOURCES, LOST_SOURCE_LABELS, SPAN_KINDS, SPAN_OUTCOMES, WAIT_CAUSES, WORK_KINDS } from '../flight-recorder/facts'
import { WORK_NOTE } from '../flight-recorder/summary'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)
/** A run id of the Journal (`2026-10-17T22-29-32-707Z-58e783`): also the name of its file. */
export const runIdSchema = z.string().refine(isRunId, 'not a run id')

const outcome = z.enum(SPAN_OUTCOMES)
const source = z.enum(FACT_SOURCES)
const lostSource = z.enum(Object.keys(LOST_SOURCE_LABELS) as [keyof typeof LOST_SOURCE_LABELS, ...(keyof typeof LOST_SOURCE_LABELS)[]])
const time = z.number()

/** A Run of the Project in the list: what its Journal says, without the timeline. */
export const runListItemSchema = z.object({
  run: runIdSchema,
  epic: z.string(),
  startedAt: z.string(),
  /** `run-stopped`; null while the Run goes on, or when the Journal ends without it. */
  stoppedAt: z.string().nullable(),
  /** The stop reason of `run-stopped` (`blocked-tickets`, `user-stop`, …); null without one. */
  reason: z.string().nullable(),
  /** Whether Autopilot runs it now. */
  live: z.boolean(),
  /** The Tickets its Waves were sent with, `<epic>/<NN>`. */
  tickets: z.array(z.string()),
})
export type RunListItem = z.infer<typeof runListItemSchema>

// The timeline: Timeline and Summary of src/shared/flight-recorder/spans.ts and summary.ts. Their lists are
// readonly there, so they are here: buildTimeline's answer is a RunView's timeline as it is.

const segmentSchema = z.object({ start: time, end: time, wave: z.number().int().optional() })

const spanLinksSchema = z.object({
  run: z.string(),
  wave: z.number().int().optional(),
  waves: z.array(z.number().int()).readonly().optional(),
  ticket: z.string().optional(),
  tickets: z.array(z.string()).readonly().optional(),
  session: z.string().optional(),
  agent: z.string().optional(),
  pr: z.number().int().optional(),
  sha: z.string().optional(),
  verdict: z.string().optional(),
})

export const spanSchema = z.object({
  id: z.string(),
  kind: z.enum(SPAN_KINDS),
  subkind: z.enum(AGENT_SUBKINDS).nullable(),
  lane: z.enum(['tree', 'wait', 'orchestrator']),
  parent: z.string().nullable(),
  name: z.string(),
  start: time,
  end: time.nullable(),
  until: time,
  segments: z.array(segmentSchema).readonly(),
  outcome: outcome.nullable(),
  reason: z.string().nullable(),
  attempt: z.number().int().positive(),
  retryOf: z.string().nullable(),
  links: spanLinksSchema,
  startSource: source.nullable(),
  endSource: source.nullable(),
  lost: lostSource.nullable(),
  note: z.string().nullable(),
  stages: z.array(z.string()).readonly(),
  waitCause: z.enum(WAIT_CAUSES).nullable(),
})

export const timelineSchema = z.object({
  runId: z.string(),
  live: z.boolean(),
  now: time,
  spans: z.array(spanSchema).readonly(),
  blocks: z.array(z.object({ ticket: z.string(), at: time, until: time, reason: z.string(), waits: z.string().nullable(), cleared: z.boolean(), source })).readonly(),
  orchestratorMarks: z.array(z.object({ kind: z.enum(['refused-dialog', 'human-input']), at: time, text: z.string() })).readonly(),
})

const workSubkind = z.enum([...AGENT_SUBKINDS, ...WORK_KINDS.filter((kind) => kind !== 'agent')] as [string, ...string[]])

export const summarySchema = z.object({
  topStages: z.array(z.object({ spanId: z.string(), ticket: z.string(), name: z.string(), attempt: z.number().int(), selfTime: time, duration: time })),
  waits: z.array(z.object({ cause: z.enum(WAIT_CAUSES), total: time, share: z.number() })),
  work: z.array(z.object({ subkind: workSubkind, total: time, count: z.number().int() })),
  workNote: z.literal(WORK_NOTE),
  runDuration: time,
})

/**
 * How GitHub answered for the timeline. `answered`: gh gave the PRs of the Run's Tickets at `at` (ms);
 * `account` is the Profile's `github.account`, and without one (`accountReason` says why) no comment
 * counts as a verdict or a report of the cross-machine gate. `no-answer`: gh failed with `reason`, the
 * PR and CI spans carry «GitHub did not answer», and «Retry» (`runs.retry`) reads gh at once. `unused`:
 * the Project's Tickets end without a PR (Silent mode, `workflow.finish` `local-green`), gh is not run.
 */
export const runGithubSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('answered'), at: time, account: z.string().nullable(), accountReason: z.string().nullable() }),
  z.object({ state: z.literal('no-answer'), at: time, reason: z.string() }),
  z.object({ state: z.literal('unused'), reason: z.string() }),
])
export type RunGithub = z.infer<typeof runGithubSchema>

/** One Run's timeline as the screen shows it. */
export const runViewSchema = z.object({
  projectId,
  run: runIdSchema,
  epic: z.string(),
  timeline: timelineSchema,
  summary: summarySchema,
  github: runGithubSchema,
  /** Why the Profile's values are defaults (the default Pipeline, no account): it could not be read. Null when it was. */
  profileReason: z.string().nullable(),
  /** Journal lines left out: not JSON, an unknown kind, fields that do not match, another Run's. */
  skippedLines: z.number().int().nonnegative(),
})
export type RunView = z.infer<typeof runViewSchema>

const runRef = z.object({ projectId, run: runIdSchema })

/** The Runs of the Project, newest first; with `epic`, those of that Epic only. */
export const runsList = invokeChannel('runs.list', z.object({ projectId, epic: epicNameSchema.optional() }), z.object({ runs: z.array(runListItemSchema) }), 'project', 'read')

/**
 * The timeline of one Run of the Project, and from now on `runs.changed` to the calling window while
 * the Run goes on — recomputed on a new line of its Journal or transcripts, at most once per 5 s; gh at
 * most once a minute — until `runs.close` (or until the window is gone).
 */
export const runsOpen = invokeChannel('runs.open', runRef, runViewSchema, 'project', 'read')

/** Stops `runs.changed` of this Run in the calling window. `closed` is false if it was not open. */
export const runsClose = invokeChannel('runs.close', runRef, z.object({ closed: z.boolean() }), 'project', 'read')

/** «Retry»: reads gh for the Run at once, outside the minute's step, and answers the new timeline (also sent as `runs.changed`). */
export const runsRetry = invokeChannel('runs.retry', runRef, runViewSchema, 'project', 'read')

/** The whole timeline of an open Run again, after it was recomputed. */
export const runsChanged = eventChannel('runs.changed', runViewSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'runs.list': typeof runsList
    'runs.open': typeof runsOpen
    'runs.close': typeof runsClose
    'runs.retry': typeof runsRetry
    'runs.changed': typeof runsChanged
  }
}
