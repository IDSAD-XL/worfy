// Writes `live-sessions.json` of each Project (worfy-continuity ticket 03; the format and its reader:
// src/shared/agent/live-sessions.ts): the Sessions that have a turn running or messages in their queue, so that a
// start after a quit, an Update or a crash knows what was cut off (ticket 05 reads it).
//
// The module follows the registry the way Auto-continue does (orchestrator-continue.ts): every event of every
// Session (SessionRegistry.observe) and every action of a person on one (observeInput). Which Session is whose
// comes from the views of the Orchestrators and of the Session Nodes (`orchestrator`, `node`); which Run owns a
// Project's Orchestrator, from Autopilot's state (`autopilot`): an unattended Orchestrator Session belongs to the
// Run of its Project. A Session is followed under its current id: on `renamed` (a resumed Session leaves its
// temporary `pending-…` id at its first init) its state and its owner move to the new id, and a view that comes
// late with the old id is read as the new one. The record is keyed by the Node, which the rename does not change.
//
// main is the only writer. Each change of a record is written at once, through a temporary file in the same folder
// renamed over the target, so a crash mid-write leaves the old file or the new one, never half of one. One write
// of a Project runs at a time: changes made meanwhile are written together after it, the latest state last. A
// record goes when its Session is idle with an empty queue, or closed. The time of the last event alone changes a
// record at most once in TOUCH_MS: a streaming turn does not write the file at every delta.
//
// Until a Session of this run of the app has a record in a Project, the file of that Project is not written: it
// keeps what the run before left there for the start to read. When the app quits, `stop` comes before the registry
// closes the Sessions, so the closing does not empty the file: it keeps the Sessions cut off by the quit.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { attachmentLines } from '../../shared/agent/attachments'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../shared/agent/events'
import { LIVE_SESSIONS_FILE, LIVE_SESSIONS_VERSION, liveSessionsFileSchema, type LiveSession, type LiveSessionsFile } from '../../shared/agent/live-sessions'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { SessionNodeView } from '../../shared/ipc/sessions'
import type { VendorId } from '../../shared/vendors/vendor'
import type { EventSink, InputListener, Session } from './session'

/** How often the time of the last event alone rewrites a record. */
export const TOUCH_MS = 30_000

/** How long an automatic continuation counts against the cap of ticket 05. */
export const CONTINUED_WINDOW_MS = 60 * 60_000

/** The file operations of a write; tests pass ones that fail or wait. */
export interface LiveSessionsFs {
  mkdir(dir: string): Promise<unknown>
  writeFile(file: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(file: string): Promise<void>
}

const NODE_FS: LiveSessionsFs = {
  mkdir: (dir) => mkdir(dir, { recursive: true }),
  writeFile: (file, text) => writeFile(file, text),
  rename: (from, to) => rename(from, to),
  rm: (file) => rm(file, { force: true }),
}

export interface LiveSessionsDeps {
  /** Gets every event of every Session (SessionRegistry.observe); answers the unsubscribe. */
  observe(sink: EventSink): () => void
  /** Gets every action of a person on a live Session (SessionRegistry.observeInput); answers the unsubscribe. */
  observeInput(listener: InputListener): () => void
  /** The live Session `sessionId` (SessionRegistry.get); null when it is gone. */
  session(sessionId: string): Pick<Session, 'sdkId' | 'unattended'> | null
  /** The Project's data folder; throws for a Project that is not in the list. */
  dirOf(projectId: string): string
  /** The clock, in milliseconds; tests pass a fixed one. */
  now?(): number
  fs?: LiveSessionsFs
}

/** What a view says of the Session behind a Node. */
interface Owner {
  projectId: string
  nodeId: string
  kind: LiveSession['kind']
  vendor: VendorId
}

/** What the events have told of a Session. */
interface Track {
  state: Exclude<SessionState, 'closed'>
  queue: QueueSnapshot
  lastEventAt: number
}

/** The file of one Project: what it should hold, what it holds, the write under way. */
interface Slot {
  wanted: string | null
  written: string | null
  writing: Promise<void> | null
}

const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

/** The events after which a record may be different, besides its time. */
const CHANGES = new Set<AgentEvent['type']>(['state', 'queue', 'init', 'renamed'])

let temporaryCounter = 0

/** Writes `text` to `file` through a temporary file in its folder renamed over it; the temporary file never stays. */
export async function writeAtomically(fs: LiveSessionsFs, file: string, text: string): Promise<void> {
  const dir = dirname(file)
  await fs.mkdir(dir)
  const temporary = join(dir, `.${LIVE_SESSIONS_FILE}.${process.pid}.${temporaryCounter++}.tmp`)
  try {
    await fs.writeFile(temporary, text)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary).catch(() => undefined)
    throw error
  }
}

