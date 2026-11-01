// The gate runs of a Run (worfy-flight-recorder ticket 16): every
// `<Harness home>/gate/state/logs/<tag>/<run>/timings.json` the gate keeps (harness/hooks/gate-log.mjs),
// read into work facts by src/shared/flight-recorder/from-gate.ts. The tag is not computed: the
// folders of every worktree are read, and a run names its `head` and `worktree` itself. Which
// Ticket a run belongs to is the model's step (spans.ts): by `head`, without a PR by `worktree`.
// The worktree is handed over in the canonical form of worktree-path.ts, the helper every reader calls.
//
// Time is `at` inside timings.json, never a file's mtime. What the gate log no longer holds is a
// lost fact «gate logs deleted (10 runs or 8 days)»:
// - a worktree whose folder holds `LOG_RUNS_KEPT` runs, the oldest begun after the Run started.
//   pruneLogs of gate-log.mjs leaves at most that many after each run, so a full folder may have lost
//   older runs (a folder that has only ever had that many cannot be told from it, hence «may»). The
//   mark covers the Run's start to the start of the oldest kept run;
// - a run folder begun within the Run with no readable timings.json: a known run without its record,
//   from the folder's start to the start of the next run of that worktree (else the Run's end, or
//   now while the Run is live);
// - a Run that ended more than 8 days ago (`STALE_MS` of gate-log.mjs): the folders of its worktrees
//   may be gone, so every Ticket the model finds no gate run for gets the label.
// A worktree folder none of whose runs has a readable timings.json names no worktree, so its runs
// cannot be placed and get no mark: the folder may as well be another Project's.
// Nothing is written: folders are listed and files read.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gateRunFacts, parseTimings } from '../../shared/flight-recorder/from-gate'
import type { LostFact, WorkFact } from '../../shared/flight-recorder/facts'
import { canonicalWorktree, type CanonicalOptions } from './worktree-path'

/** gate-log.mjs: the runs pruneLogs leaves per worktree. */
export const LOG_RUNS_KEPT = 10
/** gate-log.mjs: a worktree's folder untouched for longer is removed. */
export const STALE_MS = 8 * 24 * 60 * 60 * 1000
/** A run folder's name: the UTC time the run started, `:` written `-`, and the gate's pid. */
const RUN_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-\d+$/u

export interface GateLogOptions extends CanonicalOptions {
  harnessHome: string
  /** The Run's start: runs that ended before it are left out. */
  since: string
  /** The Run's end; none while it is live. Runs that began after it are left out. */
  until?: string | null
  /** The clock, for the 8 days of a quiet worktree and the end of a live Run; Date.now() by default. */
  now?: number
}

export interface GateLogFacts {
  /** The gate runs and their steps, oldest first. */
  work: WorkFact[]
  lost: LostFact[]
}

const runStart = (name: string): number | null => {
  const match = RUN_NAME.exec(name)
  return match === null ? null : Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`)
}

const list = async (folder: string): Promise<string[]> => {
  try {
    return (await readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

const iso = (time: number): string => new Date(time).toISOString()

/** The gate runs that overlap the Run's time, and what the log has lost of them. */
export async function readGateLogs(options: GateLogOptions): Promise<GateLogFacts> {
  const root = join(options.harnessHome, 'gate', 'state', 'logs')
  const since = Date.parse(options.since)
  const until = options.until == null ? Number.POSITIVE_INFINITY : Date.parse(options.until)
  const now = options.now ?? Date.now()
  const canonical = new Map<string, Promise<string>>()
  const canonicalOf = (path: string): Promise<string> => {
    let found = canonical.get(path)
    if (found === undefined) {
      found = canonicalWorktree(path, options)
      canonical.set(path, found)
    }
    return found
  }

  const work: WorkFact[] = []
  const lost: LostFact[] = []
  for (const tag of (await list(root)).sort()) {
    const runs = (await list(join(root, tag)))
      .flatMap((name) => {
        const start = runStart(name)
        return start === null ? [] : [{ name, start }]
      })
      .sort((a, b) => a.start - b.start || (a.name < b.name ? -1 : 1))
    let worktree: string | null = null
    const missing: { start: number; end: number }[] = []
    for (const [index, { name, start }] of runs.entries()) {
      const text = await readFile(join(root, tag, name, 'timings.json'), 'utf8').catch(() => null)
      const timings = text === null ? null : parseTimings(text)
      if (timings === null) {
        const next = runs[index + 1]?.start ?? (Number.isFinite(until) ? until : now)
        if (start >= since && start <= until) missing.push({ start, end: Math.max(start, next) })
        continue
      }
      worktree ??= timings.worktree
      const end = Date.parse(timings.at)
      if (end < since || end - timings.total_ms > until) continue
      work.push(...gateRunFacts(timings, `${tag}/${name}`, await canonicalOf(timings.worktree)))
    }
    // The worktree of a tag is that of any of its runs: the tag is the hash of that path.
    const place = worktree === null ? null : await canonicalOf(worktree)
    if (place === null) continue
    for (const gap of missing) lost.push({ worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: iso(gap.start), end: iso(gap.end) })
    const oldest = runs[0]?.start
    if (runs.length >= LOG_RUNS_KEPT && oldest !== undefined && oldest > since) {
      lost.push({ worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: iso(since), end: iso(oldest) })
    }
  }
  if (Number.isFinite(until) && now - until > STALE_MS) lost.push({ ticket: null, kind: 'gate', name: 'gate', source: 'gate-logs-deleted' })
  work.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.kind === b.kind ? 0 : a.kind === 'gate' ? -1 : 1))
  return { work, lost }
}
