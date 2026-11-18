// The continuation of the Sessions a restart of worfy cut off (worfy-continuity ticket 05; the spec's section on
// continuing a Session). After the Projects are opened (app-orchestrators.ts) it reads `live-sessions.json` of every Project (the
// record of ticket 03, src/shared/agent/live-sessions.ts) and, for each Session that was in a turn or had a queue:
//
// 1. A Session a Run owns (`runId`) is left alone: the Run continues it (ticket 06), as Auto-continue stays silent
//    while a Run owns a Session (orchestrator-continue.ts).
// 2. The unknown side effects (ticket 16, unknownSideEffects) come first: a call of the cut-off turn, or of an
//    Interrupted Subagent of the Session, that may have reached outside and has no result keeps the Session from
//    being continued by itself. Only the cut-off turn is given to that function (cutOffTurn): it counts every call
//    without a result among the events it gets, and an earlier turn a person interrupted may hold one. The
//    transcript is read before the resume: Claude Code's resume writes a result of its own for such a call (spike
//    01, question 6).
// 3. The rule of the hour and the cap (continuityRule): the age is from the record's last event to the start; at
//    most CONTINUE_CAP continuations by worfy itself within the hour (the count is in the record).
// 4. The previous Claude Code process of the Session must be gone: after a crash of worfy it may run on without
//    its parent and still write the transcript, and the registry knows only the processes of this run of the app.
//    The Claude home names the process of a session (`~/.claude/sessions/<pid>.json`, as Resume reads it); the
//    list of processes tells whether its parent is gone (parentState), the way the swap helper of an Update tells
//    worfy's own processes (scripts/install-stable.mjs, copyProcesses): macOS gives an orphan to launchd (ppid 1),
//    Windows keeps the pid of the parent that is gone, which a later process may have taken. An orphan is waited
//    for EXIT_WAIT_MS, then killed and waited for KILL_EXIT_MS (ADR-0064). A process whose parent runs is another
//    program's: the Session is not continued.
// 5. The continuation: a Session Node through NodeSessions.start, the Orchestrator through its open() (both resume
//    the saved session; Codex through `thread/resume`), then one message, restartText, the queue as it was (held
//    stays held) and the `notice` line «worfy: restarted at 14:05 (update), sent "continue"».
//
// A Session Node that is not continued gets the chip «Interrupted by restart» and Continue (NodeSessions.interrupted):
// Continue is Resume, then the same message and queue. An Orchestrator that is not continued is only logged: the
// spec puts the chip on the Session Node.
//
// shortcut: the Subagents of a Codex Session (its own threads) are not read for unknown side effects, only the
// Session's thread; redo when the Codex driver gives a Subagent thread's items by its parent.
// shortcut: the record of a Session that was not continued stays only until another Session of its Project writes
// the file (live-sessions.ts): a second restart before Continue loses the chip. Redo with a record that keeps it.
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { baseName } from '../../shared/agent/attachments'
import { restartText, type RestartCause, type RestartSubagent } from '../../shared/agent/continue-plan'
import type { AgentEvent } from '../../shared/agent/events'
import { LIVE_SESSIONS_FILE, parseLiveSessions, type LiveSession } from '../../shared/agent/live-sessions'
import { unknownSideEffects, type InterruptedSubagent, type UnknownSideEffects } from '../../shared/agent/unknown-side-effects'
import { resolveBinding } from '../../shared/binding/resolve'
import { emptySignalState, extendSignals } from '../../shared/binding/signals'
import { INTERRUPT_NOTICE, mainThreadEvents, type TranscriptEntry } from '../../shared/transcript/parse'
import { subagentFile } from '../../shared/transcript/subagents'
import { CONTINUED_WINDOW_MS } from './live-sessions'
import type { QueueEntry } from './queue'
import { EXIT_WAIT_MS, KILL_EXIT_MS } from './session/process'

/** A Session cut off longer ago than this before the start is not continued by itself (spec Q3 (a)). */
export const CONTINUE_WITHIN_MS = 60 * 60_000

