// The Flight Recorder service (worfy-flight-recorder ticket 17): the Runs of a Project, and the
// timeline of one Run built from all four readers — the Journal (src/shared/flight-recorder/from-journal.ts),
// the transcripts (transcripts.ts), GitHub (github.ts, from-github.ts) and the gate logs with the
// verdicts of Tickets without a PR (gate-logs.ts, local-verdicts.ts) — through the span model
// (spans.ts) and its summary (summary.ts). The `runs` IPC domain (src/main/ipc/runs.ts) serves it.
//
// - Nothing is stored (decision 01, Q4): a timeline is computed each time it is opened. The readers
//   only read; the service writes nowhere (ADR-0005).
// - A Run is `<data dir>/autopilot/<run>.jsonl` (src/main/autopilot/journal.ts): the list is the
//   Project's Journals, newest first. A Run of another Project is not found by its id either.
// - What no reader holds the service adds (the table in facts.ts): `run.live` — Autopilot runs this
//   Epic of the Project now, the Journal has no run-stopped and the Run is the Project's newest; `now`;
//   the Pipeline of the Profile.
// - GitHub: only for a Project whose Tickets end with a PR (not Silent mode, not `local-green`). The
//   account is the Profile's `github.account`; without one no comment counts as a verdict or a report
//   (from-github.ts), and the view says so — no account is guessed. gh failing gives «GitHub did not
//   answer» on the PR and CI spans; «Retry» (`retry`) reads gh at once, outside the minute's step.
// - Tickets without a PR (all of them in Silent mode and `local-green`; in full mode those whose
//   branch has no PR in gh's answer) get their marks, pushes and local merge from the marks file and
//   git (local-verdicts.ts). With no answer from gh no Ticket is known to have no PR: none is read so.
// - The live timeline (decision 07): while a Run goes on and a window holds it open, a timer every
//   RECOMPUTE_INTERVAL_MS looks whether its Journal or a transcript it read has grown, and recomputes
//   if so — at most once per interval, however many lines came. gh is read at most once per
//   GITHUB_READ_INTERVAL_MS (the GithubReader keeps its answer that long), and when that interval has
//   passed the timeline is recomputed for it too. The transcripts of a live Run are read on from where
//   the last read stopped (src/main/claude-home/tail.ts), not whole: the lines read so far are kept
//   while the Run is open. A Run that is over is read whole, once per computation, and kept nowhere.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRunId, journalFileName } from '../../shared/autopilot/journal'
import type { CrossMachineGate } from '../../shared/flight-recorder/from-github'
import { githubFacts, githubNoAnswer, type GithubFacts } from '../../shared/flight-recorder/from-github'
import { journalFacts, type JournalFacts } from '../../shared/flight-recorder/from-journal'
import { buildTimeline, type LostFact, type RunFacts, type StageEventFact } from '../../shared/flight-recorder/spans'
import { summarize } from '../../shared/flight-recorder/summary'
import type { RunGithub, RunListItem, RunView } from '../../shared/ipc/runs'
import type { PipelineStage } from '../../shared/workflow/pipeline'
import { journalDir, listRuns } from '../autopilot/journal'
import type { ClientId } from '../clients'
import { readNewLines, type TailCursor } from '../claude-home/tail'
import { marksInFile, gitRunner, type GitRunner } from '../workflow/stages'
import { readGateLogs } from './gate-logs'
import { GITHUB_READ_INTERVAL_MS, GithubReader } from './github'
import { readLocalVerdicts, type LocalTicket } from './local-verdicts'
import { readRunTranscripts, streamLines, TranscriptCompactor, type ReadLines } from './transcripts'

type Env = Readonly<Record<string, string | undefined>>

/** How often an open live Run looks for new lines: the timeline changes at most this often (decision 07). */
export const RECOMPUTE_INTERVAL_MS = 5_000

