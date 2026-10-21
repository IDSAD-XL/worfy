// The automatic archive of finished Sessions (ADR-0076): main takes Session Nodes whose Session is
// over off the Canvas, into the `archived` field of their Layout Node (src/shared/layout/types.ts).
// Nothing is deleted: the Node stays in the Layout with its place, and its transcript is not touched.
//
// - The rule is archiveCandidates(), a pure function (ADR-0076, points 1–2). A Session whose
//   transcript tells no time — Claude Code deletes transcripts past its cleanup period — is idle
//   since its Node's `touchedAt`; a run of the timer starts that clock with a `touch` without a
//   screen when the Node has none (sessionsWithoutClock; ADR-0076, Amendments). Neither happens in a
//   run during which `git worktree list` failed: a worktree outside the root then drops out of both
//   the live Sessions and the transcripts, and a Session running there would look finished.
// - AutoArchiver runs it for every Project of this Machine at start and every ARCHIVE_TICK_MS
//   (point 3). main does it, not a window: two screens of one Project archive once (ADR-0053), and
//   a Project watched only by a read-only Linked machine is archived too (ADR-0066). One run of a
//   Project is one `archive` operation with a new batch id, sent without a screen, so no screen's
//   undo history records it (ADR-0016).
// - A Session that came back to life (`claude --resume`) is restored by main, also without a
//   screen (point 6): whenever main sees the Project's live Sessions — on its own runs and on every
//   read of a registry watcher (src/main/ipc/claude-home.ts, liveSessionListeners).
// - The threshold comes from archiveSettings(), over the Setting of Settings → Canvas of this
//   Machine (`sessionArchive`, worfy-canvas ticket 08, point 7), read at every run. Its default is
//   «Never» until ticket 10: the timer runs and restores, but archives nothing (point 10).
// - «Archive finished sessions now» (point 9) asks main for the candidates of one Project
//   (AutoArchiver.candidatesNow, channel `layout.archiveCandidates`) by the same rule, with 24 h
//   under «Never»; the screen archives them itself, as one step of its undo history.
// - Every `archive` that comes over IPC — that command, its redo, the undo of a Restore — goes
//   through archiveFromScreen(): main drops the Nodes the rule never takes as they are at the write
//   (Keep, pinned, a live Session), so no screen archives a kept or running Session (points 2 and 6).
import { resolve } from 'node:path'
import type { AgentSignals, BindingTarget, BindingWorkflow } from '../../shared/binding/resolve'
import { resolveBinding } from '../../shared/binding/resolve'
import type { ManualBinding } from '../../shared/ipc/bindings'
import { isLaunchBinding } from '../../shared/ipc/bindings'
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import type { ArchiveCandidate } from '../../shared/ipc/layout'
import { isArchived, type LayoutNode, type LayoutOp, type LayoutState } from '../../shared/layout/types'
import type { SessionArchive, SessionArchiveAfter } from '../../shared/settings/app-settings'
import { ClaudeHomeRegistry, listGitWorktrees, processState, type RegistryOptions } from '../claude-home/registry'
import { samePath } from '../harness/status-line'
import type { LayoutStore } from './store'

/** How often the archive runs after the run at start (ADR-0076, point 3). */
export const ARCHIVE_TICK_MS = 10 * 60_000

/** How long after its last record a Session of a done Ticket stays (ADR-0076, point 1). */
export const TICKET_DONE_GRACE_MS = 60 * 60_000

/** The Machine's settings of the archive (ADR-0076, point 7). */
export interface ArchiveSettings {
  /** Idle time after which a finished Session is archived, in ms; null — «Never»: nothing is archived. */
  idleMs: number | null
  /** «…and when their Ticket is done»: also archive a finished Session of a done Ticket after TICKET_DONE_GRACE_MS. */
  ticketDone: boolean
}

/** «Never»: the archive is off. */
export const ARCHIVE_NEVER: ArchiveSettings = { idleMs: null, ticketDone: false }

const HOUR_MS = 60 * 60_000

/** The idle time of each threshold of Settings → Canvas; null — «Never». */
const IDLE_MS: Readonly<Record<SessionArchiveAfter, number | null>> = { never: null, '6h': 6 * HOUR_MS, '24h': 24 * HOUR_MS, '3d': 72 * HOUR_MS, '7d': 168 * HOUR_MS }

