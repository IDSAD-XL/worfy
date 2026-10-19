// The automatic archive of finished Sessions (ADR-0076): main takes Session Nodes whose Session is
// over off the Canvas, into the `archived` field of their Layout Node (src/shared/layout/types.ts).
// Nothing is deleted: the Node stays in the Layout with its place, and its transcript is not touched.
//
// - The rule is archiveCandidates(), a pure function (ADR-0076, points 1–2).
// - AutoArchiver runs it for every Project of this Machine at start and every ARCHIVE_TICK_MS
//   (point 3). main does it, not a window: two screens of one Project archive once (ADR-0053), and
//   a Project watched only by a read-only Linked machine is archived too (ADR-0066). One run of a
//   Project is one `archive` operation with a new batch id, sent without a screen, so no screen's
//   undo history records it (ADR-0016).
// - A Session that came back to life (`claude --resume`) is restored by main, also without a
//   screen (point 6): whenever main sees the Project's live Sessions — on its own runs and on every
//   read of a registry watcher (src/main/ipc/claude-home.ts, liveSessionListeners).
// - The threshold comes from archiveSettings(). Until the Setting exists (worfy-canvas ticket 08)
//   it is «Never»: the timer runs and restores, but archives nothing (point 10).
import { resolve } from 'node:path'
import type { AgentSignals, BindingTarget, BindingWorkflow } from '../../shared/binding/resolve'
import { resolveBinding } from '../../shared/binding/resolve'
import type { ManualBinding } from '../../shared/ipc/bindings'
import { isLaunchBinding } from '../../shared/ipc/bindings'
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import { isArchived, type ArchiveRule, type LayoutNode } from '../../shared/layout/types'
import { ClaudeHomeRegistry, processState, type RegistryOptions } from '../claude-home/registry'
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

/**
 * The archive settings of this Machine; they apply to its Projects (ADR-0076, point 7).
 * shortcut: always «Never» (ADR-0076, point 10), until worfy-canvas ticket 08 adds the Setting and
 * ticket 10 makes 24 h the default.
 */