/** What the timeline needs of the Project's Profile. */
export interface RunProfile {
  /** `_resolved.name`: the folder of its marks file in Silent mode; null when unknown. */
  name: string | null
  mode: 'full' | 'silent'
  /** `workflow.finish`; null when the Profile names none. */
  finish: 'pr-green-ci' | 'local-green' | null
  /** `_resolved.pipeline`, else the default Pipeline. */
  pipeline: readonly PipelineStage[]
  /** `github.account`; null when the Profile names none (`accountReason` says why). */
  account: string | null
  accountReason: string | null
  /** `cross_machine_gate`: the label and report heading of the Wait `other-machine`; null without one. */
  crossMachineGate: CrossMachineGate | null
  /** Why the values above are defaults: the Profile could not be read. Null when it was. */
  reason: string | null
}

/** Whoever gets the timeline of an open Run again after a recompute: a window, a Linked machine's client. */
export interface RunSubscriber {
  id: ClientId
  send(view: RunView): void
}

export interface FlightRecorderOptions {
  /** WORFY_DATA_DIR (the Journals) and WORFY_CLAUDE_HOME (the transcripts); process.env by default. */
  env?: Env
  /** The Harness home: its gate logs and marks files. */
  harnessHome: string
  /** The root of a Project of this Machine; throws for one that is not in the list. */
  projectRoot: (projectId: string) => string
  profile: (root: string) => Promise<RunProfile>
  /** A read-only gh command in the Project's root as its account (PrTracker.gh of src/main/github/prs.ts). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  /** Whether Autopilot works on this Epic of the Project now (running or waiting, not stopped). */
  running: (projectId: string, epic: string) => boolean
  /** The branch of each Ticket of the Epic by number (the Ticket's `Branch:` line, else `<epic>/<NN>`). */
  branches?: (root: string, epic: string) => Promise<ReadonlyMap<number, string>>
  git?: GitRunner
  /** The clock, in ms; Date.now by default. */
  now?: () => number
  /** Starts the live timer: `tick` every `ms`; answers the stop. setInterval by default. */
  schedule?: (tick: () => Promise<void>, ms: number) => () => void
  /** The incremental read of a file (src/main/claude-home/tail.ts); replaced in tests to see where a read starts. */
  tail?: typeof readNewLines
}

const iso = (ms: number): string => new Date(ms).toISOString()
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')

/** The number of a Ticket `<epic>/<NN>`, as the Journal writes it; null for anything else. */
function ticketNumber(ticket: string): number | null {
  const match = /\/(\d+)$/u.exec(ticket)
  return match === null ? null : Number(match[1])
}

/** What TailLines keeps of one file. */
interface TailedFile {
  /** Where the next read starts; undefined for a file that is not there (yet): read from its start. */
  cursor: TailCursor | undefined
  /** The lines read so far, each compacted once (TranscriptCompactor): only what the facts read. */
  lines: readonly string[]
  compactor: TranscriptCompactor
  /** The size of the file the last time it was looked at: a read, or `changed`. */
  size: number
}

/**
 * The lines of transcript files, read on from where the last read of each file stopped. A `.jsonl`
 * file is tailed (tail.ts: complete lines only, a replaced or truncated file read again from its
 * start), and each new line is parsed once and kept compacted (TranscriptCompactor of
 * transcripts.ts); any other file (a Subagent's `.meta.json`, one JSON value) is small and read whole.
 */
export class TailLines {
  private readonly files = new Map<string, TailedFile>()
  private used = new Set<string>()

  constructor(private readonly tail: typeof readNewLines = readNewLines) {}

