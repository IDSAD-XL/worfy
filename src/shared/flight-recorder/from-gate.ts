// The facts of the gate logs and of the verdicts kept without a PR (worfy-flight-recorder ticket 16):
// pure parsing, no Node, no DOM. The readers in src/main/flight-recorder/ (gate-logs.ts,
// local-verdicts.ts) list and read the files and git; this module turns what they read into the
// `RunFacts` of facts.ts.
//
// - A gate run: `<Harness home>/gate/state/logs/<tag>/<run>/timings.json`, written by
//   harness/hooks/gate-log.mjs (`writeTimings`) at the end of a run: `{version: 1, profile, key,
//   worktree, head, outcome, exit, at, total_ms, steps: [{step, package, script, ms, exit}], cached}`.
//   `at` is the moment the record was written, the end of the run; the run began `total_ms` before
//   it. The steps ran one after another, and only their durations are recorded, so they are laid
//   back to back up to the end of the run. A run answered wholly by the green cache writes no
//   timings.json (harness/hooks/gate.mjs, `if (logs.length)`): it is not on the timeline, and the
//   note of every gate span says so.
// - A gate run names its `head` and `worktree` and no Ticket: the model (spans.ts) finds the Ticket
//   by the sha, then by the worktree. The worktree is handed over in the canonical form of
//   `comparablePath` after realpath (gate-logs.ts), the form reader 14 hands over too.
// - The verdict of a Ticket without a PR: in Silent mode the agents' marks in the marks file
//   (src/main/workflow/marks.ts); with `workflow.finish` `local-green` the empty commits
//   `gate: VERIFIED` / `gate: REJECTED: <list>` (`gate: NARROW: …` after the narrow round) on the
//   Ticket's branch, each a `review` mark on the commit it was written on top of. `gate: MAX-REVIEW: …`
//   is not a verdict of the Ticket's round and is skipped.
// - The head changes of a branch without a PR come from the branch's reflog: each entry is the moment
//   the branch got a new head, as a push does for a PR.
import { z } from 'zod'
import type { MarkFact } from '../workflow/pipeline'
import type { StageEventFact, WorkFact } from './facts'

type Iso = string

/** The note of every gate span: what the gate log does not hold (the spec's Risks, item 2). */
export const GREEN_CACHE_NOTE = 'gate log: a run answered wholly by the green cache writes no timings.json and is not shown'

// ── paths ────────────────────────────────────────────────────────────────────

/**
 * A path in the form two worktree paths are compared in, as a string. On Windows `\` and `/` are one
 * separator and letter case does not tell two names apart (NTFS keeps the case and ignores it), so
 * the path gets `/` and lower case, and the `\\?\` prefix of a long path goes; elsewhere it is the
 * path itself. A trailing separator goes too, except on a root (`/`, `c:/`). realpath (8.3 short
 * names like `RUNNER~1`, links, the drive letter's case) is the reader's step before this one.
 */
export function comparablePath(path: string, platform: string): string {
  let result = path
  if (platform === 'win32') {
    result = result.replaceAll('\\', '/')
    if (result.startsWith('//?/UNC/')) result = `//${result.slice('//?/UNC/'.length)}`
    else if (result.startsWith('//?/')) result = result.slice('//?/'.length)
    result = result.toLowerCase()
  }
  while (result.length > 1 && result.endsWith('/') && !/^[a-z]:\/$/u.test(result)) result = result.slice(0, -1)
  return result
}

// ── timings.json ─────────────────────────────────────────────────────────────

const stepSchema = z
  .object({
    step: z.string().min(1),
    package: z.string().nullish(),
    script: z.string().min(1),
    ms: z.number().nonnegative(),
    exit: z.number().nullable(),
  })
  .loose()

const cachedSchema = z.object({ step: z.string().min(1) }).loose()

const timingsSchema = z
  .object({
    version: z.literal(1),
    profile: z.string().min(1),
    worktree: z.string().min(1),
    head: z.string().min(1).nullable(),
    outcome: z.enum(['green', 'red', 'unverified', 'none']),
    at: z.string().refine((text) => !Number.isNaN(Date.parse(text))),
    total_ms: z.number().nonnegative(),
    steps: z.array(stepSchema),
    cached: z.array(cachedSchema).default([]),
  })
  .loose()

export type GateTimings = z.infer<typeof timingsSchema>

/** The record of a timings.json, or null when the text is not one (broken JSON, another version). */
export function parseTimings(text: string): GateTimings | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = timingsSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

const iso = (time: number): Iso => new Date(time).toISOString()

/** The name of a step: its script, with the package in front when it is not the repository root. */
const stepName = (step: GateTimings['steps'][number]): string => (step.package && step.package !== '.' ? `${step.package}:${step.script}` : step.script)

/**
 * The work facts of one gate run: the `gate` span and a `script` span per step, the steps with the
 * gate run as `parentWork`. `id` is unique per run (the reader gives `<tag>/<run>`), `worktree` the
 * canonical path of the run's worktree. Times are the file's `at`, never the file's mtime.
 */
