// The Work track service (worfy-work-track ticket 08): the work of a Project on this Machine over a Day, a
// Week or a Month, from every source the spec names, through the model of src/shared/work-track/. The
// `workTrack` IPC domain (src/main/ipc/work-track.ts) serves it.
//
// - Run journals (src/main/autopilot/journal.ts, listRuns; parsed by src/shared/flight-recorder/from-journal.ts):
//   the Runs and their Waves. A Run goes on while its Journal has no run-stopped, it is the Project's newest
//   and Autopilot works on its Epic, as Flight Recorder decides it (src/main/flight-recorder/service.ts).
// - Wave markers and gate runs: harness-state.ts. A Wave of a Run and its marker are one Wave (sameWave): the
//   Journal's stays, with its Run.
// - Transcripts of every Session (transcripts.ts, ticket 05), GitHub (github.ts, ticket 06), the Ticket
//   status changes from git (ticket-status.ts, ticket 07).
// - A turn or a Subagent of the Session a Run's Wave went to, begun within that Wave and named no Epic by its
//   reader, takes the Wave as its parent: the Epic of the Wave (the spec's heuristic «by the Wave»).
//
// Nothing is stored and nothing is written (ADR-0005, ADR-0092): every read computes the facts again, and only
// the readers' own memory caches (the parses of the transcripts, the gh answer of an interval) outlive it.
// The transcripts and GitHub are slow (a month: ~12 s and ~50 s on a first read), so they are read in the
// background: `read` answers with what the other sources gave and names the slow ones still being read in
// `loading`; `read` with `wait` answers once they are in. Their read is kept for the Project's last period
// until an answer has had them all (or, unclaimed, for GITHUB_READ_INTERVAL_MS); a read of another period
// starts its own.
//
// A source that fails is a gap of the period with the reason, never an empty answer: the others still come.
import { readFile } from 'node:fs/promises'
import { journalFacts as parseJournal } from '../../shared/flight-recorder/from-journal'
import type { WorkTrackSlowSource, WorkTrackView } from '../../shared/ipc/work-track'
import type { Period, SessionInfo, SourceGap, WorkFact, WorkSource, WorkTrackInput } from '../../shared/work-track/facts'
import { periodBounds } from '../../shared/work-track/lanes'
import { summarize } from '../../shared/work-track/summary'
import { listRuns } from '../autopilot/journal'
import { parseRemote } from '../github/remote'
import type { HistoryPart } from '../vendors/history'
import { gitRunner, type GitRunner } from '../workflow/stages'
import { GITHUB_READ_INTERVAL_MS, WorkGithubReader } from './github'
import { readGateRuns, readWaveMarkers, sameWave, type MarkerWave } from './harness-state'
import { readTicketStatusFacts } from './ticket-status'
import { readProjectTranscripts, type CanvasSession, type ProjectTranscripts, type TranscriptCache } from './transcripts'

type Env = Readonly<Record<string, string | undefined>>
type Iso = string

export interface WorkTrackOptions {
  /** WORFY_DATA_DIR (the Journals) and WORFY_CLAUDE_HOME (the transcripts); process.env by default. */
  env?: Env
  /** The Harness home: its gate logs and Wave markers. */
  harnessHome: string
  /** The root of a Project of this Machine; throws for one that is not in the list. */
  projectRoot: (projectId: string) => string
  /** The Profile's name (`bin/profile --name`): the folder of the Project's Wave markers; null — none is read. */
  harnessProject: (root: string) => Promise<string | null>
  /** The Sessions of the Project with a Node on the Canvas. */
  canvas: (projectId: string) => Promise<readonly CanvasSession[]>
  /** A read-only gh command in the Project's root as its account (PrTracker.gh of src/main/github/prs.ts). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  /** Whether Autopilot works on this Epic of the Project now (running or waiting, not stopped). */
  running: (projectId: string, epic: string) => boolean
  /** The history part of the Codex driver; null or absent — no Codex threads are read. */
  codex?: () => HistoryPart | null
  /** Runs git in a folder (`remote get-url origin`); gitRunner by default. */
  git?: GitRunner
  /** The git program of the Ticket status reader; `git` on the PATH by default. */
  gitProgram?: string
  /** The parses of the transcripts kept between reads; the app's own by default. */
  transcriptCache?: TranscriptCache
  platform?: NodeJS.Platform
  /** The clock, in ms; Date.now by default. */
  now?: () => number
}

export interface WorkTrackReadOptions {
  /** Answer once the slow sources are in, not without them. */
  wait?: boolean
}

/** A part of the facts, with the gaps of what it could not read. */
interface Part {
  facts: WorkFact[]
  gaps: SourceGap[]
  sessions?: SessionInfo[]
}

/** A slow source being read: its answer once it is in. Its promise never rejects. */
interface Pending {
  promise: Promise<Part>
  part: Part | null
}