  readonly read: ReadLines = async (file) => {
    if (!file.endsWith('.jsonl')) return streamLines(file)
    this.used.add(file)
    const known = this.files.get(file)
    let cursor = known?.cursor
    let lines: readonly string[] = known?.lines ?? []
    let compactor = known?.compactor ?? new TranscriptCompactor()
    let reset = false
    for (;;) {
      const chunk = await this.tail(file, cursor)
      if (chunk.cursor.fileId === null) {
        // Not there: a Subagent's file before its first line, a transcript deleted. Kept with size -1,
        // so `changed` sees the file when it comes.
        this.files.set(file, { cursor: undefined, lines: [], compactor: new TranscriptCompactor(), size: -1 })
        return null
      }
      if (chunk.reset) {
        // Another file, or this one rewritten: what was read of it no longer stands.
        lines = []
        compactor = new TranscriptCompactor()
        reset = true
      }
      const added = chunk.lines.flatMap((line) => {
        const compact = compactor.line(line)
        return compact === null ? [] : [compact]
      })
      if (added.length > 0) lines = lines.concat(added)
      cursor = chunk.cursor
      if (!chunk.more) break
    }
    // A half-written last line lies past the cursor: the size `changed` saw last stays, so a line
    // that is never finished does not count as new on every step.
    const offset = cursor?.offset ?? 0
    const size = known === undefined || reset ? offset : Math.max(known.size, offset)
    this.files.set(file, { cursor, lines, compactor, size })
    return lines
  }

  /** Starts a computation: the files it does not read again are let go at `settle`. */
  begin(): void {
    this.used = new Set()
  }

  settle(): void {
    for (const file of this.files.keys()) if (!this.used.has(file)) this.files.delete(file)
  }

  /** Whether a file read so far has another size than it had: new lines, or a file replaced or gone. */
  async changed(): Promise<boolean> {
    let changed = false
    for (const [file, entry] of this.files) {
      const size = await stat(file).then(
        (info) => info.size,
        () => -1,
      )
      if (size !== entry.size) {
        entry.size = size
        changed = true
      }
    }
    return changed
  }

  clear(): void {
    this.files.clear()
  }
}

/** One Run a window holds open. */
interface OpenRun {
  projectId: string
  run: string
  subscribers: Map<ClientId, RunSubscriber>
  profile: RunProfile | null
  lines: TailLines
  journalSize: number
  live: boolean
  githubAt: number | null
  /** The last timeline the subscribers got. */
  last: RunView | null
  /** A recompute in flight; the next one waits for it, so two never interleave their reads. */
  busy: Promise<unknown> | null
}

/** One computation's inputs that the next one may reuse. */
interface ComputeState {
  profile: RunProfile | null
  lines: TailLines | null
  retry: boolean
}

export class FlightRecorder {
  private readonly env: Env
  private readonly now: () => number
  private readonly git: GitRunner
  private readonly github: GithubReader
  private readonly open_ = new Map<string, OpenRun>()
  private stopTimer: (() => void) | null = null
  private ticking: Promise<void> | null = null

  constructor(private readonly options: FlightRecorderOptions) {
    this.env = options.env ?? process.env
    this.now = options.now ?? Date.now
    this.git = options.git ?? gitRunner
    this.github = new GithubReader({ gh: options.gh, now: this.now })
  }

  /** The Runs of the Project, newest first; with `epic`, those of that Epic only. */
  async list(projectId: string, epic?: string): Promise<RunListItem[]> {
    // A Project that is not in the list has no Runs to show, whatever Journals name it.
    this.options.projectRoot(projectId)
    const items: RunListItem[] = []
    const runs = await listRuns(projectId, { env: this.env })
    const newest = runs[0]?.run
    for (const summary of runs) {
      if (epic !== undefined && summary.epic !== epic) continue
      const journal = await this.journal(summary.run, projectId).catch(() => null)
      if (journal === null) continue
      const live = this.isLive(projectId, summary.run, journal.facts, newest)
      const { run } = journal.facts
      items.push({ run: summary.run, epic: journal.facts.epic, startedAt: run.startedAt, stoppedAt: run.stoppedAt, reason: run.reason ?? null, live, tickets: journal.facts.tickets })
    }
    return items
  }

  /** The timeline of a Run of the Project, computed now. */
  async view(projectId: string, run: string): Promise<RunView> {
    return (await this.compute(projectId, run, { profile: null, lines: null, retry: false })).view
  }