export function archiveSettings(): ArchiveSettings {
  return ARCHIVE_NEVER
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

/** A Node the archive takes, and the rule that takes it. */
export interface ArchiveCandidate {
  id: string
  sessionId: string
  rule: ArchiveRule
}

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

/**
 * The Session Nodes the rule may take, before any threshold: of kind `session`, not archived,
 * not pinned, without Keep, not touched less than `threshold` ago, naming a Session that is not
 * live and whose transcript tells the time of its last record. Every entry of `live` is live,
 * whatever its status — `unknown` too (not known — not closed, ADR-0031).
 */
function idleSessions(nodes: readonly LayoutNode[], live: readonly LiveSessionLike[], history: readonly HistoryLike[], now: number, threshold: number): IdleSession[] {
  const alive = new Set(live.map((session) => session.sessionId))
  const lastAt = new Map(history.map((session) => [session.sessionId, session.lastAt === undefined ? Number.NaN : Date.parse(session.lastAt)]))
  const found: IdleSession[] = []
  for (const node of nodes) {
    if (node.kind !== SESSION_NODE_KIND || isArchived(node) || node.pinned || node.keep === true) continue
    const sessionId = sessionOf(node)
    if (sessionId === null || alive.has(sessionId)) continue
    if (node.touchedAt != null && now - node.touchedAt < threshold) continue
    const last = lastAt.get(sessionId)
    if (last === undefined || Number.isNaN(last)) continue
    found.push({ node, sessionId, idle: now - last })
  }
  return found
}

/**
 * The Session Nodes to archive now, in the order of the Layout (ADR-0076, points 1–2).
 *
 * A candidate passes the cheap checks of idleSessions() and either idled past `settings.idleMs`
 * since the last record of its transcript (`idle`), or, when `settings.ticketDone`, is bound to a
 * Ticket the workflow model says is done and had its last record over TICKET_DONE_GRACE_MS ago
 * (`ticket-done`). The Orchestrator is another kind, so the rule does not see it. «Never»
 * (`idleMs` null) gives nothing.
 */
export function archiveCandidates(
  nodes: readonly LayoutNode[],
  live: readonly LiveSessionLike[],
  history: readonly HistoryLike[],
  workflow: BindingWorkflow | undefined,
  bindings: ReadonlyMap<string, BindingTarget | null>,
  now: number,
  settings: ArchiveSettings,
): ArchiveCandidate[] {
  const threshold = settings.idleMs
  if (threshold === null) return []
  const done = (target: BindingTarget | null | undefined): boolean =>
    target?.kind === 'ticket' && workflow !== undefined && workflow.tickets.some((ticket) => ticket.epic === target.epic && ticket.num === target.num && ticket.state === 'done')
  return idleSessions(nodes, live, history, now, threshold).flatMap(({ node, sessionId, idle }): ArchiveCandidate[] => {
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
  return idleSessions(nodes, live, history, now, threshold)
    .filter(({ idle }) => idle > TICKET_DONE_GRACE_MS && idle <= threshold)
    .map(({ sessionId }) => sessionId)
}

/**
 * The registry of live Sessions the archive reads: a process whose state cannot be told (`ps` or
 * PowerShell did not answer) counts as running, so its Session is never taken for finished
 * (ADR-0031), as for the Subagent tree (src/main/claude-home/subagents.ts).
 */
export function archiveRegistry(options: { home: string; processState?: typeof processState; listWorktrees?: RegistryOptions['listWorktrees'] }): ClaudeHomeRegistry {
  const state = options.processState ?? processState
  return new ClaudeHomeRegistry({
    home: options.home,
    ...(options.listWorktrees === undefined ? {} : { listWorktrees: options.listWorktrees }),
    isAlive: async (pid, procStart) => (await state(pid, procStart)) !== 'gone',
  })
}

/** A Project of this Machine as the archive needs it. */
export interface ArchiveProject {
  id: string
  path: string
}

/** What the archive reads and writes; the app passes the real ones (src/main/index.ts), tests their own. */
export interface AutoArchiveDeps {
  store: Pick<LayoutStore, 'get' | 'apply'>
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
}

/** The Project's archived Session Nodes. */
const archivedSessionNodes = (nodes: readonly LayoutNode[]): LayoutNode[] => nodes.filter((node) => node.kind === SESSION_NODE_KIND && isArchived(node))

const sameRoot = (a: string, b: string): boolean => samePath(process.platform, resolve(a), resolve(b))

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
   * archived already archived. Returns how many Nodes it archived.
   */
  async run(project: ArchiveProject): Promise<number> {
    const settings = this.deps.settings(project.id)
    if (settings.idleMs === null) {
      // «Never» turns the archive off (ADR-0076, point 7): no registry, git or ps. Only Nodes
      // archived before still come back when their Session is resumed.
      if (archivedSessionNodes(this.deps.store.get(project.id).layout.nodes).length > 0) await this.readLive(project)
      return 0
    }
    const history = await this.deps.history(project)
    let workflow: BindingWorkflow | undefined
    let bindings: ReadonlyMap<string, BindingTarget | null> = new Map()
    const needed = bindingsNeeded(this.deps.store.get(project.id).layout.nodes, this.liveOf(project.id), history, this.deps.now(), settings)
    if (needed.length > 0) {
      workflow = await this.deps.workflow(project)
      bindings = await this.deps.bindings(project, needed, workflow)
    }
    await this.readLive(project)
    // From here to the write nothing waits: the Layout and the live Sessions are the latest main knows.
    const found = archiveCandidates(this.deps.store.get(project.id).layout.nodes, this.liveOf(project.id), history, workflow, bindings, this.deps.now(), settings)
    if (found.length === 0) return 0
    this.deps.store.apply(project.id, { op: 'archive', batch: this.deps.batchId(), nodes: found.map(({ id, rule }) => ({ id, rule })) }, null)
    return found.length
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
    void this.runAll()
    const timer = setInterval(() => void this.runAll(), everyMs)
    return () => clearInterval(timer)
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
