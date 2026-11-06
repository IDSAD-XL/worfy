// What the Harness keeps on this Machine, for Work track (worfy-work-track ticket 08): the gate runs of a
// Project over a period and the Wave markers of epic-wave, as the facts of src/shared/work-track/facts.ts.
//
// - Gate runs: every `<Harness home>/gate/state/logs/<tag>/<run>/timings.json` (harness/hooks/gate-log.mjs)
//   whose worktree — in the canonical form of src/main/flight-recorder/worktree-path.ts — is the Project's
//   root or a folder inside it (a worktree under `.claude/worktrees/`). A tag is the hash of one worktree, so
//   the first readable record of a tag tells whether the whole tag is the Project's. Time is `at` inside the
//   record, as the Flight Recorder reads it (from-gate.ts); one fact per run, its scripts are not facts here.
// - The gate keeps a record TIMINGS_KEPT_MS (31 days; 8 before worfy-work-track 01): the part of the period
//   before that limit, or before the oldest record of the Project when that is later, is a gap «no data».
// - Wave markers (worfy-work-track 02): `<Harness home>/runs/<project>/<epic>-wave-<UTC>/decisions.tsv`, the
//   first row `wave-started` with the Wave's Ticket numbers, the last `wave-finished` with `merged <N>` or
//   `stopped: <reason>`. `<project>` is the Profile's name (`bin/profile --name`). A Wave sent by hand has
//   only its marker; a Wave of a Run has its marker and its Journal lines, and the service keeps one of them
//   (sameWave).
//
// Only reading: folders are listed and files read (ADR-0005).
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gateRunFacts, parseTimings } from '../../shared/flight-recorder/from-gate'
import type { Period, SourceGap, WorkFact } from '../../shared/work-track/facts'
import { periodBounds } from '../../shared/work-track/lanes'
import { TIMINGS_KEPT_MS } from '../flight-recorder/gate-logs'
import { canonicalWorktree, type CanonicalOptions } from '../flight-recorder/worktree-path'

type Iso = string

/** The hint of the gate gap. */
export const GATE_GAP_WHY = 'Gate logs are kept 31 days: the records of older gate runs are deleted'
/**
 * How long a Wave marker without `wave-finished` counts as a Wave going on. Only a killed or crashed
 * Session leaves a marker without its end (epic-wave, section 5), and a Wave rarely runs a day.
 */
export const MARKER_OPEN_MS = 24 * 60 * 60 * 1000

/** A gate run folder: the UTC time the run started, `:` written `-`, and the gate's pid. */
const RUN_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-\d+$/u
/** A Wave folder: `<epic>-wave-<YYYYMMDDTHHMMSSZ>`. */
const WAVE_FOLDER = /^(.+)-wave-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u

const iso = (time: number): Iso => new Date(time).toISOString()

async function folders(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Whether `path` is `root` or lies inside it; both canonical (one separator `/`). */
function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

// ── gate runs ────────────────────────────────────────────────────────────────

export interface GateRunsOptions extends CanonicalOptions {
  harnessHome: string
  /** The Project's root. */
  root: string
  period: Period
  now: Iso
}

export interface GateRuns {
  facts: WorkFact[]
  gaps: SourceGap[]
}

/** The gate runs of the Project's worktrees that overlap the period, and the gap of what the gate no longer keeps. */
export async function readGateRuns(options: GateRunsOptions): Promise<GateRuns> {
  const logs = join(options.harnessHome, 'gate', 'state', 'logs')
  const bounds = periodBounds(options.period)
  const now = Date.parse(options.now)
  const root = await canonicalWorktree(options.root, options)
  const facts: WorkFact[] = []
  let oldest = Number.POSITIVE_INFINITY

  for (const tag of (await folders(logs)).sort()) {
    const runs = (await folders(join(logs, tag))).filter((name) => RUN_NAME.test(name)).sort()
    let worktree: string | null = null
    for (const name of runs) {
      const text = await readFile(join(logs, tag, name, 'timings.json'), 'utf8').catch(() => null)
      const timings = text === null ? null : parseTimings(text)
      if (timings === null) continue
      worktree ??= await canonicalWorktree(timings.worktree, options)
      // Another Project's worktree: the tag is the hash of one path, so none of its runs is ours.
      if (!inside(worktree, root)) break
      const [run] = gateRunFacts(timings, `${tag}/${name}`, worktree)
      if (run === undefined) continue
      const start = Date.parse(run.start)
      const end = Date.parse(run.end ?? run.start)
      oldest = Math.min(oldest, start)
      if (end < bounds.start || start >= bounds.end) continue
      facts.push({ id: `gate:${tag}/${name}`, kind: 'gate', start: run.start, end: run.end ?? run.start, outcome: run.outcome ?? 'ok', session: null, source: 'gate-log', title: run.name })
    }
  }

  // Before the limit nothing is kept; before the Project's oldest record, when that is later, nothing is
  // either (the gate before worfy-work-track 01 kept 8 days, and the records it removed are gone).
  const edge = Math.min(Math.max(now - TIMINGS_KEPT_MS, oldest === Number.POSITIVE_INFINITY ? 0 : oldest), bounds.end)
  const gaps: SourceGap[] = edge > bounds.start ? [{ source: 'gate-log', start: iso(bounds.start), end: iso(edge), why: GATE_GAP_WHY }] : []
  facts.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id))
  return { facts, gaps }
}