/** How many times worfy continues one Session by itself within CONTINUED_WINDOW_MS (spec, risk 2). */
export const CONTINUE_CAP = 2

/** How long before the Session's last event an Update's restart record still counts as this restart's. */
export const UPDATE_SLACK_MS = 5 * 60_000

/** Whether a Session cut off by the restart is continued by itself: within the hour, and not a third time in it. */
export function continuityRule(record: Pick<LiveSession, 'lastEventAt' | 'continuedAt'>, startedAt: number): 'continue' | 'too-old' | 'cap' {
  if (startedAt - record.lastEventAt >= CONTINUE_WITHIN_MS) return 'too-old'
  const recent = record.continuedAt.filter((at) => at > startedAt - CONTINUED_WINDOW_MS)
  return recent.length >= CONTINUE_CAP ? 'cap' : 'continue'
}

/** Whether an event is a message a person gave the Session: a turn starts with it. */
const startsTurn = (event: AgentEvent): boolean =>
  (event.type === 'notice' && event.kind === 'user' && !INTERRUPT_NOTICE.test(event.text)) || event.type === 'prompt'

/**
 * The events of the turn the restart cut off: the Session's own thread from the last message a person gave it on,
 * and when that message was written (null without one: then the whole thread). An earlier turn, a person's
 * Interrupt included, is left out: its calls are not this restart's.
 */
export function cutOffTurn(entries: readonly TranscriptEntry[]): { events: AgentEvent[]; since: number | null } {
  const own = entries.filter((entry) => !entry.sidechain)
  let start = -1
  for (let index = own.length - 1; index >= 0; index--) {
    if (startsTurn((own[index] as TranscriptEntry).event)) {
      start = index
      break
    }
  }
  if (start < 0) return { events: mainThreadEvents(own), since: null }
  const stamp = own[start]?.timestamp
  const since = stamp === undefined ? Number.NaN : Date.parse(stamp)
  return { events: mainThreadEvents(own.slice(start)), since: Number.isFinite(since) ? since : null }
}

/** A Subagent of the Session: its id and the lines of its own transcript. */
export interface SubagentLines {
  agentId: string
  lines: readonly string[]
}

/**
 * The Subagents that became Interrupted with the restart: no end in their transcript, and a record at or after the
 * start of the cut-off turn (a background one started earlier and still working counts too). A Subagent that ended,
 * or whose last record lies before that turn, is left out. Without the turn's start every one without an end counts.
 */
export function interruptedSubagents(files: readonly SubagentLines[], since: number | null): InterruptedSubagent[] {
  return files
    .filter(({ agentId, lines }) => {
      const file = subagentFile(agentId, null, lines)
      if (file.ended) return false
      return since === null || file.lastAt === null || file.lastAt >= since
    })
    .map(({ agentId, lines }) => ({ agentId, lines }))
}

/** Each Subagent with the Ticket of its Binding, from its own transcript's signals (as unknown-side-effects.ts resolves it). */
export function restartSubagents(subagents: readonly InterruptedSubagent[]): RestartSubagent[] {
  return subagents.map((subagent) => {
    const signals = extendSignals(emptySignalState(), subagent.lines, { subagent: true }).signals
    const binding = resolveBinding({ manual: subagent.manual, launch: subagent.launch, signals, subagent: true }, undefined)
    return { agentId: subagent.agentId, ticket: binding?.target.kind === 'ticket' ? { epic: binding.target.epic, num: binding.target.num } : null }
  })
}

interface Listed {
  pid: number
  ppid: number | null
  /** When it started, in ms (Windows only): a parent started after its child holds a reused pid. */
  created: number | null
}

const pidOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : null