/** The watcher that keeps `live-sessions.json` of every Project. */
export class LiveSessions {
  private readonly tracks = new Map<string, Track>()
  private readonly owners = new Map<string, Owner>()
  /** The Session id each Node's view named last, as followed through renames. */
  private readonly nodeSessions = new Map<string, string>()
  /** Each temporary id a Session left, with the id it took. */
  private readonly renamed = new Map<string, string>()
  /** The Run that owns each Project's Orchestrator, while one runs. */
  private readonly runs = new Map<string, string>()
  private readonly continued = new Map<string, number[]>()
  private readonly slots = new Map<string, Slot>()
  private readonly cleanups: (() => void)[] = []
  private readonly now: () => number
  private readonly fs: LiveSessionsFs
  private stopped = false

  constructor(private readonly deps: LiveSessionsDeps) {
    this.now = deps.now ?? Date.now
    this.fs = deps.fs ?? NODE_FS
    this.cleanups.push(
      deps.observe((sessionId, event) => this.onEvent(sessionId, event)),
      deps.observeInput((session) => this.onInput(session.id)),
    )
  }

  /** Takes a view of a Project's Orchestrator. */
  orchestrator(view: OrchestratorView): void {
    this.own(view.sessionId, { projectId: view.projectId, nodeId: view.nodeId, kind: 'orchestrator', vendor: view.vendor ?? 'claude' })
  }

  /** Takes a view of a Session Node. */
  node(view: SessionNodeView): void {
    this.own(view.sessionId, { projectId: view.projectId, nodeId: view.nodeId, kind: 'session-node', vendor: view.vendor })
  }

  /** Takes Autopilot's state of a Project: while a run goes on, its Journal's id owns the unattended Orchestrator. */
  autopilot(state: { projectId: string; status: 'running' | 'waiting' | 'stopped'; run?: string | undefined }): void {
    if (state.status !== 'stopped' && state.run !== undefined) this.runs.set(state.projectId, state.run)
    else this.runs.delete(state.projectId)
    this.schedule(state.projectId)
  }

  /** worfy continued the Session of Node `nodeId` by itself at `at` (ticket 05): counted for an hour. */
  noteContinued(nodeId: string, at: number = this.now()): void {
    this.continued.set(nodeId, [...this.continuedOf(nodeId), at])
    const owner = [...this.owners.values()].find((each) => each.nodeId === nodeId)
    if (owner !== undefined) this.schedule(owner.projectId)
  }

  /** Stops following the registry: nothing is written after it; a write under way still ends. */
  stop(): void {
    this.stopped = true
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }

  /** Settles once no write of any Project is under way. */
  async settled(): Promise<void> {
    for (;;) {
      const writing = [...this.slots.values()].flatMap((slot) => (slot.writing === null ? [] : [slot.writing]))
      if (writing.length === 0) return
      await Promise.all(writing)
    }
  }

  private own(given: string | null, owner: Owner): void {
    const sessionId = given === null ? null : this.current(given)
    const before = this.nodeSessions.get(owner.nodeId)
    if (before !== undefined && before !== sessionId) this.owners.delete(before)
    if (sessionId === null) this.nodeSessions.delete(owner.nodeId)
    else {
      this.nodeSessions.set(owner.nodeId, sessionId)
      this.owners.set(sessionId, owner)
    }
    this.schedule(owner.projectId)
  }

  /** The id the Session known as `sessionId` has now, after its renames. */
  private current(sessionId: string): string {
    let id = sessionId
    for (let next = this.renamed.get(id); next !== undefined; next = this.renamed.get(id)) id = next
    return id
  }