/** The archive settings of this Machine, from its Setting (sessionArchiveOf); they apply to its Projects (ADR-0076, point 7). */
export function archiveSettings(setting: SessionArchive): ArchiveSettings {
  return { idleMs: IDLE_MS[setting.after], ticketDone: setting.ticketDone }
}

/** The idle time «Archive finished sessions now» takes while the Setting is «Never» (worfy-canvas ticket 08). */
export const ARCHIVE_NOW_IDLE_MS = 24 * HOUR_MS

/** The settings of «Archive finished sessions now»: the Machine's, with ARCHIVE_NOW_IDLE_MS under «Never». */
export function archiveNowSettings(settings: ArchiveSettings): ArchiveSettings {
  return settings.idleMs === null ? { ...settings, idleMs: ARCHIVE_NOW_IDLE_MS } : settings
}

/**
 * How often the timer runs: ARCHIVE_TICK_MS, or WORFY_ARCHIVE_TICK_MS when it is a whole number of
 * ms above zero — the e2e tests speed the timer up with it.
 */
export function archiveTickMs(env: NodeJS.ProcessEnv): number {
  const given = env.WORFY_ARCHIVE_TICK_MS
  return given !== undefined && /^[1-9]\d*$/.test(given) ? Number(given) : ARCHIVE_TICK_MS
}

/** A Session in the registry of live Sessions; any status counts, `unknown` too. */
export interface LiveSessionLike {
  sessionId: string
  status: string
}

/** A transcript of the Project: its Session and the ISO time of its last record. */
export interface HistoryLike {
  sessionId: string
  lastAt?: string | undefined
}

export type { ArchiveCandidate }

/** The Session a Session Node shows, or null when it names none (a Session worfy starts, before Claude Code reported it). */
const sessionOf = (node: LayoutNode): string | null => {
  const id = node.data.sessionId
  return typeof id === 'string' && id !== '' ? id : null
}

/** A Session Node that passed the cheap checks of the rule, and how long its Session has been idle. */
interface IdleSession {
  node: LayoutNode
  sessionId: string
  idle: number
}

/** A Session Node the rule may take before any time is looked at, with the Session it names. */
interface FinishedSession {
  node: LayoutNode
  sessionId: string
  /** The time of the last record of its transcript in ms, or undefined when there is none or it tells none. */
  lastAt: number | undefined
}

/**
 * The Session Nodes of kind `session`, not archived, not pinned, without Keep, naming a Session
 * that is not live. Every entry of `live` is live, whatever its status — `unknown` too (not known
 * — not closed, ADR-0031).
 */
function finishedSessions(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[]): FinishedSession[] {
  const alive = new Set(live.map((session) => session.sessionId))
  const lastAt = new Map(history.map((session) => [session.sessionId, session.lastAt === undefined ? Number.NaN : Date.parse(session.lastAt)]))
  return nodes.flatMap((node): FinishedSession[] => {
    if (node.kind !== SESSION_NODE_KIND || isArchived(node) || node.pinned || node.keep === true) return []
    const sessionId = sessionOf(node)
    if (sessionId === null || alive.has(sessionId)) return []
    const last = lastAt.get(sessionId)
    return [{ node, sessionId, lastAt: last === undefined || Number.isNaN(last) ? undefined : last }]
  })
}

/**
 * The Session Nodes the rule may take, before any threshold: the finished ones not touched less
 * than `threshold` ago, with their idle time counted from the last record of their transcript or,
 * when the transcript tells no time (Claude Code deleted it past its cleanup period, or it has no
 * record yet) and `fromTouch` holds, from the Node's `touchedAt` (ADR-0076, Amendments). A Node with
 * neither is left.
 */
function idleSessions(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[], now: number, threshold: number, fromTouch: boolean): IdleSession[] {
  return finishedSessions(nodes, live, history).flatMap(({ node, sessionId, lastAt }): IdleSession[] => {
    if (node.touchedAt != null && now - node.touchedAt < threshold) return []
    const since = lastAt ?? (fromTouch ? (node.touchedAt ?? undefined) : undefined)
    return since === undefined ? [] : [{ node, sessionId, idle: now - since }]
  })
}

/**
 * The ids of the Session Nodes the rule could take but has no time for: their transcript tells
 * none and they have no `touchedAt`. A run of the timer starts their clock with a `touch` without a
 * screen (AutoArchiver.run), so such a Node is archived one threshold after the archive first saw
 * it, unless its Session comes back (ADR-0076, Amendments).
 */