/** `/Date(1700000000000)/`, as Windows PowerShell's ConvertTo-Json writes a date; or an ISO date. */
function createdOf(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = /\/Date\((\d+)\)\//u.exec(value)
  if (ms !== null) return Number(ms[1])
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** The processes of a listing (processListing): `ps -axo pid=,ppid=` elsewhere, Win32_Process as JSON on Windows. */
function listed(platform: NodeJS.Platform, listing: string): Listed[] {
  if (platform !== 'win32') {
    return listing.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)/u.exec(line)
      return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), created: null }]
    })
  }
  const text = listing.trim()
  const parsed: unknown = text === '' ? [] : JSON.parse(text)
  const each = Array.isArray(parsed) ? parsed : [parsed]
  return each.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const fields = item as Record<string, unknown>
    const pid = pidOf(fields.ProcessId)
    return pid === null ? [] : [{ pid, ppid: pidOf(fields.ParentProcessId), created: createdOf(fields.CreationDate) }]
  })
}

/**
 * Whether process `pid` of a listing was left by a worfy that is gone (`orphan`), runs under a parent that is there
 * (`owned`: another program's, or this worfy's, `self`), or is not in the listing (`gone`). macOS and Linux give an
 * orphan to pid 1 (or a subreaper); Windows keeps the pid of the parent that is gone, so a parent that is not listed,
 * or that started after the child (its pid was given out again), makes an orphan too.
 */
export function parentState(platform: NodeJS.Platform, listing: string, pid: number, self: number): 'orphan' | 'owned' | 'gone' {
  const processes = listed(platform, listing)
  const child = processes.find((each) => each.pid === pid)
  if (child === undefined) return 'gone'
  if (child.ppid === null || child.ppid <= 1) return 'orphan'
  if (child.ppid === self) return 'owned'
  const parent = processes.find((each) => each.pid === child.ppid)
  if (parent === undefined) return 'orphan'
  if (platform === 'win32' && parent.created !== null && child.created !== null && parent.created > child.created) return 'orphan'
  return 'owned'
}

/**
 * `update` when an Update's restart record (`update/restart.json`, its `at`) was written before the start and not
 * long before the Session's last event: the quit's grace lets a turn run on after the press of Restart now. Null
 * otherwise: a quit, a crash and a shutdown are not told apart.
 */
export function restartCause(updateAt: number | null, lastEventAt: number, startedAt: number): RestartCause {
  if (updateAt === null || updateAt > startedAt) return null
  return updateAt >= lastEventAt - UPDATE_SLACK_MS ? 'update' : null
}

/** The queue of a record as the Session takes it back (Session.adoptQueue); the bytes of its images were not kept. */
export function queueEntries(queue: LiveSession['queue']): { items: QueueEntry[]; paused: boolean; lostImages: number } {
  return {
    items: queue.items.map((item) => ({
      id: randomUUID(),
      text: item.text,
      attachments: item.files.map((path) => ({ kind: 'file' as const, name: baseName(path), path, size: 0, copied: false })),
    })),
    paused: queue.held,
    lostImages: queue.items.reduce((count, item) => count + item.images.length, 0),
  }
}

/** What a Session is given when it goes on after the restart: by continuity itself, or by Continue on its Node. */
export interface RestartDelivery {
  /** restartText, for a Session that was in a turn; null for one that only had a queue. */
  text: string | null
  queue: { items: QueueEntry[]; paused: boolean; lostImages: number }
  /** The `notice` lines before the message (why it was not continued by itself), and after it. */
  before: string[]
  after: string[]
}

/** The live Session that goes on: the parts continuity uses. */
export interface ContinuedSession {
  send(text: string): unknown
  notice(text: string): void
  adoptQueue(taken: { items: readonly QueueEntry[]; paused: boolean }): void
}

/** Gives the Session its message, its queue and the notice lines; a failure of one notice does not stop the rest. */
export function deliverRestart(session: ContinuedSession, delivery: RestartDelivery): void {
  for (const line of delivery.before) session.notice(line)
  if (delivery.text !== null) session.send(delivery.text)
  if (delivery.queue.items.length > 0) session.adoptQueue({ items: delivery.queue.items, paused: delivery.queue.paused })
  for (const line of delivery.after) session.notice(line)
  if (delivery.queue.lostImages > 0) session.notice(`worfy: ${delivery.queue.lostImages} image${delivery.queue.lostImages === 1 ? '' : 's'} of the queue did not survive the restart`)
}