  /**
   * The timeline of a Run, and from now on the recomputed one to `subscriber` while the Run goes on,
   * until `close` or `drop`.
   */
  async open(projectId: string, run: string, subscriber: RunSubscriber): Promise<RunView> {
    // The entry and the subscriber are in place before the first await: a `drop` or `close` while the
    // timeline is computed finds them, and a second open of the same Run joins this entry.
    const key = `${projectId}\n${run}`
    let entry = this.open_.get(key)
    if (entry === undefined) {
      entry = { projectId, run, subscribers: new Map(), profile: null, lines: new TailLines(this.options.tail), journalSize: -1, live: false, githubAt: null, last: null, busy: null }
      this.open_.set(key, entry)
    }
    entry.subscribers.set(subscriber.id, subscriber)
    try {
      const view = await this.recompute(entry, false)
      this.sync()
      return view
    } catch (error) {
      // No timeline to follow: the subscriber goes, and the entry with it when no one else holds it.
      if (entry.subscribers.get(subscriber.id) === subscriber) entry.subscribers.delete(subscriber.id)
      if (entry.subscribers.size === 0 && this.open_.get(key) === entry) this.forget(key, entry)
      this.sync()
      throw error
    }
  }

  /** Stops the timeline of the Run for one subscriber; false if it did not hold it. */
  close(projectId: string, run: string, id: ClientId): boolean {
    const key = `${projectId}\n${run}`
    const entry = this.open_.get(key)
    const closed = entry?.subscribers.delete(id) ?? false
    if (entry !== undefined && entry.subscribers.size === 0) this.forget(key, entry)
    this.sync()
    return closed
  }

  /** A subscriber is gone (its window closed, a Linked machine lost access): every Run it held. */
  drop(id: ClientId): void {
    for (const [key, entry] of this.open_) {
      entry.subscribers.delete(id)
      if (entry.subscribers.size === 0) this.forget(key, entry)
    }
    this.sync()
  }

  /** «Retry»: gh is read for the Run at once, and the new timeline goes to its subscribers too. */
  async retry(projectId: string, run: string): Promise<RunView> {
    const key = `${projectId}\n${run}`
    const entry = this.open_.get(key)
    if (entry === undefined) return (await this.compute(projectId, run, { profile: null, lines: null, retry: true })).view
    const view = await this.recompute(entry, true)
    if (this.open_.get(key) === entry) for (const subscriber of entry.subscribers.values()) subscriber.send(view)
    this.sync()
    return view
  }

  /**
   * One step of the live timer: each open live Run whose Journal or read transcripts grew, or whose
   * gh answer is older than its interval, is recomputed and sent to its subscribers.
   */
  tick(): Promise<void> {
    // A step that outlasts the interval is not run twice at once: the next one joins it.
    if (this.ticking === null) {
      const step = this.step().finally(() => {
        this.ticking = null
      })
      this.ticking = step
    }
    return this.ticking
  }

  private async step(): Promise<void> {
    for (const [key, entry] of [...this.open_.entries()]) {
      // A Run whose recompute is in flight (an open, a «Retry») is looked at on the next step.
      if (!entry.live || entry.busy !== null || entry.subscribers.size === 0) continue
      const journal = await this.journalSize(entry.run)
      const grew = journal !== entry.journalSize
      const transcripts = await entry.lines.changed()
      const github = entry.githubAt !== null && this.now() - entry.githubAt >= GITHUB_READ_INTERVAL_MS
      if (!grew && !transcripts && !github) continue
      let view: RunView
      try {
        view = await this.recompute(entry, false)
      } catch (error) {
        // The live timeline ends here: the subscribers get the last one, not live, with the reason; the
        // timer stops looking at this Run (the window may open it again).
        const reason = messageOf(error)
        console.warn(`[flight-recorder] the timeline of Run ${entry.run} could not be recomputed: ${reason}`)
        entry.live = false
        if (entry.last === null) continue
        view = { ...entry.last, timeline: { ...entry.last.timeline, live: false }, error: `the timeline could not be recomputed: ${reason}` }
        entry.last = view
      }
      // Let go while it was recomputed (closed, dropped, disposed): no one is to get it.
      if (this.open_.get(key) !== entry) continue
      for (const subscriber of entry.subscribers.values()) subscriber.send(view)
    }
    this.sync()
  }

  /** Stops the timer and lets every open Run go. */
  dispose(): void {
    for (const [key, entry] of this.open_) this.forget(key, entry)
    this.sync()
  }