export function sessionsWithoutClock(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[]): string[] {
  return finishedSessions(nodes, live, history)
    .filter(({ node, lastAt }) => lastAt === undefined && node.touchedAt == null)
    .map(({ node }) => node.id)
}

/**
 * The Session Nodes to archive now, in the order of the Layout (ADR-0076, points 1–2).
 *
 * A candidate passes the cheap checks of idleSessions() and either idled past `settings.idleMs`
 * since the last record of its transcript (`idle`), or, when `settings.ticketDone`, is bound to a
 * Ticket the workflow model says is done and had its last record over TICKET_DONE_GRACE_MS ago
 * (`ticket-done`). The Orchestrator is another kind, so the rule does not see it. «Never»
 * (`idleMs` null) gives nothing. `fromTouch` false — the reads may have missed a Session's
 * transcript and its being live (the worktree list failed): a Session whose transcript tells no
 * time is not counted from its touchedAt then.
 */
export function archiveCandidates(
  nodes: readonly LayoutNode[],
  live: readonly LiveSessionLike[],
  history: readonly HistoryLike[],
  workflow: BindingWorkflow | undefined,
  bindings: ReadonlyMap<string, BindingTarget | null>,
  now: number,
  settings: ArchiveSettings,
  fromTouch = true,
): ArchiveCandidate[] {
  const threshold = settings.idleMs
  if (threshold === null) return []
  const done = (target: BindingTarget | null | undefined): boolean =>
    target?.kind === 'ticket' && workflow !== undefined && workflow.tickets.some((ticket) => ticket.epic === target.epic && ticket.num === target.num && ticket.state === 'done')
  return idleSessions(nodes, live, history, now, threshold, fromTouch).flatMap(({ node, sessionId, idle }): ArchiveCandidate[] => {
    if (idle > threshold) return [{ id: node.id, sessionId, rule: 'idle' }]
    if (settings.ticketDone && idle > TICKET_DONE_GRACE_MS && done(bindings.get(sessionId))) return [{ id: node.id, sessionId, rule: 'ticket-done' }]
    return []
  })
}

/**
 * The Sessions whose Binding can decide whether they are archived now: those only the ticket-done
 * rule could take — past the grace but not past the idle threshold. Reading a Binding costs a
 * transcript lookup (git and a folder walk), so it is asked for these alone.
 */
export function bindingsNeeded(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[], now: number, settings: ArchiveSettings): string[] {
  const threshold = settings.idleMs
  if (threshold === null || !settings.ticketDone) return []
  // A Session counted from its touchedAt is touched at least `threshold` ago: never in the grace window.
  return idleSessions(nodes, live, history, now, threshold, false)
    .filter(({ idle }) => idle > TICKET_DONE_GRACE_MS && idle <= threshold)
    .map(({ sessionId }) => sessionId)
}

/** The archive's registry, with the count of failed worktree lists. */
export type ArchiveRegistry = ClaudeHomeRegistry & {
  /** How many times listing a Project's git worktrees failed (an error or git's timeout) so far. */
  worktreeFailures(): number
}

/**
 * The registry of live Sessions the archive reads: a process whose state cannot be told (`ps` or
 * PowerShell did not answer) counts as running, so its Session is never taken for finished
 * (ADR-0031), as for the Subagent tree (src/main/claude-home/subagents.ts). A worktree list that
 * fails (`listWorktrees` throws; `git worktree list` by default) reads as no worktrees, as in the
 * other registries, and is counted, so a run knows its reads may have missed a worktree.
 */
export function archiveRegistry(options: { home: string; processState?: typeof processState; listWorktrees?: RegistryOptions['listWorktrees'] }): ArchiveRegistry {
  const state = options.processState ?? processState
  const list = options.listWorktrees ?? listGitWorktrees
  let failures = 0
  const registry = new ClaudeHomeRegistry({
    home: options.home,
    listWorktrees: async (root) => {
      try {
        return await list(root)
      } catch {
        failures += 1
        return []
      }
    },
    isAlive: async (pid, procStart) => (await state(pid, procStart)) !== 'gone',
  })
  return Object.assign(registry, { worktreeFailures: () => failures })
}

/** A Project of this Machine as the archive needs it. */
export interface ArchiveProject {
  id: string
  path: string
}

