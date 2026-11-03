// Sessions worfy runs on Session Nodes (ticket 18; contract in src/shared/ipc/sessions.ts).
//
// "New session" places a new live Node and starts a new Session in the Project's root. Resume
// continues a finished Session on the Session Node that names it — a read-only Node of ticket 14
// becomes live — or on a new Node, in the cwd the rule of Resume (resume.ts) gives. The Node's data
// keeps `origin: 'worfy'`, the Vendor and the Vendor's session id once its agent reports it
// (ADR-0010); the rest lives in memory as the Node's view and goes to the windows on `sessions.changed`.
//
// Each Session runs on its Vendor's driver (worfy-multi-vendor ticket 23): "New session" on the Vendor
// it names, else on the Project's `defaultVendor`, else on Claude Code; Start and Resume on the Vendor
// of the Node, and Claude Code for a Node saved without one. A Vendor this build does not run, or one
// nobody is signed in to, is refused with the reason before a Node is made.
//
// The model, effort and permission mode picked on a Node are kept like the Orchestrator's
// (session-settings.ts, worfy-daily ticket 23): each `settings` event of the Node's Session saves
// them under the Node id, and every start of the Node — New session, Start, Resume, after a restart
// of worfy — passes them to the registry.
//
// Like the Orchestrator, these Sessions belong to the app, not to a window: their events go to
// every window, and they stop when the app quits (app-registry.ts).
import type { AgentEvent } from '../../shared/agent/events'
import { DEFAULT_SETTINGS, sameSettings, type SessionSettings } from '../../shared/agent/settings'
import type { LiveSession } from '../../shared/ipc/claude-home'
import { VENDOR_LABELS, vendorIdSchema, type VendorId } from '../../shared/vendors/vendor'
import {
  LIVE_SESSION_HEIGHT,
  LIVE_SESSION_WIDTH,
  SESSION_NODE_KIND,
  type ResumeVerdict,
  type SessionNodeView,
  type WorfySessionNodeData,
} from '../../shared/ipc/sessions'
import { isArchived, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import type { RegistryRoot } from '../claude-home/registry'
import { placeDownFrom, placeNewNode } from '../layout/place'
import type { AccountPart } from '../vendors/account'
import { closeRefusal, resumeVerdict } from './resume'
import type { EventSink, Session, SessionRegistry } from './session'

export interface NodeSessionsDeps {
  layout: {
    get(projectId: string): LayoutState
    /** `options.sessionStays`: see LayoutStore.apply. */
    apply(projectId: string, op: LayoutOpInput, screen?: string | null, options?: { sessionStays?: boolean }): LayoutState
  }
  /** The Project's repository root; throws for a Project that is not in the list. */
  projectPath(projectId: string): string
  /** The Project's Vendor of a new Session (its settings' `defaultVendor`); Claude Code when absent or when it throws. */
  defaultVendor?(projectId: string): VendorId | undefined
  /**
   * Why a new Session of `vendor` cannot start now — nobody is signed in to it, it did not answer —
   * or null when it can. Absent: never refused.
   */
  vendorRefusal?(vendor: VendorId): Promise<string | null>
  /**
   * What the home of `vendor` knows of the Project's Sessions, for the rule of Resume of a Session of
   * that Vendor: its live processes and each Session's cwd. Absent: `claude` for every Vendor.
   */
  vendorSessions?(vendor: VendorId, projectRoot: RegistryRoot): Promise<KnownSessions>
  registry: Pick<SessionRegistry, 'start' | 'list'>
  /** Where the picked model, effort and permission mode of a Node are kept (session-settings.ts). */
  settings: {
    read(projectId: string, nodeId: string): SessionSettings | undefined
    write(projectId: string, nodeId: string, settings: SessionSettings): void
  }
  /**
   * What the Claude home knows of the Project's Sessions: live processes and each transcript's cwd.
   * The root is `local` for a call of this Machine's own; otherwise it is judged strictly (RegistryRoot).
   */
  claude(projectRoot: RegistryRoot): Promise<KnownSessions>
  isDirectory(path: string): Promise<boolean>
  /** Gets every event of every Session here, e.g. to send it to the windows. */
  broadcast: EventSink
  /** Gets every new view, e.g. to send it to the windows. */
  publish(view: SessionNodeView): void
}

/** What a Vendor's home knows of a Project's Sessions: live processes, and each one's cwd. */
export interface KnownSessions {
  live: readonly LiveSession[]
  history: readonly { sessionId: string; cwd?: string | undefined }[]
}

/** One Session started for a Node. */
interface Run {
  projectId: string
  nodeId: string
  session: Session | null
  /** The SDK session: resumed, or reported by Claude Code. */
  sdkSessionId: string | null
  /** The picks last saved for the Node, or read when it started. */
  settings: SessionSettings
}

/** Data of a Session Node that worfy runs. */
const isWorfyNode = (node: LayoutNode): boolean => node.kind === SESSION_NODE_KIND && node.data.origin === 'worfy'

/** The Vendor of a Session saved without one: every Session from before worfy-multi-vendor is Claude Code's. */
const UNNAMED_VENDOR: VendorId = 'claude'

/** `name` as a Vendor this build runs; throws with the reason for any other. */
function knownVendor(name: string): VendorId {
  const parsed = vendorIdSchema.safeParse(name)
  if (!parsed.success) throw new Error(`${name} is not a Vendor this build of worfy runs`)
  return parsed.data
}

/** The Vendor of the Session on `node`; throws for one this build does not run (a later worfy's). */
function vendorOf(node: LayoutNode): VendorId {
  const saved: unknown = node.data.vendor
  if (saved === undefined) return UNNAMED_VENDOR
  try {
    return knownVendor(String(saved))
  } catch (error) {
    throw new Error(`The Session of ${node.id} cannot start: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** How long the sign-in check of a Vendor may take before New session goes on without its answer. */
export const SIGN_IN_CHECK_MS = 15_000

/**
 * A vendorRefusal over the Vendors' account parts: a Vendor nobody is signed in to is refused. A check
 * that fails or does not answer in `timeoutMs` refuses nothing: the Session then reports the Vendor's
 * own error, as before the check. A Vendor once found signed in is not asked again in this run of the
 * app, and a Vendor of `trusted` is never asked.
 */
export function signInRefusal(
  account: (vendor: VendorId) => Pick<AccountPart, 'check'>,
  options: { trusted?: ReadonlySet<VendorId>; timeoutMs?: number; log?: (message: string, error: unknown) => void } = {},
): (vendor: VendorId) => Promise<string | null> {
  const signedIn = new Set<VendorId>(options.trusted)
  return async (vendor) => {
    if (signedIn.has(vendor)) return null
    let connections
    try {
      connections = await account(vendor).check(AbortSignal.timeout(options.timeoutMs ?? SIGN_IN_CHECK_MS))
    } catch (error) {
      ;(options.log ?? ((message, cause) => console.warn(message, cause)))(`[sessions] could not check the sign-in to ${vendor}; starting the Session anyway`, error)
      return null
    }
    if (!connections.some((connection) => connection.signedIn)) return `Nobody is signed in to ${VENDOR_LABELS[vendor]}: sign in to it first`
    signedIn.add(vendor)
    return null
  }
}

export class NodeSessions {
  /** The current run of each Node, while its Session is not closed. */
  private readonly runs = new Map<string, Run>()
  /** The last view of each Node that ran a Session in this run of the app. */
  private readonly views = new Map<string, SessionNodeView>()
  /**
   * Starts and Resumes still reading the Claude home, by `node:<id>` and `session:<SDK id>`. A second
   * one for the same Node or Session (a double click) gets the first one's answer instead of
   * starting a second Session that the registry would refuse.
   */
  private readonly inFlight = new Map<string, Promise<SessionNodeView>>()
  private version = 0

  constructor(private readonly deps: NodeSessionsDeps) {}

  /**
   * "New session": a new Node with a new Session of `vendor`, or of the Project's `defaultVendor`
   * without it. Refused with the reason, before any Node is made, for a Vendor this build does not
   * run and for one that cannot start a Session now (vendorRefusal).
   */
  async open(projectId: string, vendor?: string): Promise<SessionNodeView> {
    this.deps.projectPath(projectId)
    const id = vendor === undefined ? this.defaultVendor(projectId) : knownVendor(vendor)
    const refusal = (await this.deps.vendorRefusal?.(id)) ?? null
    if (refusal !== null) throw new Error(refusal)
    return this.create(projectId, undefined, id)
  }

  /**
   * A new Node, placed where it covers no other, with a new Session of `vendor` (the Project's
   * `defaultVendor` by default) in the Project's root. With `near` ("Ship ticket", worfy-daily ticket
   * 28) the Node goes on the first clear spot at `near.x`, from `near.y` down; without it, where every
   * Node main makes goes (`placeNewNode`).
   */
  create(projectId: string, near?: { x: number; y: number }, vendor: VendorId = this.defaultVendor(projectId)): SessionNodeView {
    const root = this.deps.projectPath(projectId)
    const { layout } = this.deps.layout.get(projectId)
    const size = { w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT }
    const { x, y } = near ? placeDownFrom(layout.nodes, size, near) : placeNewNode(layout.nodes, size)
    const before = new Set(layout.nodes.map((node) => node.id))
    const after = this.deps.layout.apply(projectId, {
      op: 'create',
      node: { kind: SESSION_NODE_KIND, x, y, w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT, data: { origin: 'worfy', vendor } satisfies WorfySessionNodeData },
    })
    const created = after.layout.nodes.find((node) => !before.has(node.id))
    if (!created) throw new Error(`the Session Node of ${projectId} was not created`)
    return this.launch(projectId, created.id, root, undefined, vendor)
  }

  /** Starts the Session behind a worfy Node that runs none: its saved session resumed, or a new one. */
  async start(projectId: string, nodeId: string): Promise<SessionNodeView> {
    const running = this.running(nodeId)
    if (running) return running
    const root = this.deps.projectPath(projectId)
    const node = this.deps.layout.get(projectId).layout.nodes.find((each) => each.id === nodeId)
    if (!node || !isWorfyNode(node)) throw new Error(`${nodeId} is not a Session Node of worfy`)
    const vendor = vendorOf(node)
    const saved = node.data.sessionId
    if (typeof saved !== 'string' || saved === '') return this.launch(projectId, nodeId, root, undefined, vendor)
    return this.once([`node:${nodeId}`, `session:${saved}`], () => this.resumeOn(projectId, root, node, saved, vendor))
  }

  /**
   * Continues a finished Session on the Session Node that names it, on that Node's Vendor, or on a new
   * Node: a Session no Node names is one of the Claude home's.
   */
  async resume(projectId: string, sessionId: string): Promise<SessionNodeView> {
    const root = this.deps.projectPath(projectId)
    const node = this.deps.layout.get(projectId).layout.nodes.find((each) => each.kind === SESSION_NODE_KIND && each.data.sessionId === sessionId)
    if (node) {
      const running = this.running(node.id)
      if (running) return running
    }
    const vendor = node ? vendorOf(node) : UNNAMED_VENDOR
    return this.once([`session:${sessionId}`, ...(node ? [`node:${node.id}`] : [])], () => this.resumeOn(projectId, root, node, sessionId, vendor))
  }

  /**
   * The verdict of Resume for each Session: one read of the Claude home for all of them. `local`
   * for a caller of this Machine; a Linked machine's call (the default) learns nothing of a Session
   * whose cwd is unknown (RegistryRoot).
   */
  async resumable(projectId: string, sessionIds: readonly string[], local = false): Promise<Record<string, ResumeVerdict>> {
    const root = this.deps.projectPath(projectId)
    const claude = await this.deps.claude(local ? { path: root, local: true } : root)
    const running = this.runningIds()
    const verdicts: Record<string, ResumeVerdict> = {}
    for (const sessionId of new Set(sessionIds)) {
      verdicts[sessionId] = await resumeVerdict({
        sessionId,
        projectRoot: root,
        live: claude.live,
        running,
        recorded: claude.history.find((each) => each.sessionId === sessionId),
        isDirectory: this.deps.isDirectory,
      })
    }
    return verdicts
  }

  /** The views of the Project's Nodes whose Session runs, or ran in this run of the app. */
  list(projectId: string): SessionNodeView[] {
    return [...this.views.values()].filter((view) => view.projectId === projectId)
  }

  /** Closes the Session behind a Node; refused during a turn. */
  close(nodeId: string): void {
    const run = this.runs.get(nodeId)
    const view = this.views.get(nodeId)
    if (!run || !view) throw new Error(`No live Session on ${nodeId}`)
    const refusal = closeRefusal(view.state)
    if (refusal !== null) throw new Error(refusal)
    run.session?.close()
  }

  private running(nodeId: string): SessionNodeView | null {
    const view = this.views.get(nodeId)
    return this.runs.has(nodeId) && view !== undefined ? view : null
  }

  /**
   * Every id of every Session worfy runs: the registry's, and the SDK session each one runs or
   * resumes — a resumed Session (the Orchestrator after a restart) is listed under a temporary id
   * until its first turn.
   */
  private runningIds(): Set<string> {
    const ids = new Set<string>()
    for (const info of this.deps.registry.list()) {
      ids.add(info.sessionId)
      if (info.sdkSessionId !== null) ids.add(info.sdkSessionId)
    }
    return ids
  }

  /** Runs `start` unless a start under one of `keys` is in flight; then answers that one. */
  private once(keys: readonly string[], start: () => Promise<SessionNodeView>): Promise<SessionNodeView> {
    for (const key of keys) {
      const current = this.inFlight.get(key)
      if (current) return current
    }
    const promise = start().finally(() => {
      for (const key of keys) if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
    })
    for (const key of keys) this.inFlight.set(key, promise)
    return promise
  }

  private async resumeOn(projectId: string, root: string, node: LayoutNode | undefined, sessionId: string, vendor: VendorId): Promise<SessionNodeView> {
    // `local` for any caller: a resume needs the access to write, which gives a Linked machine a
    // Terminal in the Project as well (ADR-0052), so a strict read would guard nothing.
    const projectRoot = { path: root, local: true }
    const known = await (this.deps.vendorSessions ? this.deps.vendorSessions(vendor, projectRoot) : this.deps.claude(projectRoot))
    const verdict = await resumeVerdict({
      sessionId,
      projectRoot: root,
      live: known.live,
      running: this.runningIds(),
      recorded: known.history.find((each) => each.sessionId === sessionId),
      isDirectory: this.deps.isDirectory,
    })
    if (!verdict.resumable) throw new Error(verdict.label)
    return this.launch(projectId, this.liveNode(projectId, node, sessionId, vendor), verdict.cwd, sessionId, vendor)
  }

  /**
   * The id of a worfy Node for the Session: the Node itself when worfy runs it already; a read-only
   * Node turns into one in place (same id, same place, live size, its flags kept; a locked one is
   * refused); else a new Node.
   * An archived Node comes back onto the Canvas first: Resume is the user's work with it, and the
   * `restore` sets its `touchedAt`, so the automatic archive does not take it again at once.
   */
  private liveNode(projectId: string, found: LayoutNode | undefined, sessionId: string, vendor: VendorId): string {
    const data: WorfySessionNodeData = { origin: 'worfy', vendor, sessionId }
    // A read-only Node turns live by `remove` and `create`, and `remove` is refused for a locked
    // Node: refused here, before anything changes (an archived one is not restored first).
    if (found && !isWorfyNode(found) && found.locked) throw new Error(`${found.id} is locked and cannot be turned into a live Session Node`)
    const node = found && isArchived(found) ? this.restored(projectId, found.id) : found
    if (node && isWorfyNode(node)) return node.id
    if (node) {
      // The Session stays on the Canvas through the swap: its Browsers stay too, in its Family
      // (they name the Session, not the Node), and its control of them goes on.
      this.deps.layout.apply(projectId, { op: 'remove', id: node.id }, null, { sessionStays: true })
      this.deps.layout.apply(projectId, {
        op: 'create',
        node: {
          id: node.id,
          kind: SESSION_NODE_KIND,
          x: node.x,
          y: node.y,
          w: Math.max(node.w, LIVE_SESSION_WIDTH),
          h: Math.max(node.h, LIVE_SESSION_HEIGHT),
          hidden: node.hidden,
          pinned: node.pinned,
          tags: node.tags,
          ...(node.keep === undefined ? {} : { keep: node.keep }),
          ...(node.touchedAt == null ? {} : { touchedAt: node.touchedAt }),
          data,
        },
      })
      return node.id
    }
    const { layout } = this.deps.layout.get(projectId)
    const { x, y } = placeNewNode(layout.nodes, { w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT })
    const before = new Set(layout.nodes.map((each) => each.id))
    const after = this.deps.layout.apply(projectId, { op: 'create', node: { kind: SESSION_NODE_KIND, x, y, w: LIVE_SESSION_WIDTH, h: LIVE_SESSION_HEIGHT, data } })
    const created = after.layout.nodes.find((each) => !before.has(each.id))
    if (!created) throw new Error(`the Session Node of ${sessionId} was not created`)
    return created.id
  }

  /** Brings an archived Node back onto the Canvas; the Node as main has it after the `restore`. */
  private restored(projectId: string, id: string): LayoutNode | undefined {
    const { layout } = this.deps.layout.apply(projectId, { op: 'restore', ids: [id] })
    return layout.nodes.find((each) => each.id === id)
  }

  private launch(projectId: string, nodeId: string, cwd: string, resume: string | undefined, vendor: VendorId): SessionNodeView {
    const run: Run = { projectId, nodeId, session: null, sdkSessionId: resume ?? null, settings: this.savedSettings(projectId, nodeId) }
    this.runs.set(nodeId, run)
    // The registry reports `starting` before start() returns: the view must exist by then.
    this.setView({ projectId, nodeId, vendor, sessionId: `starting-${nodeId}`, sdkSessionId: resume ?? null, state: 'starting', error: null, cwd, model: null })
    try {
      run.session = this.deps.registry.start(cwd, resume, (sessionId, event) => this.onEvent(run, sessionId, event), run.settings, undefined, undefined, vendor)
    } catch (error) {
      this.runs.delete(nodeId)
      // Closed, not `error`: no Session runs, so the Node can be removed or started again.
      this.setView({ ...this.view(nodeId), state: 'closed', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    this.setView({ ...this.view(nodeId), sessionId: run.session.id })
    return this.view(nodeId)
  }

  private onEvent(run: Run, sessionId: string, event: AgentEvent): void {
    if (this.runs.get(run.nodeId) === run) this.apply(run, sessionId, event)
    try {
      this.deps.broadcast(sessionId, event)
    } catch (error) {
      console.warn('[sessions] could not send an event to the windows', error)
    }
  }

  private apply(run: Run, sessionId: string, event: AgentEvent): void {
    const next = { ...this.view(run.nodeId), sessionId }
    if (event.type === 'init') {
      next.sdkSessionId = event.sdkSessionId
      next.cwd = event.cwd
      next.model = event.model
      if (run.sdkSessionId !== event.sdkSessionId) {
        run.sdkSessionId = event.sdkSessionId
        this.patch(run, { sessionId: event.sdkSessionId })
      }
    } else if (event.type === 'state') {
      next.state = event.state
      next.error = event.error
      if (event.state === 'closed') this.runs.delete(run.nodeId)
    } else if (event.type === 'settings') {
      // The start's own event saves only picks the Session corrected (a haiku saved before ticket 07).
      if (!sameSettings(run.settings, event.settings)) {
        run.settings = event.settings
        this.saveSettings(run, event.settings)
      }
    }
    this.setView(next)
  }

  /** The Project's Vendor of a new Session; Claude Code when it has none or it cannot be read, so New session goes on. */
  private defaultVendor(projectId: string): VendorId {
    try {
      return this.deps.defaultVendor?.(projectId) ?? UNNAMED_VENDOR
    } catch (error) {
      console.warn(`[sessions] could not read the Vendor of ${projectId}; starting Claude Code`, error)
      return UNNAMED_VENDOR
    }
  }

  /** The Node's saved picks; the defaults when there are none or they cannot be read, so the start goes on. */
  private savedSettings(projectId: string, nodeId: string): SessionSettings {
    try {
      return this.deps.settings.read(projectId, nodeId) ?? DEFAULT_SETTINGS
    } catch (error) {
      console.warn(`[sessions] could not read the saved settings of ${nodeId}; starting with the defaults`, error)
      return DEFAULT_SETTINGS
    }
  }

  private saveSettings(run: Run, settings: SessionSettings): void {
    try {
      this.deps.settings.write(run.projectId, run.nodeId, settings)
    } catch (error) {
      // The live Session keeps the picks; only its next start loses them.
      console.warn(`[sessions] could not save the settings of ${run.nodeId}`, error)
    }
  }

  private patch(run: Run, data: Partial<WorfySessionNodeData>): void {
    try {
      this.deps.layout.apply(run.projectId, { op: 'patchData', id: run.nodeId, data })
    } catch (error) {
      // The Node was removed, or its Project left the list, while the Session still reported.
      console.warn(`[sessions] could not update the Node ${run.nodeId}`, error)
    }
  }

  private view(nodeId: string): SessionNodeView {
    const view = this.views.get(nodeId)
    if (view === undefined) throw new Error(`${nodeId} has no view`)
    return view
  }

  private setView(view: Omit<SessionNodeView, 'version'>): void {
    this.version += 1
    const next: SessionNodeView = { ...view, version: this.version }
    this.views.set(view.nodeId, next)
    try {
      this.deps.publish(next)
    } catch (error) {
      console.warn('[sessions] could not send a view to the windows', error)
    }
  }
}