  /** A Run goes on: its Journal has no run-stopped, it is the Project's newest, and Autopilot works on its Epic. */
  private isLive(projectId: string, run: string, facts: JournalFacts, newest: string | undefined): boolean {
    return facts.run.stoppedAt === null && newest === run && this.options.running(projectId, facts.epic)
  }

  private forget(key: string, entry: OpenRun): void {
    entry.lines.clear()
    this.open_.delete(key)
  }

  /** The timer runs while an open Run goes on. */
  private sync(): void {
    const needed = [...this.open_.values()].some((entry) => entry.live && entry.subscribers.size > 0)
    if (needed && this.stopTimer === null) {
      const schedule =
        this.options.schedule ??
        ((tick, ms) => {
          const timer = setInterval(() => void tick(), ms)
          return () => clearInterval(timer)
        })
      this.stopTimer = schedule(() => this.tick(), RECOMPUTE_INTERVAL_MS)
    } else if (!needed && this.stopTimer !== null) {
      this.stopTimer()
      this.stopTimer = null
    }
  }

  private recompute(entry: OpenRun, retry: boolean): Promise<RunView> {
    const run = async (): Promise<RunView> => {
      entry.journalSize = await this.journalSize(entry.run)
      if (retry) entry.profile = null
      const result = await this.compute(entry.projectId, entry.run, { profile: entry.profile, lines: entry.lines, retry })
      entry.profile = result.profile
      entry.live = result.view.timeline.live
      entry.githubAt = result.view.github.state === 'unused' ? null : result.view.github.at
      entry.last = result.view
      return result.view
    }
    const next = (entry.busy ?? Promise.resolve()).then(run, run)
    const settled = next.catch(() => undefined)
    entry.busy = settled
    void settled.then(() => {
      if (entry.busy === settled) entry.busy = null
    })
    return next
  }

  private async journalSize(run: string): Promise<number> {
    return stat(join(journalDir(this.env), journalFileName(run))).then(
      (info) => info.size,
      () => -1,
    )
  }

  /** The Journal of a Run of the Project: its facts; throws when there is none. */
  private async journal(run: string, projectId: string): Promise<{ facts: JournalFacts }> {
    const notFound = new Error(`there is no Run ${run} of this Project`)
    if (!isRunId(run)) throw notFound
    let text: string
    try {
      text = await readFile(join(journalDir(this.env), journalFileName(run)), 'utf8')
    } catch (error) {
      if (missing(error)) throw notFound
      throw error
    }
    const lines = text.split('\n').filter((line) => line.trim() !== '')
    // The Project of a Run is that of its run-started line, as listRuns reads it.
    const start = lines.map((line) => parseLine(line)).find((value) => value !== null && value.kind === 'run-started' && value.run === run)
    if (start?.project !== projectId) throw notFound
    const facts = journalFacts({ run, lines })
    if (facts === null) throw notFound
    return { facts }
  }

