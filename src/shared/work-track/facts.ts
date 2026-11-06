// The facts of Work track: the contract between the readers of the sources (worfy-work-track
// tickets 05–08) and the model (lanes.ts, summary.ts). Work track is the timeline of all the work of a
// Project on this Machine over a Day, a Week or a Month; it is computed each time it is opened and
// stored nowhere (ADR-0092). Pure types and constants: no Node, no DOM.
import type { SpanOutcome } from '../flight-recorder/facts'
import type { VendorId } from '../vendors/vendor'

type Iso = string

// ── the vocabulary ───────────────────────────────────────────────────────────

/** The kinds of fact, a fixed set (the spec's Model section). */
export const WORK_FACT_KINDS = ['run', 'wave', 'turn', 'subagent', 'pr', 'ci', 'gate', 'ticket-status'] as const
export type WorkFactKind = (typeof WORK_FACT_KINDS)[number]

/**
 * The sources a fact or a gap comes from, in the order the summary lists the gaps: the Run journals,
 * the Wave markers (`decisions.tsv` of epic-wave), the Claude Code transcripts, the Codex history,
 * GitHub, the gate logs (`timings.json`), the git log of the Ticket files.
 */
export const WORK_SOURCES = ['journal', 'wave-marker', 'transcript', 'codex', 'github', 'gate-log', 'git'] as const
export type WorkSource = (typeof WORK_SOURCES)[number]

/** The name of each source on the screen: the «Source: …» line and the «no data» hint. */
export const WORK_SOURCE_LABELS: Readonly<Record<WorkSource, string>> = {
  journal: 'Run journals',
  'wave-marker': 'Wave markers',
  transcript: 'Claude Code transcripts',
  codex: 'Codex history',
  github: 'GitHub',
  'gate-log': 'gate logs (timings.json)',
  git: 'git log of the Ticket files',
}

/** The lengths of a period (owner decision 8): Week by default. */
export const PERIOD_KINDS = ['day', 'week', 'month'] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

// ── the facts: the contract with the readers ─────────────────────────────────
//
// | kind            | filled by                                   | `start` … `end`                       |
// |-----------------|---------------------------------------------|---------------------------------------|
// | `run`           | Run journals (08)                           | `run-started` … `run-stopped`         |
// | `wave`          | Run journals and Wave markers (08)          | `wave-started` … `wave-finished`      |
// | `turn`          | transcripts, Codex history (05)             | a turn of a Session                   |
// | `subagent`      | transcripts (05)                            | a Subagent's stretch of work          |
// | `pr`            | GitHub (06)                                 | opened … merged; `end: null` — not merged |
// | `ci`            | GitHub (06)                                 | a CI run                              |
// | `gate`          | gate logs (08)                              | a gate run                            |
// | `ticket-status` | git log of the Ticket files (07)            | the change, `start` = `end`           |
//
// Only names reach the facts (owner decision 7): the name of a Session, the name and description of a
// Subagent, the Epic, the Ticket, the PR number; never the text of a turn.

/** One fact of a source: a stretch of work, or a moment (`start` = `end`). */
export interface WorkFact {
  /** Unique among all the facts of an input, whatever their kind: `parent` names it. */
  id: string
  kind: WorkFactKind
  start: Iso
  /** `null` — still going: it lasts until `now` of the input. */
  end: Iso | null
  /** How it ended; `null` while it goes on. */
  outcome: SpanOutcome | null
  /** The Session the work is of; `null` for work of no Session (a PR, a CI run, a gate run). */
  session: string | null
  /**
   * The fact this one is nested in: the Run of a Wave, the Wave a Subagent worked in, the Subagent
   * that started a Subagent. A fact with no `epic` takes the Epic of its parent chain.
   */
  parent?: string
  /** The Epic when the source or a heuristic of the reader is sure of it (spec, risk 3); absent — «—». */
  epic?: string
  ticket?: string
  pr?: number
  source: WorkSource
  /** What the screen calls it: the name of a Subagent, `Wave 2 · tickets 05, 06`, `gate fast`. */
  title: string
}

/** A Session of the Project, as the Canvas and the Vendor history know it. */
export interface SessionInfo {
  id: string
  /** The title of its Node on the Canvas; without a Node — «Session <first 4 of the id>» and the worktree. */
  name: string
  vendor: VendorId
  hidden: boolean
  archived: boolean
}

/**
 * A part of the period where a source holds nothing: transcripts past their limit, gate logs past
 * theirs, a Session file deleted. The screen hatches it «no data» with the source and `why`.
 */
export interface SourceGap {
  source: WorkSource
  start: Iso
  end: Iso
  /** The hint, in English: «Transcripts are deleted after 35 days…». */
  why: string
  /** The one Session whose data is gone (its transcript deleted); absent — every Session of the source. */
  session?: string
}

/**
 * The period shown: a local Day, a Week of 7 local days, or a calendar Month (that the screen starts
 * on the 1st). `start` is a local midnight.
 */
export interface Period {
  kind: PeriodKind
  start: Iso
}

/** Everything a Work track is built from. */
export interface WorkTrackInput {
  period: Period
  /** The moment it is computed: where facts with no end end. */
  now: Iso
  facts: readonly WorkFact[]
  sessions: readonly SessionInfo[]
  gaps: readonly SourceGap[]
}