/** What a Session Node not continued by itself keeps until Continue: the chip's reason and the delivery. */
export interface RestartMark {
  /** When worfy started again. */
  at: number
  /** Why it was not continued, for the chip's tooltip. */
  reason: string
  delivery: RestartDelivery
}

export interface ContinuityProject {
  id: string
  root: string
  /** The Project's data folder, where `live-sessions.json` lies. */
  dataDir: string
}

/** The Session's transcript as it was before the continuation, and its Subagents' own transcripts. */
export interface SessionTranscript {
  entries: readonly TranscriptEntry[]
  subagents: readonly SubagentLines[]
}

/** The process of the Session's agent that still runs from before the restart. */
export interface PreviousProcess {
  pid: number
  /** The start time the Claude home recorded for it: a pid given out again is another process. */
  procStart?: string | undefined
  /** Its parent is gone: the worfy that started it died (parentState). */
  orphan: boolean
}

export interface ContinuityDeps {
  projects(): readonly ContinuityProject[]
  /** The text of a file; null when there is none. */
  readFile(path: string): Promise<string | null>
  /** The Session's transcript before the continuation; null when there is none. */
  transcript(project: ContinuityProject, record: LiveSession): Promise<SessionTranscript | null>
  /** The previous process of the Session that still runs; null when none does (or its Vendor keeps no record of it). */
  previous(project: ContinuityProject, record: LiveSession): Promise<PreviousProcess | null>
  /** Settles true once the process is gone, false when it still runs after `withinMs`. */
  exited(process: PreviousProcess, withinMs: number): Promise<boolean>
  kill(process: PreviousProcess): void
  /** Opens the Project's Orchestrator (Orchestrators.open: its saved session, resumed) and answers its live Session. */
  orchestrator(projectId: string): Promise<ContinuedSession>
  /** Starts the Node's Session (NodeSessions.start: its saved session, resumed) and answers it. */
  node(projectId: string, nodeId: string): Promise<ContinuedSession>
  /** The Session Node keeps the chip «Interrupted by restart» and Continue (NodeSessions.interrupted). */
  interrupted(projectId: string, nodeId: string, mark: RestartMark): void
  /** worfy continued the Session of Node `nodeId` by itself at `at` (LiveSessions.noteContinued). */
  noteContinued(nodeId: string, at: number): void
  /** When the last Update's restart record was written (`update/restart.json`); null without one. */
  updatedAt(): Promise<number | null>
  now(): number
  /** `at` as the person reads it (clockText of orchestrator-continue.ts). */
  clock(at: number, now: number): string
  /** Path of a Project's `live-sessions.json`. */
  liveFile(project: ContinuityProject): string
  log?(line: string): void
  exitWaitMs?: number
  killExitMs?: number
}

/** What became of one record. */
export interface ContinuityOutcome {
  projectId: string
  nodeId: string
  kind: LiveSession['kind']
  outcome: 'continued' | 'interrupted' | 'skipped'
  /** Why it was not continued, or skipped. */
  reason: string | null
}

const inTurn = (record: LiveSession): boolean => record.state === 'busy' || record.state === 'needs_permission'

/** The calls without a result, each in backticks, the Subagents' with their id: «`git push`, `gh pr merge 12` (Subagent a1)». */
function callsText(found: UnknownSideEffects): string {
  const own = found.session.map((call) => `\`${call.description}\``)
  const theirs = found.subagents.flatMap((subagent) => subagent.calls.map((call) => `\`${call.description}\` (Subagent ${subagent.agentId})`))
  return [...own, ...theirs].join(', ')
}

const hasCalls = (found: UnknownSideEffects): boolean => found.session.length > 0 || found.subagents.length > 0

