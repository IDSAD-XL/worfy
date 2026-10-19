// Session Nodes for the live Sessions of a Project (ticket 14): what the Canvas must create or
// remove so that every live Session has one Node, wherever it was started (CONTEXT.md, «Сессия»:
// one Session — one Node). Pure: the overlay that sends the operations is
// src/renderer/canvas/overlays/SessionNodes.tsx.
//
// A Session Node is a Layout Node of kind `session` with id `session:<sessionId>`. Its `data`
// says which Session it shows and where that Session was started; its status is not saved, it
// comes from the registry of live Sessions while the Node is drawn. A Session worfy runs itself
// (the Orchestrator, later the Sessions of ticket 18) keeps its own Node: any Node of another
// kind that names a Session in `data.sessionId`, or a Session that `agent.list` reports, gets no
// external Node, and an external Node made before worfy named it is removed.
import { z } from 'zod'
import type { SessionState } from '../../shared/agent/events'
import type { LiveSession } from '../../shared/ipc/claude-home'
import { SESSION_NODE_KIND, worfySessionNodeDataSchema, type WorfySessionNodeData } from '../../shared/ipc/sessions'
import { isArchived, type LayoutNode, type LayoutOpInput } from '../../shared/layout/types'
import { STATE_CHIPS } from '../session/format'
import type { Status } from '../theme/primitives'

/** One kind for every Session Node: the live ones main makes and the read-only ones made here. */
export const SESSION_KIND = SESSION_NODE_KIND
export const SESSION_WIDTH = 300
export const SESSION_HEIGHT = 120

/** Room between a new Session Node and its neighbours. */
const GAP = 48
const STACK_GAP = 16

export const sessionNodeId = (sessionId: string): string => `session:${sessionId}`

/** What a read-only Session Node keeps in `data`. */
export const sessionNodeDataSchema = z.object({
  sessionId: z.string().min(1),
  /** `external`: started outside worfy and shown read-only. */
  origin: z.literal('external'),
  /** Where it was started: a terminal (`claude` in a shell) or the Claude desktop app. */
  source: z.enum(['terminal', 'desktop']),
  /** The cwd the Session runs in. */
  cwd: z.string(),
  /** The name Claude Code gave the Session when the Node was made. */
  name: z.string().optional(),
})
export type SessionNodeData = z.infer<typeof sessionNodeDataSchema>

