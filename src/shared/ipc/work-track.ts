// The `workTrack` domain (worfy-work-track ticket 08): the Work track of a Project over a period — every
// fact of the Run journals, the Wave markers, the transcripts, GitHub, the gate logs and the git log of the
// Ticket files, with the Sessions, the no-data gaps and the summary — computed in main each time it is read
// (src/main/work-track/service.ts); nothing is stored (ADR-0092). Handled in src/main/ipc/work-track.ts.
// `project` and `read`: a window on a Linked machine reads the Work track of the Machine the Project is on.
//
// The answer is the model's input (src/shared/work-track/facts.ts) and its summary; the lanes are the
// model's pure step over that input (lanesBySession, lanesByEpic, offLaneSpans of
// src/shared/work-track/lanes.ts), which the screen runs itself: which Sessions have their Subagents
// unfolded is the screen's state.
//
// The slow sources — the transcripts (a month is ~12 s on a first read) and GitHub — are read in the
// background: `read` answers with what the other sources gave and names the ones still being read in
// `loading`; `read` with `wait` answers once every source is in. The screen shows the first answer at
// once, then asks again with `wait`.
import { z } from 'zod'
import { SPAN_OUTCOMES } from '../flight-recorder/facts'
import { VENDOR_IDS } from '../vendors/vendor'
import { PERIOD_KINDS, WORK_FACT_KINDS, WORK_SOURCES } from '../work-track/facts'
import { invokeChannel } from './channels'

const projectId = z.string().min(1)
const iso = z.string().refine((text) => !Number.isNaN(Date.parse(text)), 'not a time')
const ms = z.number()
const count = z.number().int().nonnegative()
const source = z.enum(WORK_SOURCES)

/** The sources read in the background, as `loading` names them. */
export const WORK_TRACK_SLOW_SOURCES = ['transcripts', 'github'] as const
export type WorkTrackSlowSource = (typeof WORK_TRACK_SLOW_SOURCES)[number]

export const workPeriodSchema = z.object({ kind: z.enum(PERIOD_KINDS), start: iso })

/** WorkFact of src/shared/work-track/facts.ts. */
export const workFactSchema = z.object({
  id: z.string(),
  kind: z.enum(WORK_FACT_KINDS),
  start: iso,
  end: iso.nullable(),
  outcome: z.enum(SPAN_OUTCOMES).nullable(),
  session: z.string().nullable(),
  parent: z.string().optional(),
  epic: z.string().optional(),
  ticket: z.string().optional(),
  pr: z.number().int().optional(),
  source,
  title: z.string(),
})

/** SessionInfo of src/shared/work-track/facts.ts. */
export const workSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.enum(VENDOR_IDS),
  hidden: z.boolean(),
  archived: z.boolean(),
})

/** SourceGap of src/shared/work-track/facts.ts. */
export const sourceGapSchema = z.object({
  source,
  start: iso,
  end: iso,
  why: z.string(),
  session: z.string().optional(),
})

/** WorkSummary of src/shared/work-track/summary.ts. */
export const workSummarySchema = z.object({
  workMs: ms,
  byEpic: z.array(z.object({ epic: z.string(), ms })),
  prsMerged: count,
  runs: count,
  // `why` is readonly in GapSummary.
  gaps: z.array(z.object({ source, start: ms, end: ms, why: z.array(z.string()).readonly() })),
  gapCount: count,
  days: z.array(z.object({ start: ms, workMs: ms, prsMerged: count })),
})

export const workTrackViewSchema = z.object({
  projectId,
  // The model's input (WorkTrackInput): the screen hands these five to lanes.ts and summary.ts as they are.
  period: workPeriodSchema,
  now: iso,
  facts: z.array(workFactSchema),
  sessions: z.array(workSessionSchema),
  gaps: z.array(sourceGapSchema),
  summary: workSummarySchema,
  /** The sources still being read: their facts and gaps are not in this answer yet. */
  loading: z.array(z.enum(WORK_TRACK_SLOW_SOURCES)),
})
export type WorkTrackView = z.infer<typeof workTrackViewSchema>

/**
 * The Work track of the Project over the period, computed now. Without `wait` it answers without the
 * sources still being read (`loading`); with `wait`, once they are in.
 */
export const workTrackRead = invokeChannel('workTrack.read', z.object({ projectId, period: workPeriodSchema, wait: z.boolean().optional() }), workTrackViewSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'workTrack.read': typeof workTrackRead
  }
}
