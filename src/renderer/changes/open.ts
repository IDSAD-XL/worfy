// Opening the Changes Node of a Ticket (worfy-changes-view ticket 03): from the button Changes on the Ticket card
// (canvas/actions/Changes.tsx) and from Open changes in the Command palette (palette/commands.ts). One Node per
// Ticket: a second click goes to the Node already there, shown again first when it is hidden or archived. A new Node
// stands right of the strip of Epic frames at the Ticket's height, as a Session started from the card does
// (canvas/session-spot.ts), on the nearest place there that covers nothing (changesPlace).
//
// The palette is drawn outside React Flow and cannot see where the card is, so it centers the Canvas on the card and
// leaves a request here; the card's button, drawn once the card is in sight, takes it and opens the Node as a click
// does. When no card takes it in time (the Ticket is in a collapsed frame), the palette puts the Node right of
// everything on the Canvas itself.
//
// Kept free of React and of the Node registry: the palette lives in the toolbar, which does not load the Canvas's
// modules (find/canvas-requests.ts).
import { create } from 'zustand'
import { placeNear } from '../../shared/canvas/tools'
import type { ChangesScope } from '../../shared/changes/types'
import { epicNodeId, onThePlane, shownOnCanvas, ticketNodeId } from '../../shared/layout/derived'
import { freePlace } from '../../shared/layout/free-place'
import type { LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import type { Ticket } from '../../shared/workflow/types'
import { focusCanvasNode } from '../find/canvas-requests'
import { setView } from '../session/navigation'
import { applyRecorded } from '../canvas/history'
import { showNode } from '../canvas/show-node'
import { showsChanges } from '../canvas/ticket-card'
import { currentLayout, screenChannel } from '../canvas/useLayout'

export const CHANGES_KIND = 'changes'
/** The size of a new Changes Node: the tree and two columns of Side by side fit at zoom 1. */
export const CHANGES_SIZE = { w: 960, h: 640 } as const

/** What a Changes Node shows: the Ticket. Part 2 adds a Session and a PR. */
export interface ChangesSubject {
  epic: string
  num: number
}

/** The data of a Changes Node in the Layout (a free JSON object, nodeDataSchema): its subject and its scope. */
export interface ChangesNodeData {
  ticket: ChangesSubject
  /** The scope last picked; absent — All changes. */
  scope?: ChangesScope
}

export const changesNodeId = ({ epic, num }: ChangesSubject): string => `changes:${epic}/${num}`

const ref = ({ epic, num }: ChangesSubject): string => `${epic}/${String(num).padStart(2, '0')}`

/** The subject of a Changes Node's data; null when the data names none. */
export function changesSubjectOf(data: Record<string, unknown>): ChangesSubject | null {
  const ticket = data.ticket
  if (typeof ticket !== 'object' || ticket === null) return null
  const { epic, num } = ticket as Record<string, unknown>
  return typeof epic === 'string' && epic !== '' && typeof num === 'number' && Number.isInteger(num) && num >= 0 ? { epic, num } : null
}

/** The scope a Changes Node's data keeps; All changes when it keeps none or one that does not read. */
export function changesScopeOf(data: Record<string, unknown>): ChangesScope {
  const scope = data.scope as Record<string, unknown> | undefined
  if (typeof scope !== 'object' || scope === null) return { kind: 'all' }
  if (scope.kind === 'uncommitted') return { kind: 'uncommitted' }
  if (scope.kind === 'commit' && typeof scope.repo === 'string' && typeof scope.sha === 'string') return { kind: 'commit', repo: scope.repo, sha: scope.sha }
  if (scope.kind === 'compare' && typeof scope.repo === 'string' && typeof scope.ref === 'string') return { kind: 'compare', repo: scope.repo, ref: scope.ref }
  return { kind: 'all' }
}

/** The Changes Node of the Ticket in the Layout, archived and hidden ones too. */
export function changesNodeOf(nodes: readonly LayoutNode[], subject: ChangesSubject): LayoutNode | undefined {
  return nodes.find((node) => {
    if (node.kind !== CHANGES_KIND) return false
    const of = changesSubjectOf(node.data)
    return of !== null && of.epic === subject.epic && of.num === subject.num
  })
}

/**
 * Whether the Ticket has something for Changes to read, from the Ticket alone: the worktree branch its status came
 * from, its `Branch:` line, or work on it (a claimed Ticket has its branch) — the cards the layout gives the room of
 * the button (showsChanges of canvas/ticket-card.ts). main gives the final answer (`changes.scopes`): a Ticket whose
 * branch is gone shows that in the Node.
 */
export const hasChangesSubject = (ticket: Pick<Ticket, 'state' | 'fromBranch' | 'branch'>): boolean => showsChanges(ticket)

/** The tooltip of the button and the detail of the palette row. */
export const changesTitle = (subject: ChangesSubject): string => `Open the changes of ${ref(subject)}: its diff against the base`

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where a new Changes Node goes. With `spot` (right of the strip of frames at the Ticket's height, sessionSpot): the
 * nearest place to it that keeps clear of the Nodes on the plane and of `keepOut` (the strip, the frames moved off their
 * places), as a Session shown from a Ticket's history goes (archive-list.ts, showPlace) and as main would correct it
 * anyway (ADR-0038). Without one (no frames drawn, the palette with no card in sight): right of the card (`anchor`), or
 * right of everything on the Canvas, going down to the first place that covers nothing (placeNear).
 */
export function changesPlace(nodes: readonly LayoutNode[], spot: { x: number; y: number } | undefined, anchor: Rect | null, keepOut: readonly Rect[]): { x: number; y: number } {
  const others = [...nodes.filter(onThePlane).map(({ x, y, w, h }) => ({ x, y, w, h })), ...keepOut]
  if (spot !== undefined) return freePlace({ x: spot.x, y: spot.y, ...CHANGES_SIZE }, others)
  return placeNear(others, anchor, CHANGES_SIZE.w, CHANGES_SIZE.h)
}

/** What opening needs: the Layout as it is now, and where its operations go (the Canvas's LayoutOps, or main directly). */
export interface OpenDeps {
  projectId: string
  /** The Layout's Nodes as they are now. */
  nodes: readonly LayoutNode[]
  apply: (op: LayoutOpInput) => Promise<string | undefined>
  /** The place of a new Node, asked only when there is none yet. */
  place: () => { x: number; y: number }
}

/**
 * Goes to the Ticket's Changes Node, or puts a new one at `place()` and goes to it. Resolves to the reason when the
 * Layout refused the Node, undefined otherwise.
 */
export async function openChanges(deps: OpenDeps, subject: ChangesSubject): Promise<string | undefined> {
  const existing = changesNodeOf(deps.nodes, subject)
  setView('canvas')
  if (existing !== undefined) {
    if (!shownOnCanvas(existing)) {
      const refusal = await showNode(deps.projectId, existing)
      if (refusal !== undefined) return refusal
    }
    focusCanvasNode(deps.projectId, existing.id)
    return undefined
  }
  const { x, y } = deps.place()
  const data: ChangesNodeData = { ticket: { epic: subject.epic, num: subject.num } }
  const refusal = await deps.apply({ op: 'create', node: { id: changesNodeId(subject), kind: CHANGES_KIND, x: Math.round(x), y: Math.round(y), ...CHANGES_SIZE, data: { ...data } } })
  if (refusal !== undefined) return refusal
  focusCanvasNode(deps.projectId, changesNodeId(subject))
  return undefined
}

// ── the palette's request to the card ──────────────────────────────────────

interface OpenRequest extends ChangesSubject {
  projectId: string
  seq: number
}

/** How long the palette waits for the card to take its request before it places the Node itself. */
export const REQUEST_WAIT_MS = 2_000

export const useOpenRequests = create<{ request: OpenRequest | null }>(() => ({ request: null }))
const settle = new Map<number, (taken: boolean) => void>()
/** The number of the last request: it only grows, so a request's timer never meets a later request of the same number. */
let lastSeq = 0

/**
 * Leaves a request for the card of the Ticket; resolves to true once its button took it, to false when none did in
 * REQUEST_WAIT_MS (the request is then dropped, so a card drawn later does not open the Node unasked).
 */
export function requestOpenChanges(projectId: string, subject: ChangesSubject): Promise<boolean> {
  lastSeq += 1
  const seq = lastSeq
  for (const [, done] of settle) done(false)
  settle.clear()
  useOpenRequests.setState({ request: { projectId, epic: subject.epic, num: subject.num, seq } })
  return new Promise((resolve) => {
    settle.set(seq, resolve)
    setTimeout(() => {
      if (!settle.has(seq)) return
      settle.delete(seq)
      if (useOpenRequests.getState().request?.seq === seq) useOpenRequests.setState({ request: null })
      resolve(false)
    }, REQUEST_WAIT_MS)
  })
}

/** The card's button takes the request for its Ticket: true when there was one, which is then gone. */
export function takeOpenRequest(projectId: string, subject: ChangesSubject): boolean {
  const request = useOpenRequests.getState().request
  if (request === null || request.projectId !== projectId || request.epic !== subject.epic || request.num !== subject.num) return false
  useOpenRequests.setState({ request: null })
  settle.get(request.seq)?.(true)
  settle.delete(request.seq)
  return true
}

/**
 * Open changes of the Command palette: goes to the Ticket's Changes Node when it is there; else centers the Canvas on
 * the card and lets its button open the Node (takeOpenRequest); when no card takes it in time, puts the Node right of
 * everything on the Canvas, as one step of ⌘Z.
 */
export async function openChangesFromPalette(projectId: string, subject: ChangesSubject, nodes: readonly LayoutNode[]): Promise<string | undefined> {
  const direct = (now: readonly LayoutNode[], place: OpenDeps['place']): Promise<string | undefined> =>
    openChanges({ projectId, nodes: now, apply: (op) => applyRecorded(projectId, op, screenChannel(projectId)), place }, subject)
  if (changesNodeOf(nodes, subject) !== undefined) return direct(nodes, () => ({ x: 0, y: 0 }))
  setView('canvas')
  focusCanvasNode(projectId, ticketNodeId(subject.epic, subject.num), epicNodeId(subject.epic))
  if (await requestOpenChanges(projectId, subject)) return undefined
  const now = currentLayout(projectId)?.nodes ?? nodes
  return direct(now, () => changesPlace(now, undefined, null, []))
}

// ── a line asked for from a sent message ────────────────────────────────────

/** A line of a Ticket's diff that a block of a sent message asks Changes to show (ticket 05). */
export interface LineRequest extends ChangesSubject {
  projectId: string
  path: string
  side: 'old' | 'new'
  line: number
  seq: number
  /** When it was asked for, ms (Date.now). */
  at: number
}

/**
 * How long a line asked for stays asked for, in ms. Going to the Canvas may draw the Node anew (React Flow draws the
 * Nodes in sight): a Node drawn anew within this time brings the line into view again.
 */
export const LINE_REQUEST_MS = 5_000

export const useLineRequests = create<{ request: LineRequest | null }>(() => ({ request: null }))

/**
 * The block of a comment on code in a sent message (session/QuotedPrompt.tsx): opens the Ticket's Changes Node as Open
 * changes of the Command palette does, and leaves the line for the Node to bring into view (lineRequestFor).
 */
export async function openChangesAtLine(projectId: string, subject: ChangesSubject, at: { path: string; side: 'old' | 'new'; line: number }): Promise<string | undefined> {
  lastSeq += 1
  useLineRequests.setState({ request: { projectId, epic: subject.epic, num: subject.num, ...at, seq: lastSeq, at: Date.now() } })
  return openChangesFromPalette(projectId, subject, currentLayout(projectId)?.nodes ?? [])
}

/** The line asked for the Ticket's Node, while it is fresh (LINE_REQUEST_MS); null when there is none. */
export function lineRequestFor(request: LineRequest | null, projectId: string, subject: ChangesSubject, now = Date.now()): LineRequest | null {
  if (request === null || request.projectId !== projectId || request.epic !== subject.epic || request.num !== subject.num) return null
  return now - request.at <= LINE_REQUEST_MS ? request : null
}