/** The continuation of every Project's Sessions after a restart; run() once, at the start. */
export class Continuity {
  constructor(private readonly deps: ContinuityDeps) {}

  /** Reads every Project's record and continues, marks or skips each Session; one Session's failure does not stop the rest. */
  async run(): Promise<ContinuityOutcome[]> {
    const startedAt = this.deps.now()
    const updatedAt = await this.deps.updatedAt().catch(() => null)
    const outcomes: ContinuityOutcome[] = []
    for (const project of this.deps.projects()) {
      let records: LiveSession[]
      try {
        records = parseLiveSessions(await this.deps.readFile(this.deps.liveFile(project)), (line) => this.log(`${line} (${project.id})`))
      } catch (error) {
        this.log(`worfy: ${LIVE_SESSIONS_FILE} of ${project.id} could not be read (${messageOf(error)}); no Session of it is continued`)
        continue
      }
      for (const record of records) {
        try {
          outcomes.push(await this.one(project, record, startedAt, updatedAt))
        } catch (error) {
          this.log(`worfy: the Session of ${record.nodeId} (${project.id}) was not continued: ${messageOf(error)}`)
          outcomes.push({ projectId: project.id, nodeId: record.nodeId, kind: record.kind, outcome: 'skipped', reason: messageOf(error) })
        }
      }
    }
    return outcomes
  }

  private async one(project: ContinuityProject, record: LiveSession, startedAt: number, updatedAt: number | null): Promise<ContinuityOutcome> {
    const done = (outcome: ContinuityOutcome['outcome'], reason: string | null): ContinuityOutcome => ({ projectId: project.id, nodeId: record.nodeId, kind: record.kind, outcome, reason })
    // 1. A Run's Session: the Run continues it (ticket 06).
    if (record.runId !== null) return done('skipped', `the Run ${record.runId} owns it`)
    if (record.vendorSessionId === null) return done('skipped', 'its agent had not named its session yet')

    const turn = inTurn(record)
    const at = this.deps.clock(startedAt, startedAt)
    const cause = restartCause(updatedAt, record.lastEventAt, startedAt)
    let reason: string | null = null
    let text: string | null = null
    // 2. The unknown side effects, over the cut-off turn alone, read before the resume.
    if (turn) {
      const transcript = await this.deps.transcript(project, record)
      if (transcript === null) reason = 'its transcript could not be read, so its last commands are not known'
      else {
        const cut = cutOffTurn(transcript.entries)
        const subagents = interruptedSubagents(transcript.subagents, cut.since)
        const found = unknownSideEffects({ session: record, events: cut.events, subagents, workflow: undefined })
        if (hasCalls(found)) reason = `${callsText(found)} may or may not have run`
        text = restartText({ at, cause, subagents: restartSubagents(subagents) })
      }
      text ??= restartText({ at, cause, subagents: [] })
    }
    // 3. The hour and the cap.
    if (reason === null) {
      const rule = continuityRule(record, startedAt)
      if (rule === 'too-old') reason = 'it was cut off more than an hour before worfy started again'
      else if (rule === 'cap') reason = `worfy continued it ${CONTINUE_CAP} times within the hour already`
    }
    // 4. The previous process of the Session.
    if (reason === null) reason = await this.previousGone(project, record)

    const said = cause === 'update' ? `worfy: restarted at ${at} (update)` : `worfy: restarted at ${at}`
    const after = [text === null ? `${said}; the queue is back` : `${said}, sent "continue"`]
    const queue = queueEntries(record.queue)
    if (reason !== null) {
      this.log(`worfy: the Session of ${record.nodeId} (${project.id}) was not continued: ${reason}`)
      if (record.kind === 'session-node') {
        const delivery: RestartDelivery = { text, queue, before: [`worfy: not continued: ${reason}`], after }
        this.deps.interrupted(project.id, record.nodeId, { at: startedAt, reason, delivery })
      }
      return done('interrupted', reason)
    }

    // 5. The continuation, counted against the cap before it starts.
    for (const continued of record.continuedAt) this.deps.noteContinued(record.nodeId, continued)
    this.deps.noteContinued(record.nodeId, startedAt)
    const session = record.kind === 'orchestrator' ? await this.deps.orchestrator(project.id) : await this.deps.node(project.id, record.nodeId)
    deliverRestart(session, { text, queue, before: [], after })
    return done('continued', null)
  }