/** The slow reads of a Project's period. */
interface SlowRead {
  key: string
  /** When it started, in ms. */
  at: number
  sources: Record<WorkTrackSlowSource, Pending>
}

/** A Wave of a Journal, with what tells it from a marker. */
interface JournalWave {
  fact: WorkFact
  epic: string
  tickets: readonly string[]
}

const iso = (time: number): Iso => new Date(time).toISOString()
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const ticketNumber = (ticket: string): string => ticket.slice(ticket.lastIndexOf('/') + 1)

function track(promise: Promise<Part>): Pending {
  const pending: Pending = { promise: promise.then((part) => (pending.part = part)), part: null }
  return pending
}

export class WorkTrackService {
  private readonly env: Env
  private readonly now: () => number
  private readonly git: GitRunner
  private readonly github: WorkGithubReader
  /** The slow reads of each Project's last period. */
  private readonly slow = new Map<string, SlowRead>()

  constructor(private readonly options: WorkTrackOptions) {
    this.env = options.env ?? process.env
    this.now = options.now ?? Date.now
    this.git = options.git ?? gitRunner
    this.github = new WorkGithubReader({ gh: options.gh, now: this.now })
  }

  /** The Work track of the Project over the period, computed now. */
  async read(projectId: string, period: Period, options: WorkTrackReadOptions = {}): Promise<WorkTrackView> {
    const root = this.options.projectRoot(projectId)
    const now = iso(this.now())
    const bounds = periodBounds(period)
    const whole = { start: iso(bounds.start), end: iso(Math.max(bounds.start, Math.min(bounds.end, Date.parse(now)))) }
    /** A source that failed: a gap of the period up to now, with the reason. */
    const failed = (source: WorkSource, what: string) => (error: unknown): Part => ({ facts: [], gaps: [{ source, ...whole, why: `${what}: ${messageOf(error)}` }] })

    const key = `${period.kind}\n${period.start}`
    let slow = this.slow.get(projectId)
    // A read whose answers came in long ago and no answer took (its window went away) is not given again.
    const stale = slow !== undefined && Object.values(slow.sources).every((pending) => pending.part !== null) && this.now() - slow.at >= GITHUB_READ_INTERVAL_MS
    if (slow === undefined || slow.key !== key || stale) {
      slow = {
        key,
        at: this.now(),
        sources: {
          transcripts: track(this.transcripts(projectId, root, period, now).catch(failed('transcript', 'The transcripts could not be read'))),
          github: track(this.githubPart(root, period).catch(failed('github', 'GitHub did not answer'))),
        },
      }
      this.slow.set(projectId, slow)
    }

    const [journal, markers, gate, statuses] = await Promise.all([
      this.journals(projectId, period, now).catch((error: unknown) => ({ waves: [] as JournalWave[], ...failed('journal', 'The Run journals could not be read')(error) })),
      this.markers(root, period, now).catch((error: unknown) => ({ waves: [] as MarkerWave[], ...failed('wave-marker', 'The Wave markers could not be read')(error) })),
      readGateRuns({ harnessHome: this.options.harnessHome, root, period, now, ...(this.options.platform ? { platform: this.options.platform } : {}) }).catch(failed('gate-log', 'The gate logs could not be read')),
      readTicketStatusFacts({ repo: root, since: iso(bounds.start), until: iso(bounds.end), ...(this.options.gitProgram ? { git: this.options.gitProgram } : {}) })
        .then((facts): Part => ({ facts, gaps: [] }))
        .catch(failed('git', 'git did not answer')),
    ])
    if (options.wait) await Promise.all(Object.values(slow.sources).map((pending) => pending.promise))
    const loading = (Object.keys(slow.sources) as WorkTrackSlowSource[]).filter((source) => slow.sources[source].part === null)
    // Every slow source has reached an answer: the next read starts them again (their caches keep it quick).
    if (loading.length === 0 && this.slow.get(projectId) === slow) this.slow.delete(projectId)
    const transcripts = slow.sources.transcripts.part ?? { facts: [], gaps: [], sessions: [] }
    const github = slow.sources.github.part ?? { facts: [], gaps: [] }

    // A marker of a Run's Wave is that Wave: the Journal's stays.
    const handWaves = markers.waves.filter((marker) => !journal.waves.some((wave) => sameWave(marker, { epic: wave.epic, start: wave.fact.start, end: wave.fact.end, tickets: wave.tickets }, now)))
    const work = withWaveParents(transcripts.facts, journal.waves, now)

    const input: WorkTrackInput = {
      period,
      now,
      facts: [...journal.facts, ...handWaves.map((wave) => wave.fact), ...work, ...github.facts, ...gate.facts, ...statuses.facts],
      sessions: transcripts.sessions ?? [],
      gaps: [...journal.gaps, ...markers.gaps, ...transcripts.gaps, ...github.gaps, ...gate.gaps, ...statuses.gaps],
    }
    return { projectId, period, now, facts: [...input.facts], sessions: [...input.sessions], gaps: [...input.gaps], summary: summarize(input), loading }
  }