/** What the archive reads and writes; the app passes the real ones (src/main/index.ts), tests their own. */
export interface AutoArchiveDeps {
  store: Pick<LayoutStore, 'get' | 'peek' | 'apply'>
  /** The Projects of this Machine. */
  projects(): readonly ArchiveProject[]
  /** The Project's live Sessions, from the registry under the Claude home. */
  live(project: ArchiveProject): Promise<readonly LiveSessionLike[]>
  /** The Project's transcripts, with the time of their last record. */
  history(project: ArchiveProject): Promise<readonly HistoryLike[]>
  /** Ids of the Sessions worfy itself runs now: live, whatever the registry says. */
  running(): ReadonlySet<string>
  /** The workflow model as a Binding needs it; asked only while the ticket-done rule is on. */
  workflow(project: ArchiveProject): Promise<BindingWorkflow | undefined>
  /** The Binding target of each of these Sessions; asked only while the ticket-done rule is on. */
  bindings(project: ArchiveProject, sessionIds: readonly string[], workflow: BindingWorkflow | undefined): Promise<ReadonlyMap<string, BindingTarget | null>>
  settings(projectId: string): ArchiveSettings
  now(): number
  /** A new batch id. */
  batchId(): string
  /**
   * How many times listing a Project's git worktrees failed so far (ArchiveRegistry). A run during
   * which it grows does not count a Session without a transcript time from its touchedAt.
   */
  worktreeFailures(): number
}

/** The Project's archived Session Nodes. */
const archivedSessionNodes = (nodes: readonly LayoutNode[]): LayoutNode[] => nodes.filter((node) => node.kind === SESSION_NODE_KIND && isArchived(node))

const sameRoot = (a: string, b: string): boolean => samePath(process.platform, resolve(a), resolve(b))

/** What a run reads before the rule: the transcripts, and the workflow model and Bindings when the ticket-done rule needs them. */
interface RuleReads {
  history: readonly HistoryLike[]
  workflow: BindingWorkflow | undefined
  bindings: ReadonlyMap<string, BindingTarget | null>
  /** The worktree list did not fail during the reads: a Session without a transcript time may count from its touchedAt. */
  fromTouch: boolean
}

/** Runs the archive of every Project of this Machine and brings resumed Sessions back. */
export class AutoArchiver {
  /** The latest live Sessions main saw, by Project id: its own reads and the registry watchers'. */
  private readonly latestLive = new Map<string, readonly LiveSessionLike[]>()
  /** How many times each Project's live Sessions were seen: tells a read that a watcher reported while it went on. */
  private readonly seen = new Map<string, number>()

  constructor(private readonly deps: AutoArchiveDeps) {}

  /** Runs every Project of this Machine, one after another; a Project that fails is logged and the rest go on. */
  async runAll(): Promise<void> {
    for (const project of this.deps.projects()) {
      try {
        await this.run(project)
      } catch (error) {
        console.error(`[archive] the archive of ${project.id} failed`, error)
      }
    }
  }

  /**
   * One run of one Project: reads what the rule needs, then, with no wait between the last read and
   * the write, applies one `archive` with a new batch. The live Sessions are read last and
   * joined with what the registry watchers reported meanwhile, and the rule runs again on the
   * Layout as it is at the write, so a Session that came back to life or a Node the user moved
   * while the reads went on is left — and a run that overlaps another finds the Nodes that one
   * archived already archived. Then it starts the clock of the Session Nodes without one
   * (sessionsWithoutClock), each with a `touch` without a screen. Returns how many Nodes it archived.
   */
  async run(project: ArchiveProject): Promise<number> {
    const settings = this.deps.settings(project.id)
    if (settings.idleMs === null) {
      // «Never» turns the archive off (ADR-0076, point 7): no registry, git or ps, and no
      // layout.json read — a Layout nobody opened stays unread, as before the archive. Only Nodes
      // archived before, in a Layout main holds, still come back when their Session is resumed.
      const held = this.deps.store.peek(project.id)
      if (held !== undefined && archivedSessionNodes(held.layout.nodes).length > 0) await this.readLive(project)
      return 0
    }
    const reads = await this.read(project, settings)
    // From here to the write nothing waits: the Layout and the live Sessions are the latest main knows.
    const found = this.candidatesOf(project.id, reads, settings)
    if (found.length > 0) this.deps.store.apply(project.id, { op: 'archive', batch: this.deps.batchId(), nodes: found.map(({ id, rule }) => ({ id, rule })) }, null)
    // shortcut: one `touch` (and one layout.changed) per Node, only on the first run after an old Layout
    // is read; redo as one operation if a Layout with hundreds of such Nodes makes that run slow.
    const clockless = reads.fromTouch ? sessionsWithoutClock(this.deps.store.get(project.id).layout.nodes, this.liveOf(project.id), reads.history) : []
    for (const id of clockless) this.deps.store.apply(project.id, { op: 'touch', id }, null)
    return found.length
  }