// ── Wave markers ─────────────────────────────────────────────────────────────

export interface WaveMarkerOptions {
  harnessHome: string
  /** The Profile's name: the folder of the Project's Wave logs. */
  project: string
  period: Period
  now: Iso
}

/** A Wave as its marker tells it: a fact, and every Ticket of it (`<epic>/<NN>`, as the Journal writes them). */
export interface MarkerWave {
  fact: WorkFact
  tickets: string[]
}

interface Row {
  at: number
  decision: string
  why: string
}

/** The rows of a decision log: `time_utc <TAB> decision <TAB> why <TAB> evidence`, the header left out. */
function rows(text: string): Row[] {
  const found: Row[] = []
  for (const line of text.split('\n')) {
    const [time, decision, why] = line.split('\t')
    if (time === undefined || decision === undefined || why === undefined) continue
    const at = Date.parse(time)
    if (Number.isNaN(at)) continue
    found.push({ at, decision: decision.trim(), why: why.trim() })
  }
  return found
}

/** The Ticket numbers of a `wave-started` row: `05, 06, 07`. */
const ticketNumbers = (why: string): string[] => why.split(/[,\s]+/u).filter((part) => /^\d{1,3}$/u.test(part))

/** The Waves the markers of the Project tell of that overlap the period. Folders without a `wave-started` row are not markers. */
export async function readWaveMarkers(options: WaveMarkerOptions): Promise<MarkerWave[]> {
  const dir = join(options.harnessHome, 'runs', options.project)
  const bounds = periodBounds(options.period)
  const now = Date.parse(options.now)
  const waves: MarkerWave[] = []
  for (const name of (await folders(dir)).sort()) {
    const match = WAVE_FOLDER.exec(name)
    if (match === null) continue
    const [, epic, y, mo, d, h, mi, s] = match as unknown as [string, string, string, string, string, string, string, string]
    // The folder is named when the log starts: a Wave begun after the period holds nothing of it.
    if (Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`) >= bounds.end) continue
    const text = await readFile(join(dir, name, 'decisions.tsv'), 'utf8').catch(() => null)
    if (text === null) continue
    const all = rows(text)
    const started = all.find((row) => row.decision === 'wave-started')
    if (started === undefined) continue
    const finished = all.findLast((row) => row.decision === 'wave-finished')
    const last = all.at(-1) ?? started
    const going = finished === undefined && now - started.at < MARKER_OPEN_MS
    const end = finished?.at ?? (going ? null : last.at)
    if ((end ?? now) < bounds.start) continue
    const numbers = ticketNumbers(started.why)
    const outcome = finished === undefined ? (going ? null : 'stopped') : finished.why.startsWith('stopped') ? 'stopped' : 'ok'
    waves.push({
      fact: {
        id: `wave-marker:${options.project}/${name}`,
        kind: 'wave',
        start: iso(started.at),
        end: end === null ? null : iso(end),
        outcome,
        session: null,
        epic,
        ...(numbers.length === 1 ? { ticket: numbers[0] } : {}),
        source: 'wave-marker',
        title: numbers.length === 0 ? 'Wave' : `Wave · tickets ${numbers.join(', ')}`,
      },
      tickets: numbers.map((number) => `${epic}/${number}`),
    })
  }
  return waves
}

/**
 * Whether a marker and a Wave of a Run's Journal are the same Wave: the same Epic, overlapping times (a
 * Wave with no end lasts until `now`), and a Ticket in common — or no Ticket on either side.
 */
export function sameWave(marker: MarkerWave, wave: { epic: string; start: Iso; end: Iso | null; tickets: readonly string[] }, now: Iso): boolean {
  if (marker.fact.epic !== wave.epic) return false
  const endOf = (end: Iso | null): number => Date.parse(end ?? now)
  if (Date.parse(marker.fact.start) > endOf(wave.end) || Date.parse(wave.start) > endOf(marker.fact.end)) return false
  if (marker.tickets.length === 0 || wave.tickets.length === 0) return marker.tickets.length === wave.tickets.length
  return marker.tickets.some((ticket) => wave.tickets.includes(ticket))
}