  private async compute(projectId: string, run: string, state: ComputeState): Promise<{ view: RunView; profile: RunProfile }> {
    const journal = (await this.journal(run, projectId)).facts
    const root = this.options.projectRoot(projectId)
    const now = this.now()
    const newest = (await listRuns(projectId, { env: this.env }))[0]?.run
    const live = this.isLive(projectId, run, journal, newest)
    const end = journal.run.stoppedAt ?? (live ? null : (journal.run.lastSeenAt ?? null))
    const profile = state.profile ?? (await this.options.profile(root))

    // The transcripts: tailed while the Run goes on and every Wave names its Session; a Wave found by
    // its text would make the reader scan every transcript of the folder, and none of them is kept.
    const tailed = live && state.lines !== null && journal.waves.every((wave) => wave.session !== undefined)
    if (!tailed) state.lines?.clear()
    state.lines?.begin()
    const transcripts = await readRunTranscripts(
      { epic: journal.epic, root, startedAt: journal.run.startedAt, stoppedAt: end, waves: journal.waves },
      { env: this.env, readLines: tailed && state.lines !== null ? state.lines.read : streamLines },
    )
    state.lines?.settle()

    // The branches of the Tickets: the gh read and the Tickets without a PR need them.
    const known = (await this.options.branches?.(root, journal.epic).catch(() => null)) ?? null
    const branchOf = (ticket: string): string => {
      const num = ticketNumber(ticket)
      return (num === null ? undefined : known?.get(num)) ?? ticket
    }
    const tickets = journal.tickets.map((ticket) => ({ ticket, branch: branchOf(ticket) }))

    // GitHub.
    let github: GithubFacts = { ticketEvents: [], work: [], waits: [], lost: [] }
    let githubState: RunGithub
    let withPr: Set<string> | null = new Set()
    if (profile.mode === 'silent' || profile.finish === 'local-green') {
      githubState = { state: 'unused', reason: profile.mode === 'silent' ? 'Silent mode: the Tickets end without a PR' : 'workflow.finish is local-green: the Tickets end without a PR' }
    } else {
      const read = await this.github.read(root, tickets.map(({ branch }) => branch), { retry: state.retry })
      if (read.answer === null) {
        github = githubNoAnswer()
        githubState = { state: 'no-answer', at: read.at, reason: read.error }
        withPr = null
      } else {
        github = githubFacts(read.answer, { tickets, window: { start: journal.run.startedAt, end }, account: profile.account, crossMachineGate: profile.crossMachineGate })
        githubState = { state: 'answered', at: read.at, account: profile.account, accountReason: profile.account === null ? (profile.accountReason ?? 'the Profile names no github.account') : null }
        withPr = new Set(read.answer.prs.flatMap((pr) => (typeof pr.headRefName === 'string' ? [pr.headRefName] : [])))
      }
    }

    // The gate logs of the Run's window.
    const gate = await readGateLogs({ harnessHome: this.options.harnessHome, since: journal.run.startedAt, until: end, now })

    // The Tickets without a PR that were worked on (a status other than open): marks file and git.
    let local: { ticketEvents: StageEventFact[]; lost: LostFact[] } = { ticketEvents: [], lost: [] }
    const worked = new Set(journal.ticketEvents.filter((event) => event.event === 'status' && event.state !== 'open').map((event) => event.ticket))
    const localTickets: LocalTicket[] =
      withPr === null
        ? []
        : tickets.flatMap(({ ticket, branch }) => {
            const num = ticketNumber(ticket)
            return worked.has(ticket) && !withPr.has(branch) && num !== null ? [{ ticket, epic: journal.epic, num, branch }] : []
          })
    if (localTickets.length > 0) {
      const inFile = profile.name !== null && (await marksInFile(profile, async () => (await this.git(root, ['remote', 'get-url', 'origin'])).code === 0))
      local = await readLocalVerdicts({ repo: root, tickets: localTickets, marksFile: inFile && profile.name !== null ? { harnessHome: this.options.harnessHome, project: profile.name } : null, git: this.git })
    }

    const facts: RunFacts = {
      run: { ...journal.run, live },
      now: iso(now),
      pipeline: profile.pipeline,
      waves: journal.waves,
      ticketEvents: [...journal.ticketEvents, ...github.ticketEvents, ...local.ticketEvents],
      work: [...transcripts.work, ...github.work, ...gate.work],
      retryCauses: journal.retryCauses,
      waits: [...journal.waits, ...github.waits],
      turns: transcripts.turns,
      lost: [...transcripts.lost, ...github.lost, ...gate.lost, ...local.lost],
      orchestratorMarks: journal.orchestratorMarks,
    }
    const timeline = buildTimeline(facts)
    const view: RunView = { projectId, run, epic: journal.epic, timeline, summary: summarize(timeline), github: githubState, profileReason: profile.reason, skippedLines: journal.skipped, error: null }
    return { view, profile }
  }
}

/** A Journal line's `kind`, `run` and `project`; null for a line that is not a JSON object. */
function parseLine(line: string): { kind?: unknown; run?: unknown; project?: unknown } | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as { kind?: unknown; run?: unknown; project?: unknown }) : null
  } catch {
    return null
  }
}