  /**
   * An `archive` a screen sent over IPC («Archive finished sessions now», its redo, the undo of a
   * Restore): the live Sessions are read again, then, with no wait before the write, the Nodes the
   * rule never takes are dropped — not a Session Node, already archived, pinned, with Keep, or
   * naming a Session that is live now (by the registry or run by worfy). The touch rule does not
   * apply: the user asks for these Nodes. Throws when none is left, and changes nothing then.
   */
  async archiveFromScreen(projectId: string, op: Extract<LayoutOp, { op: 'archive' }>, screen: string | null): Promise<LayoutState> {
    const project = this.deps.projects().find((each) => each.id === projectId)
    if (project === undefined) throw new Error(`${projectId} is not a Project of this Machine`)
    await this.readLive(project)
    // From here to the write nothing waits: Keep, pins and the live Sessions are the latest main knows.
    const alive = new Set(this.liveOf(projectId).map((session) => session.sessionId))
    const nodes = new Map(this.deps.store.get(projectId).layout.nodes.map((node) => [node.id, node]))
    const taken = op.nodes.filter(({ id }) => {
      const node = nodes.get(id)
      if (node === undefined || node.kind !== SESSION_NODE_KIND || isArchived(node) || node.pinned || node.keep === true) return false
      const sessionId = sessionOf(node)
      return sessionId !== null && !alive.has(sessionId)
    })
    if (taken.length === 0) throw new Error('nothing to archive: the Sessions are kept, pinned, archived already or running')
    return this.deps.store.apply(projectId, { ...op, nodes: taken }, screen)
  }

  /**
   * The candidates of «Archive finished sessions now» in one Project of this Machine (ADR-0076,
   * point 9): the same reads and rule as a run, with archiveNowSettings(); nothing is archived here
   * — the screen sends the `archive` itself, as a step of its undo history.
   */
  async candidatesNow(projectId: string): Promise<ArchiveCandidate[]> {
    const project = this.deps.projects().find((each) => each.id === projectId)
    if (project === undefined) throw new Error(`${projectId} is not a Project of this Machine`)
    const settings = archiveNowSettings(this.deps.settings(project.id))
    return this.candidatesOf(project.id, await this.read(project, settings), settings)
  }

  /**
   * Reads what the rule needs, the live Sessions last; the caller runs the rule (candidatesOf) with
   * no wait after it, on the Layout as it is then.
   */
  private async read(project: ArchiveProject, settings: ArchiveSettings): Promise<RuleReads> {
    const failures = this.deps.worktreeFailures()
    const history = await this.deps.history(project)
    let workflow: BindingWorkflow | undefined
    let bindings: ReadonlyMap<string, BindingTarget | null> = new Map()
    // Which Bindings to read is decided on the live Sessions main saw before this run, not on the
    // fresh read below, which has to stay last so nothing waits between it and the write. A Session
    // that died since was live then: its Binding is not read, and the ticket-done rule takes it on a
    // later run. A Session that came back to life is read for nothing: the rule leaves it anyway.
    const needed = bindingsNeeded(this.deps.store.get(project.id).layout.nodes, this.liveOf(project.id), history, this.deps.now(), settings)
    if (needed.length > 0) {
      workflow = await this.deps.workflow(project)
      bindings = await this.deps.bindings(project, needed, workflow)
    }
    await this.readLive(project)
    return { history, workflow, bindings, fromTouch: this.deps.worktreeFailures() === failures }
  }

  /** The rule on the Project's Layout and live Sessions as main knows them now. */
  private candidatesOf(projectId: string, { history, workflow, bindings, fromTouch }: RuleReads, settings: ArchiveSettings): ArchiveCandidate[] {
    return archiveCandidates(this.deps.store.get(projectId).layout.nodes, this.liveOf(projectId), history, workflow, bindings, this.deps.now(), settings, fromTouch)
  }

  /** What a registry watcher read (liveSessionListeners): the root names a Project of this Machine, or nothing happens. */
  noteLive(projectRoot: string, live: readonly LiveSessionLike[]): void {
    const project = this.deps.projects().find((each) => sameRoot(each.path, projectRoot))
    if (project !== undefined) this.seeLive(project, live)
  }