  /** The Runs of the Project's Journals that overlap the period, and their Waves. */
  private async journals(projectId: string, period: Period, now: Iso): Promise<Part & { waves: JournalWave[] }> {
    const bounds = periodBounds(period)
    const runs = await listRuns(projectId, { env: this.env })
    const newest = runs[0]?.run
    const facts: WorkFact[] = []
    const waves: JournalWave[] = []
    for (const summary of runs) {
      if (Date.parse(summary.startedAt) >= bounds.end) continue
      const text = await readFile(summary.file, 'utf8').catch(() => null)
      if (text === null) continue
      const journal = parseJournal({ run: summary.run, lines: text.split('\n').filter((line) => line.trim() !== '') })
      if (journal === null) continue
      const { run, epic } = journal
      const live = run.stoppedAt === null && newest === summary.run && this.options.running(projectId, epic)
      const runEnd = run.stoppedAt ?? (live ? null : (run.lastSeenAt ?? run.startedAt))
      if (Date.parse(runEnd ?? now) < bounds.start) continue
      const runId = `run:${summary.run}`
      facts.push({ id: runId, kind: 'run', start: run.startedAt, end: runEnd, outcome: runEnd === null ? null : (run.outcome ?? 'stopped'), session: null, epic, source: 'journal', title: `Run · ${epic}` })
      for (const [index, wave] of journal.waves.entries()) {
        const last = index === journal.waves.length - 1
        const end = wave.finishedAt ?? (live && last ? null : (wave.lastSeenAt ?? runEnd ?? wave.startedAt))
        const numbers = wave.tickets.map(ticketNumber)
        const fact: WorkFact = {
          id: `wave:${summary.run}:${wave.number}`,
          kind: 'wave',
          start: wave.startedAt,
          end,
          outcome: wave.finishedAt !== null ? 'ok' : end === null ? null : 'stopped',
          session: wave.session ?? null,
          parent: runId,
          epic,
          ...(numbers.length === 1 ? { ticket: numbers[0] } : {}),
          source: 'journal',
          title: numbers.length === 0 ? `Wave ${wave.number}` : `Wave ${wave.number} · tickets ${numbers.join(', ')}`,
        }
        facts.push(fact)
        waves.push({ fact, epic, tickets: wave.tickets })
      }
    }
    return { facts, gaps: [], waves }
  }

  private async markers(root: string, period: Period, now: Iso): Promise<Part & { waves: MarkerWave[] }> {
    const project = await this.options.harnessProject(root)
    if (project === null) return { facts: [], gaps: [], waves: [] }
    return { facts: [], gaps: [], waves: await readWaveMarkers({ harnessHome: this.options.harnessHome, project, period, now }) }
  }

  private async transcripts(projectId: string, root: string, period: Period, now: Iso): Promise<Part> {
    const canvas = await this.options.canvas(projectId)
    const read: ProjectTranscripts = await readProjectTranscripts(
      { root, period, now, canvas },
      {
        env: this.env,
        codex: this.options.codex?.() ?? null,
        ...(this.options.platform ? { platform: this.options.platform } : {}),
        ...(this.options.transcriptCache ? { cache: this.options.transcriptCache } : {}),
      },
    )
    return read
  }

  /** The PRs and CI runs of the repository of the Project's `origin`; none for a Project without a remote repository. */
  private async githubPart(root: string, period: Period): Promise<Part> {
    const origin = await this.git(root, ['remote', 'get-url', 'origin']).catch(() => null)
    const remote = origin?.code === 0 ? parseRemote(origin.stdout) : null
    if (remote === null) return { facts: [], gaps: [] }
    const read = await this.github.read(root, { owner: remote.owner, name: remote.repo }, period)
    return { facts: read.facts, gaps: read.gaps }
  }
}

/**
 * The turns and Subagents with the Wave of a Run they were part of as their parent: of the Session the
 * Wave went to, begun within it, with no parent and no Epic of their own.
 */
function withWaveParents(facts: readonly WorkFact[], waves: readonly JournalWave[], now: Iso): WorkFact[] {
  const bySession = new Map<string, WorkFact[]>()
  for (const { fact } of waves) if (fact.session !== null) bySession.set(fact.session, [...(bySession.get(fact.session) ?? []), fact])
  return facts.map((fact) => {
    if ((fact.kind !== 'turn' && fact.kind !== 'subagent') || fact.session === null || fact.parent !== undefined || fact.epic !== undefined) return fact
    const at = Date.parse(fact.start)
    const wave = bySession.get(fact.session)?.find((candidate) => at >= Date.parse(candidate.start) && at <= Date.parse(candidate.end ?? now))
    return wave === undefined ? fact : { ...fact, parent: wave.id }
  })
}
