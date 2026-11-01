// The gate runs of a Run (worfy-flight-recorder ticket 16): every
// `<Harness home>/gate/state/logs/<tag>/<run>/timings.json` the gate keeps (harness/hooks/gate-log.mjs),
// read into work facts by src/shared/flight-recorder/from-gate.ts. The tag is not computed: the
// folders of every worktree are read, and a run names its `head` and `worktree` itself. Which
// Ticket a run belongs to is the model's step (spans.ts): by `head`, without a PR by `worktree`.
// The worktree is handed over canonical: realpath(3) (on Windows it expands an 8.3 short name like
// `RUNNER~1` and gives the drive letter's case), then `comparablePath` (one separator and no letter
// case on Windows) — the form reader 14 hands an agent's folder over in.
//
// Time is `at` inside timings.json, never a file's mtime. What the gate log no longer holds is a
// lost fact «gate logs deleted (10 runs or 8 days)» (`LOG_RUNS_KEPT` runs per worktree, the folder of
// a worktree untouched for 8 days removed — `STALE_MS` of gate-log.mjs):
// - a worktree whose kept runs are `LOG_RUNS_KEPT` and all began after the Run started: its older
//   runs may be gone;
// - a run folder of the Run's time with no readable timings.json: a known run without its record;
// - a Run that ended more than 8 days ago: the folders of its worktrees may be gone, so every
//   Ticket the model finds no gate run for gets the label.
// Nothing is written: folders are listed and files read.
import { realpath } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { comparablePath, gateRunFacts, parseTimings } from '../../shared/flight-recorder/from-gate'
import type { LostFact, WorkFact } from '../../shared/flight-recorder/facts'

const realpathNative = promisify(realpath.native)

/** gate-log.mjs: the runs kept per worktree. */
export const LOG_RUNS_KEPT = 10
/** gate-log.mjs: a worktree's folder untouched for longer is removed. */
export const STALE_MS = 8 * 24 * 60 * 60 * 1000
/** A run folder's name: the UTC time the run started, `:` written `-`, and the gate's pid. */
const RUN_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-\d+$/u

export interface CanonicalOptions {
  /** `process.platform` by default; `win32` checks the Windows rules on any system. */
  platform?: string
  /** realpath(3) by default. */
  realpath?: (path: string) => Promise<string>
}

/** A worktree path in the form the model compares: realpath, then `comparablePath`; the path itself when realpath fails. */
export async function canonicalWorktree(path: string, options: CanonicalOptions = {}): Promise<string> {
  const resolve = options.realpath ?? ((target: string) => realpathNative(target))
  let real = path
  try {
    real = await resolve(path)
  } catch {
    // A worktree that is gone keeps the spelling the gate wrote.
  }
  return comparablePath(real, options.platform ?? process.platform)
}

export interface GateLogOptions extends CanonicalOptions {
  harnessHome: string
  /** The Run's start: runs that ended before it are left out. */
  since: string
  /** The Run's end; none while it is live. Runs that began after it are left out. */
  until?: string | null
  /** The clock, for the 8 days of a quiet worktree; Date.now() by default. */
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
    const runs = (await list(join(root, tag))).filter((name) => runStart(name) !== null).sort()
    let worktree: string | null = null
    const missing: number[] = []
    for (const name of runs) {
      const started = runStart(name) as number
      const text = await readFile(join(root, tag, name, 'timings.json'), 'utf8').catch(() => null)
      const timings = text === null ? null : parseTimings(text)
      if (timings === null) {
        if (started >= since && started <= until) missing.push(started)
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
    for (const start of missing) lost.push({ worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: new Date(start).toISOString() })
    const oldest = runs.length ? runStart(runs[0] as string) : null
    if (runs.length >= LOG_RUNS_KEPT && oldest !== null && oldest > since) lost.push({ worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted' })
  }
  if (Number.isFinite(until) && now - until > STALE_MS) lost.push({ ticket: null, kind: 'gate', name: 'gate', source: 'gate-logs-deleted' })
  work.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.kind === b.kind ? 0 : a.kind === 'gate' ? -1 : 1))
  return { work, lost }
}