/** A read-only Session Node's data, or null when the Node does not carry it (a damaged file, or a Node worfy runs). */
export function readSessionNodeData(data: Record<string, unknown>): SessionNodeData | null {
  const parsed = sessionNodeDataSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** The data of a Session Node worfy runs, or null for any other. */
export function readWorfySessionNodeData(data: Record<string, unknown>): WorfySessionNodeData | null {
  const parsed = worfySessionNodeDataSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** Where a Session worfy does not run was started, by the `entrypoint` Claude Code wrote for it. */
export function externalSource(entrypoint: string | undefined): SessionNodeData['source'] {
  return entrypoint === 'claude-desktop' ? 'desktop' : 'terminal'
}

/**
 * The name of a Session worfy runs on a Session Node, as its Node shows it: the title of its
 * transcript, else «New session» before Claude Code reported its id, else «Session <id>».
 */
export function worfySessionTitle(savedSessionId: string | undefined, history: readonly HistoryTitle[]): string {
  if (savedSessionId === undefined) return 'New session'
  return history.find((each) => each.sessionId === savedSessionId)?.title ?? `Session ${savedSessionId.slice(0, 8)}`
}

/** «terminal · <cwd>» or «Claude desktop». */
export function sessionSourceLabel(data: SessionNodeData): string {
  return data.source === 'desktop' ? 'Claude desktop' : `terminal · ${data.cwd}`
}

/** The chip of a Session Node: the live Session's status, or finished when its process is gone. */
export function sessionStatus(live: LiveSession | undefined): { status: Status; label: string } {
  if (live === undefined) return { status: 'done', label: 'finished' }
  if (live.status === 'busy') return { status: 'working', label: 'busy' }
  if (live.status === 'idle') return { status: 'ready', label: 'idle' }
  return { status: 'ready', label: 'live' }
}

const isExternal = (node: LayoutNode): boolean => node.kind === SESSION_KIND && node.data.origin !== 'worfy'

/** Session ids worfy runs itself: named by a Node that is not an external Session Node, or by `agent.list`. */
export function worfySessionIds(nodes: readonly LayoutNode[], running: readonly string[]): Set<string> {
  const ids = new Set(running)
  for (const node of nodes) {
    if (isExternal(node)) continue
    const id = node.data.sessionId
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  return ids
}

/** A Session of the history, as far as its name goes. */
export interface HistoryTitle {
  sessionId: string
  title?: string | undefined
}

/** A Session worfy runs, as its Node shows it: the Node's name and, while main reports one, its state. */
export interface WorfySession {
  /** null: the Node that names the Session is neither the Orchestrator nor a Session Node. */
  name: string | null
  /** null: main has no view of it in this window (yet). */
  state: SessionState | null
}

export interface WorfySessionsInput {
  nodes: readonly LayoutNode[]
  /** main's views of the Orchestrators (canvas/nodes/orchestrator-view.ts). */
  orchestrators: readonly { projectId: string; nodeId: string; sessionId: string | null; state: SessionState }[]
  /** main's views of the Sessions on Session Nodes (session/node-sessions.ts). */
  sessionNodes: readonly { projectId: string; nodeId: string; sessionId: string; sdkSessionId: string | null; state: SessionState }[]
  projectId: string
  history: readonly HistoryTitle[]
}

/**
 * The Sessions worfy runs in a Project, by every id they go by — the id the `agent.*` channels
 * take, the SDK session, the id their Node saved — with the name and state their Node shows
 * (worfy-daily ticket 24). Its keys are worfySessionIds() of the Nodes and of main's views.
 */
export function worfySessions({ nodes, orchestrators, sessionNodes, projectId, history }: WorfySessionsInput): Map<string, WorfySession> {
  const found = new Map<string, WorfySession>()
  const add = (id: unknown, session: WorfySession): void => {
    if (typeof id === 'string' && id !== '') found.set(id, session)
  }
  const nodeName = (node: LayoutNode | undefined): string | null => {
    if (node === undefined) return null
    if (node.kind === 'orchestrator') return 'Orchestrator'
    const own = node.kind === SESSION_KIND ? readWorfySessionNodeData(node.data) : null
    return own === null ? null : worfySessionTitle(own.sessionId, history)
  }
  for (const node of nodes) {
    if (isExternal(node)) continue
    const id = node.data.sessionId
    if (typeof id === 'string') add(id, { name: nodeName(node), state: null })
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const view of orchestrators) {
    if (view.projectId !== projectId || view.sessionId === null || view.state === 'closed') continue
    const node = byId.get(view.nodeId)
    const session = { name: 'Orchestrator', state: view.state }
    add(view.sessionId, session)
    add(node?.data.sessionId, session)
  }
  for (const view of sessionNodes) {
    if (view.projectId !== projectId || view.state === 'closed') continue
    const node = byId.get(view.nodeId)
    const session = { name: nodeName(node) ?? worfySessionTitle(undefined, history), state: view.state }
    add(view.sessionId, session)
    add(view.sdkSessionId, session)
    add(node?.data.sessionId, session)
  }
  return found
}

/** A row of the sidebar's «Sessions»: where the Session was started, its name and its chip. */
export interface SessionRow {
  source: 'worfy' | SessionNodeData['source']
  name: string
  chip: { status: Status; label: string }
}

/**
 * How the sidebar shows a live Session of the registry. A Session worfy runs — one whose id is in
 * worfySessionIds() — is «worfy», with its Node's name and state; any other is «desktop» or
 * «terminal» by its `entrypoint`, with `title` and the registry's status. `sdk-ts` alone does not
 * make a Session worfy's: every program on the Agent SDK writes it.
 */
export function sessionRow(session: LiveSession, worfyIds: ReadonlySet<string>, worfy: ReadonlyMap<string, WorfySession>, title: string): SessionRow {
  if (!worfyIds.has(session.sessionId)) return { source: externalSource(session.entrypoint), name: title, chip: sessionStatus(session) }
  const own = worfy.get(session.sessionId)
  return {
    source: 'worfy',
    name: own?.name ?? title,
    chip: own !== undefined && own.state !== null ? STATE_CHIPS[own.state] : sessionStatus(session),
  }
}

export interface SessionNodesInput {
  live: readonly LiveSession[]
  nodes: readonly LayoutNode[]
  /** worfySessionIds() */
  worfyIds: ReadonlySet<string>
  /** Session ids that had a Node in this run of the app: a Node the user removed is not brought back. */
  seen: ReadonlySet<string>
}

export interface SessionNodesPlan {
  create: Extract<LayoutOpInput, { op: 'create' }>[]
  /** Ids of external Session Nodes whose Session worfy runs itself. */
  remove: string[]
}

/** Where the next new Session Node goes: under the last Session Node, else right of every Node. An archived Node is not on the Canvas and counts for neither. */
function nextPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  const sessions = nodes.filter((node) => node.kind === SESSION_KIND && !node.pinned && !isArchived(node))
  if (sessions.length > 0) {
    const last = sessions.reduce((low, node) => (node.y + node.h > low.y + low.h ? node : low))
    return { x: last.x, y: last.y + last.h + STACK_GAP }
  }
  // Nodes of 1 × 1 are saved state of a node source (an Epic frame's offsets), not drawn.
  const placed = nodes.filter((node) => !node.pinned && !node.hidden && !isArchived(node) && node.w > 1 && node.h > 1)
  if (placed.length === 0) return { x: 0, y: 0 }
  return { x: Math.max(...placed.map((node) => node.x + node.w)) + GAP, y: Math.min(...placed.map((node) => node.y)) }
}

/** A read-only Node for a Session of the history ("Show" in the history, ticket 18), placed like a new live one. */
export function showSessionNodeOp(
  session: { sessionId: string; cwd?: string | undefined; title?: string | undefined; entrypoint?: string | undefined },
  nodes: readonly LayoutNode[],
  projectRoot: string,
): Extract<LayoutOpInput, { op: 'create' }> {
  const { x, y } = nextPlace(nodes)
  const data: SessionNodeData = {
    sessionId: session.sessionId,
    origin: 'external',
    source: externalSource(session.entrypoint),
    cwd: session.cwd ?? projectRoot,
    ...(session.title === undefined ? {} : { name: session.title }),
  }
  return { op: 'create', node: { id: sessionNodeId(session.sessionId), kind: SESSION_KIND, x, y, w: SESSION_WIDTH, h: SESSION_HEIGHT, data } }
}

export function planSessionNodes({ live, nodes, worfyIds, seen }: SessionNodesInput): SessionNodesPlan {
  const named = new Set<string>()
  for (const node of nodes) {
    const id = node.data.sessionId
    if (typeof id === 'string') named.add(id)
  }
  const remove = nodes.filter((node) => isExternal(node) && typeof node.data.sessionId === 'string' && worfyIds.has(node.data.sessionId)).map((node) => node.id)

  const create: SessionNodesPlan['create'] = []
  const placed: LayoutNode[] = [...nodes]
  for (const session of live) {
    const id = session.sessionId
    if (worfyIds.has(id) || named.has(id) || seen.has(id)) continue
    named.add(id)
    const { x, y } = nextPlace(placed)
    const data: SessionNodeData = {
      sessionId: id,
      origin: 'external',
      source: externalSource(session.entrypoint),
      cwd: session.cwd,
      ...(session.name === undefined ? {} : { name: session.name }),
    }
    const node = { id: sessionNodeId(id), kind: SESSION_KIND, x, y, w: SESSION_WIDTH, h: SESSION_HEIGHT, data }
    create.push({ op: 'create', node })
    placed.push({ ...node, hidden: false, locked: false, pinned: false, tags: [] })
  }
  return { create, remove }
}