  /**
   * Reads the Project's live Sessions. A registry watcher that reported while the read went on may
   * know of a Session that came to life after the read looked: both are kept then, a Session live
   * by either counts as live (not known — not closed).
   */
  private async readLive(project: ArchiveProject): Promise<void> {
    const before = this.seen.get(project.id) ?? 0
    const live = await this.deps.live(project)
    const meanwhile = (this.seen.get(project.id) ?? 0) !== before
    this.seeLive(project, meanwhile ? [...(this.latestLive.get(project.id) ?? []), ...live] : live)
  }

  /** The live Sessions of a Project as main last saw them, with the Sessions worfy runs. */
  private liveOf(projectId: string): LiveSessionLike[] {
    const running = [...this.deps.running()].map((sessionId) => ({ sessionId, status: 'busy' }))
    return [...(this.latestLive.get(projectId) ?? []), ...running]
  }

  /** Keeps the Project's live Sessions and restores its archived Nodes whose Session is live again (ADR-0076, point 6). */
  private seeLive(project: ArchiveProject, live: readonly LiveSessionLike[]): void {
    this.latestLive.set(project.id, live)
    this.seen.set(project.id, (this.seen.get(project.id) ?? 0) + 1)
    const alive = new Set(this.liveOf(project.id).map((session) => session.sessionId))
    const back = archivedSessionNodes(this.deps.store.get(project.id).layout.nodes)
      .filter((node) => {
        const id = sessionOf(node)
        return id !== null && alive.has(id)
      })
      .map((node) => node.id)
    if (back.length > 0) this.deps.store.apply(project.id, { op: 'restore', ids: back }, null)
  }

  /** Runs now and then every `everyMs`, until the returned function is called. */
  start(everyMs: number = ARCHIVE_TICK_MS): () => void {
    // A tick while the previous runs still read (a slow registry, a short tick) is skipped.
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        await this.runAll()
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), everyMs)
    return () => clearInterval(timer)
  }
}

/** The archiver of the running app, set by its start (src/main/index.ts); null before it and after it stops. */
let appArchiver: AutoArchiver | null = null

/** The archiver «Archive finished sessions now» asks (src/main/ipc/layout.ts). */
export function runningArchiver(): AutoArchiver | null {
  return appArchiver
}

/** Starts `archiver` as the app's: it runs now and every `everyMs`. Returns the function that stops it. */
export function startAppArchiver(archiver: AutoArchiver, everyMs: number): () => void {
  appArchiver = archiver
  const stop = archiver.start(everyMs)
  return () => {
    stop()
    if (appArchiver === archiver) appArchiver = null
  }
}

/** What sessionBindings() reads: the stored Bindings and the signals of a Session's transcript. */
export interface SessionBindingSources {
  /** The Project's stored Bindings (src/main/layout/bindings.ts): manual and launch. */
  stored(projectId: string): readonly ManualBinding[]
  /** The path of a Session's transcript among the Project's folders, or null. */
  transcriptPath(projectRoot: string, sessionId: string): Promise<string | null>
  /** The Binding signals of the transcript at `path` (src/main/claude-home/binding-signals.ts). */
  signals(path: string): Promise<AgentSignals>
}

/**
 * The Binding target of each Session, resolved as the renderer resolves it
 * (src/renderer/binding/store.ts): the manual Binding, else the launch one, else the signals of
 * its transcript. A Session that is not bound maps to null.
 */
export async function sessionBindings(
  project: ArchiveProject,
  sessionIds: readonly string[],
  workflow: BindingWorkflow | undefined,
  sources: SessionBindingSources,
): Promise<Map<string, BindingTarget | null>> {
  const stored = sources.stored(project.id).filter((binding) => (binding.agentId ?? null) === null)
  const of = (launch: boolean) => new Map(stored.filter((binding) => isLaunchBinding(binding) === launch).map((binding) => [binding.sessionId, binding.target]))
  const manual = of(false)
  const launch = of(true)
  const found = new Map<string, BindingTarget | null>()
  for (const sessionId of sessionIds) {
    let signals: AgentSignals | null = null
    if (!manual.has(sessionId) && !launch.has(sessionId)) {
      const path = await sources.transcriptPath(project.path, sessionId)
      signals = path === null ? null : await sources.signals(path)
    }
    found.set(sessionId, resolveBinding({ manual: manual.get(sessionId), launch: launch.get(sessionId), signals }, workflow)?.target ?? null)
  }
  return found
}
