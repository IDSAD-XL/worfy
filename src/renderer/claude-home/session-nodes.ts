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
import type { LiveSession } from '../../shared/ipc/claude-home'
import type { LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import type { Status } from '../theme/primitives'

export const SESSION_KIND = 'session'
export const SESSION_WIDTH = 300
export const SESSION_HEIGHT = 120

/** Room between a new Session Node and its neighbours. */
const GAP = 48
const STACK_GAP = 16

export const sessionNodeId = (sessionId: string): string => `session:${sessionId}`

/** What a Session Node keeps in `data`. */
export const sessionNodeDataSchema = z.object({
  sessionId: z.string().min(1),
  /** `external`: started outside worfy and shown read-only. */
  origin: z.enum(['external', 'worfy']),
  /** Where it was started: a terminal (`claude` in a shell) or the Claude desktop app. */
  source: z.enum(['terminal', 'desktop']),
  /** The cwd the Session runs in. */
  cwd: z.string(),
  /** The name Claude Code gave the Session when the Node was made. */
  name: z.string().optional(),
})
export type SessionNodeData = z.infer<typeof sessionNodeDataSchema>

/** The Session Node's data, or null when the Node does not carry it (a damaged file). */
export function readSessionNodeData(data: Record<string, unknown>): SessionNodeData | null {
  const parsed = sessionNodeDataSchema.safeParse(data)
  return parsed.success ? parsed.data : null
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

/** Where the next new Session Node goes: under the last Session Node, else right of every Node. */
function nextPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  const sessions = nodes.filter((node) => node.kind === SESSION_KIND && !node.pinned)
  if (sessions.length > 0) {
    const last = sessions.reduce((low, node) => (node.y + node.h > low.y + low.h ? node : low))
    return { x: last.x, y: last.y + last.h + STACK_GAP }
  }
  // Nodes of 1 × 1 are saved state of a node source (an Epic frame's offsets), not drawn.
  const placed = nodes.filter((node) => !node.pinned && !node.hidden && node.w > 1 && node.h > 1)
  if (placed.length === 0) return { x: 0, y: 0 }
  return { x: Math.max(...placed.map((node) => node.x + node.w)) + GAP, y: Math.min(...placed.map((node) => node.y)) }
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
      source: session.entrypoint === 'claude-desktop' ? 'desktop' : 'terminal',
      cwd: session.cwd,
      ...(session.name === undefined ? {} : { name: session.name }),
    }
    const node = { id: sessionNodeId(id), kind: SESSION_KIND, x, y, w: SESSION_WIDTH, h: SESSION_HEIGHT, data }
    create.push({ op: 'create', node })
    placed.push({ ...node, hidden: false, locked: false, pinned: false, tags: [] })
  }
  return { create, remove }
}