export function gateRunFacts(timings: GateTimings, id: string, worktree: string): WorkFact[] {
  const end = Date.parse(timings.at)
  const start = end - timings.total_ms
  const failed = timings.steps.filter((step) => step.exit !== 0)
  const outcome = timings.outcome === 'red' ? 'failed' : timings.outcome === 'unverified' ? 'failed' : 'ok'
  const reason =
    timings.outcome === 'red'
      ? `red: ${failed.length ? failed.map((step) => `${stepName(step)} (exit ${step.exit ?? 'none'})`).join(', ') : 'a script failed'}`
      : timings.outcome === 'unverified'
        ? 'not verified: environment unavailable'
        : undefined
  const cached = timings.cached.map((item) => item.step)
  const gate: WorkFact = {
    id,
    kind: 'gate',
    name: `gate ${timings.profile}`,
    start: iso(start),
    end: iso(end),
    outcome,
    ...(reason === undefined ? {} : { reason }),
    note: cached.length ? `${GREEN_CACHE_NOTE}; from the green cache in this run: ${cached.join(', ')}` : GREEN_CACHE_NOTE,
    ...(timings.head === null ? {} : { sha: timings.head }),
    worktree,
    startSource: 'gate-log',
    endSource: 'gate-log',
  }
  const ran = timings.steps.reduce((total, step) => total + step.ms, 0)
  let cursor = Math.max(start, end - ran)
  const steps = timings.steps.map((step, index): WorkFact => {
    const from = cursor
    cursor += step.ms
    return {
      id: `${id}/${index + 1}`,
      kind: 'script',
      name: stepName(step),
      start: iso(from),
      end: iso(Math.min(cursor, end)),
      outcome: step.exit === 0 ? 'ok' : 'failed',
      ...(step.exit === 0 ? {} : { reason: `exit ${step.exit ?? 'none'}` }),
      parentWork: { kind: 'gate', id },
      startSource: 'gate-log',
      endSource: 'gate-log',
    }
  })
  return [gate, ...steps]
}

// ── verdicts without a PR ────────────────────────────────────────────────────

const VERDICT_SUBJECT = /^gate: (?:NARROW: )?(VERIFIED|REJECTED)\b:?\s*(.*)$/u

/**
 * The verdict a `gate:` commit subject records: `gate: VERIFIED`, `gate: REJECTED: <list>`, either
 * after `NARROW:`; null for any other subject, `gate: MAX-REVIEW: …` included.
 */
export function gateVerdict(subject: string): { verdict: 'success' | 'failure'; reason?: string } | null {
  const match = VERDICT_SUBJECT.exec(subject.trim())
  if (match === null) return null
  if (match[1] === 'VERIFIED') return { verdict: 'success' }
  return { verdict: 'failure', reason: subject.trim().slice('gate: '.length) }
}

/** The marks of a Silent mode marks file as Ticket events; a mark with no time is not on the timeline. */
export function markEvents(ticket: string, marks: readonly MarkFact[]): StageEventFact[] {
  return marks.flatMap((mark): StageEventFact[] =>
    mark.at === null || Number.isNaN(Date.parse(mark.at)) ? [] : [{ ticket, at: iso(Date.parse(mark.at)), source: 'marks-file', event: 'mark', mark: mark.kind, verdict: mark.verdict, sha: mark.sha }],
  )
}

/** One entry of a branch's reflog: the new head, its parents and subject, when and how it moved. */
export interface ReflogEntry {
  sha: string
  parents: readonly string[]
  at: Iso
  /** The reflog message: `branch: Created from main`, `commit: …`, `rebase (finish): …`. */
  action: string
  /** The subject of the head commit. */
  subject: string
}

/** The git format `parseReflog` reads: `git log -g --date=iso-strict --format=<this>`. */
export const REFLOG_FORMAT = '%H%x00%P%x00%gd%x00%gs%x00%s'

/** The entries of `git log -g --date=iso-strict --format=REFLOG_FORMAT`, newest first as git prints them. */
export function parseReflog(stdout: string): ReflogEntry[] {
  return stdout.split('\n').flatMap((line): ReflogEntry[] => {
    const [sha, parents, selector, action, subject] = line.split('\u0000')
    if (!sha || selector === undefined || action === undefined || subject === undefined) return []
    const date = /@\{(.+)\}$/u.exec(selector)?.[1]
    const time = date === undefined ? Number.NaN : Date.parse(date)
    if (Number.isNaN(time)) return []
    return [{ sha, parents: parents ? parents.split(' ').filter(Boolean) : [], at: iso(time), action, subject }]
  })
}

/**
 * The Ticket events of a branch without a PR: from its reflog, a `push` for each new head and a
 * `review` mark for each `gate:` verdict commit made on it (on the commit it was made on top of);
 * the entry that created the branch is no event, a `gate: MAX-REVIEW: …` commit neither. `merge` —
 * when the branch went into the main branch (local-verdicts.ts finds when).
 */
export function branchEvents(ticket: string, entries: readonly ReflogEntry[], merge: { at: Iso; sha: string } | null): StageEventFact[] {
  const events: StageEventFact[] = []
  for (const entry of entries) {
    if (entry.action.startsWith('branch: Created')) continue
    const made = entry.action.startsWith('commit')
    if (made && entry.subject.startsWith('gate: ')) {
      const verdict = gateVerdict(entry.subject)
      if (verdict !== null) {
        events.push({ ticket, at: entry.at, source: 'git', event: 'mark', mark: 'review', verdict: verdict.verdict, sha: entry.parents[0] ?? null, ...(verdict.reason === undefined ? {} : { reason: verdict.reason }) })
      }
      continue
    }
    events.push({ ticket, at: entry.at, source: 'git', event: 'push', sha: entry.sha })
  }
  if (merge !== null) events.push({ ticket, at: merge.at, source: 'git', event: 'merge', sha: merge.sha })
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