  /** Null once no previous process of the Session runs (an orphan waited for, then killed); else why it is not continued. */
  private async previousGone(project: ContinuityProject, record: LiveSession): Promise<string | null> {
    const previous = await this.deps.previous(project, record)
    if (previous === null) return null
    if (!previous.orphan) return `it runs in another program (pid ${previous.pid})`
    this.log(`worfy: waiting for the previous process of the Session of ${record.nodeId} (pid ${previous.pid}) to exit`)
    if (await this.deps.exited(previous, this.deps.exitWaitMs ?? EXIT_WAIT_MS)) return null
    try {
      this.deps.kill(previous)
    } catch (error) {
      this.log(`worfy: could not stop the previous process (pid ${previous.pid}): ${messageOf(error)}`)
    }
    if (await this.deps.exited(previous, this.deps.killExitMs ?? KILL_EXIT_MS)) return null
    return `its previous Claude Code process (pid ${previous.pid}) did not exit`
  }

  private log(line: string): void {
    ;(this.deps.log ?? ((text) => console.warn(`[continuity] ${text}`)))(line)
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The Windows PowerShell script of processListing: every process with its parent and its start, as JSON. */
export const PROCESS_PARENTS_SCRIPT =
  "Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, @{ Name = 'CreationDate'; Expression = { if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } } } | ConvertTo-Json -Compress"

/** Runs a program and answers its stdout; rejects when it fails. */
export type RunProgram = (file: string, args: readonly string[], options: { timeout: number; windowsHide: boolean }) => Promise<string>

/** The listing parentState reads: `ps -axo pid=,ppid=` on macOS and Linux, Win32_Process through Windows PowerShell on Windows. */
export async function processListing(platform: NodeJS.Platform, run: RunProgram, systemRoot: string | undefined = process.env.SystemRoot): Promise<string> {
  if (platform !== 'win32') return run('ps', ['-axo', 'pid=,ppid='], { timeout: 10_000, windowsHide: true })
  const root = systemRoot !== undefined && /^[A-Za-z]:[\\/]/u.test(systemRoot) ? systemRoot : 'C:\\Windows'
  return run(`${root.replace(/[\\/]$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, ['-NoProfile', '-NonInteractive', '-Command', PROCESS_PARENTS_SCRIPT], {
    timeout: 30_000,
    windowsHide: true,
  })
}

/** Lists a folder's names; none when it is not there. */
export type ListNames = (dir: string) => Promise<string[]>
/** The lines of a file, a torn last line left out. */
export type ReadLines = (file: string) => Promise<string[]>

const AGENT_FILE = /^agent-([A-Za-z0-9_-]{1,128})\.jsonl$/u

/**
 * A Claude Code Session's transcript and the transcripts of its Subagents, read only: `<session>.jsonl` (found by
 * `transcriptPath`, as Resume finds it) and `<session>/subagents/agent-<id>.jsonl` next to it.
 */
export async function claudeTranscript(
  transcriptPath: () => Promise<string | null>,
  read: { lines: ReadLines; names: ListNames; parse: (lines: readonly string[]) => TranscriptEntry[] },
): Promise<SessionTranscript | null> {
  const path = await transcriptPath()
  if (path === null) return null
  const entries = read.parse(await read.lines(path))
  const folder = join(dirname(path), basename(path, '.jsonl'), 'subagents')
  const subagents: SubagentLines[] = []
  for (const name of (await read.names(folder)).sort()) {
    const match = AGENT_FILE.exec(name)
    if (match !== null) subagents.push({ agentId: match[1] as string, lines: await read.lines(join(folder, name)) })
  }
  return { entries, subagents }
}