  private onEvent(sessionId: string, event: AgentEvent): void {
    if (this.stopped) return
    if (event.type === 'renamed') this.rename(event.from, sessionId)
    const now = this.now()
    if (event.type === 'state' && event.state === 'closed') {
      this.tracks.delete(sessionId)
      const owner = this.owners.get(sessionId)
      this.owners.delete(sessionId)
      if (owner !== undefined) this.schedule(owner.projectId)
      return
    }
    let track = this.tracks.get(sessionId)
    if (track === undefined) {
      track = { state: 'starting', queue: { items: [], paused: false }, lastEventAt: now }
      this.tracks.set(sessionId, track)
    }
    if (event.type === 'state' && event.state !== 'closed') track.state = event.state
    if (event.type === 'queue') track.queue = { items: event.items, paused: event.paused }
    if (!CHANGES.has(event.type) && now - track.lastEventAt < TOUCH_MS) return
    track.lastEventAt = now
    this.scheduleOf(sessionId)
  }

  private onInput(sessionId: string): void {
    if (this.stopped) return
    const track = this.tracks.get(sessionId)
    if (track === undefined) return
    track.lastEventAt = this.now()
    this.scheduleOf(sessionId)
  }

  private rename(from: string, to: string): void {
    this.renamed.set(from, to)
    const track = this.tracks.get(from)
    if (track !== undefined) {
      this.tracks.delete(from)
      this.tracks.set(to, track)
    }
    const owner = this.owners.get(from)
    if (owner !== undefined) {
      this.owners.delete(from)
      this.owners.set(to, owner)
      if (this.nodeSessions.get(owner.nodeId) === from) this.nodeSessions.set(owner.nodeId, to)
    }
  }

  private scheduleOf(sessionId: string): void {
    const owner = this.owners.get(sessionId)
    if (owner !== undefined) this.schedule(owner.projectId)
  }

  private continuedOf(nodeId: string): number[] {
    const since = this.now() - CONTINUED_WINDOW_MS
    return (this.continued.get(nodeId) ?? []).filter((at) => at > since)
  }

  /** The records of the Project's Sessions that have a turn or a queue, by Node. */
  private records(projectId: string): LiveSession[] {
    const records: LiveSession[] = []
    for (const [sessionId, owner] of this.owners) {
      if (owner.projectId !== projectId) continue
      const track = this.tracks.get(sessionId)
      if (track === undefined || (!inTurn(track.state) && track.queue.items.length === 0)) continue
      const session = this.deps.session(sessionId)
      const run = owner.kind === 'orchestrator' && session?.unattended === true ? (this.runs.get(projectId) ?? null) : null
      records.push({
        nodeId: owner.nodeId,
        kind: owner.kind,
        vendor: owner.vendor,
        vendorSessionId: session?.sdkId ?? null,
        state: track.state,
        queue: {
          items: track.queue.items.map((item) => {
            const lines = attachmentLines(item.text)
            return { text: lines.typed, files: lines.files, images: lines.images }
          }),
          held: track.queue.paused,
        },
        runId: run,
        lastEventAt: track.lastEventAt,
        continuedAt: this.continuedOf(owner.nodeId),
      })
    }
    return records.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
  }

  private schedule(projectId: string): void {
    if (this.stopped) return
    const slot = this.slots.get(projectId) ?? { wanted: null, written: null, writing: null }
    this.slots.set(projectId, slot)
    const sessions = this.records(projectId)
    // The file of the run before stays until this run has a record to write there.
    if (sessions.length === 0 && slot.wanted === null) return
    const file: LiveSessionsFile = { version: LIVE_SESSIONS_VERSION, sessions }
    const parsed = liveSessionsFileSchema.safeParse(file)
    if (!parsed.success) {
      console.warn(`[agent] ${LIVE_SESSIONS_FILE} of ${projectId} not written: the records do not match its format`, parsed.error)
      return
    }
    slot.wanted = `${JSON.stringify(parsed.data, null, 2)}\n`
    slot.writing ??= this.drain(projectId, slot)
  }

  /** Writes what the Project's file should hold until it holds it; one write at a time. */
  private async drain(projectId: string, slot: Slot): Promise<void> {
    // Never settles before `slot.writing` is set, even when the folder cannot be found.
    await Promise.resolve()
    try {
      while (slot.wanted !== null && slot.wanted !== slot.written) {
        const text = slot.wanted
        await writeAtomically(this.fs, join(this.deps.dirOf(projectId), LIVE_SESSIONS_FILE), text)
        slot.written = text
      }
    } catch (error) {
      // The next change tries again.
      console.warn(`[agent] ${LIVE_SESSIONS_FILE} of ${projectId} could not be written`, error)
    } finally {
      slot.writing = null
    }
  }
}
