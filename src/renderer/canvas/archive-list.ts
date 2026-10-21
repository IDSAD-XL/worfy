// The Archive of a Project's Canvas (ADR-0076, worfy-canvas ticket 09): the Session Nodes the
// automatic archive took off the Canvas, grouped by their Session's Binding — to a Ticket, to an
// Epic, without one — each group newest first. A Ticket shows its group as «N sessions»
// (badges/SessionHistory.tsx); an Epic frame shows its own and its Tickets' (actions/EpicSessionHistory.tsx);
// the Sessions without a Binding are in the «Archive» popover next to Trash (overlays/ArchivePopover.tsx).
//
// The list is built once per Canvas, by the Archive popover, and published here by Project: a badge
// on each Ticket reads its group from this store instead of resolving every Binding again.
//
// Show and Restore go through the Canvas's LayoutOps, so each is one step of the user's undo
// history. Restore is one `restore`: main puts a restored Node at its place when that is clear, else
// at the nearest clear one (ADR-0038), and the undo (history.ts) archives the Nodes again with their
// rule, batch and time and moves them back where they stood. Show is one gesture: a move of the
// archived Node next to its Ticket or frame — the spot a new bound Session gets (session-spot.ts) —
// then the `restore`; its undo archives the Node again and moves it back to its old place.
//
// A Session whose Binding is not known yet (its transcript's signals, the manual Bindings or the
// workflow model are still being read) is in `pending`, in no group: until then it would look
// unbound and «Restore all from today» would take it along. Nothing is ever deleted
// from the Archive here: Remove on a restored Node does that (Trash, ADR-0016).
import { create } from 'zustand'
import type { BindingTarget } from '../../shared/binding/resolve'
import { SESSION_NODE_KIND } from '../../shared/ipc/sessions'
import { onThePlane } from '../../shared/layout/derived'
import { freePlace, type Rect } from '../../shared/layout/free-place'
import { isArchived, type ArchiveRule, type Layout, type LayoutNode, type LayoutOpInput } from '../../shared/layout/types'
import { ticketKey } from '../../shared/workflow/types'
import { grouped, type Group } from './history'

/**
 * What Show and Restore send through: the Canvas's LayoutOps (useLayout.ts), which records each
 * gesture as a step of ⌘Z. Written out rather than Pick<LayoutOps, 'apply'>: useLayout.ts brings
 * React's DOM types into the Node test program (tsconfig.test.node.json), and they break the e2e specs' types.
 */
export interface ArchiveOps {
  apply(op: LayoutOpInput, group?: Group): Promise<void>
}

/** One archived Session Node. */
export interface ArchivedSession {
  nodeId: string
  sessionId: string
  title: string
  /** When the archive took the Node, in ms since the epoch. */
  archivedAt: number
  rule: ArchiveRule
  /** When the Session wrote its last record (its history's `lastAt`), in ms; null when not known. */
  endedAt: number | null
  /** What its Session is bound to; null without a Binding, or while its signals are not read. */
  binding: BindingTarget | null
}

export interface ArchiveList {
  /** By `<epic>/<NN>` (ticketKey). */
  tickets: ReadonlyMap<string, readonly ArchivedSession[]>
  /** The Sessions bound to the Epic itself, by Epic. */
  epics: ReadonlyMap<string, readonly ArchivedSession[]>
  unbound: readonly ArchivedSession[]
  /** The Sessions whose Binding is not known yet, newest first: in no group until it is. */
  pending: readonly ArchivedSession[]
  /** Every archived Session Node of the Project. */
  count: number
}

export const EMPTY_ARCHIVE: ArchiveList = { tickets: new Map(), epics: new Map(), unbound: [], pending: [], count: 0 }

/** What the list reads of a Session's history (claudeHome.sessions). */
export interface ArchiveHistoryEntry {
  sessionId: string
  title?: string | undefined
  lastAt?: string | undefined
}

/** The archived Session Nodes of a Layout, one per Session, in the order of the Layout. */
export function archivedSessionNodes(layout: Layout): LayoutNode[] {
  const seen = new Set<string>()
  return layout.nodes.filter((node) => {
    const sessionId = node.data.sessionId
    if (node.kind !== SESSION_NODE_KIND || !isArchived(node) || typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) return false
    seen.add(sessionId)
    return true
  })
}

const newestFirst = (a: ArchivedSession, b: ArchivedSession): number => b.archivedAt - a.archivedAt || a.nodeId.localeCompare(b.nodeId)

function timeOf(iso: string | undefined): number | null {
  if (iso === undefined) return null
  const time = Date.parse(iso)
  return Number.isFinite(time) ? time : null
}

/**
 * The Project's archive, grouped by Binding. `bindings` has each Session's target by Session id;
 * a Session it does not name is without a Binding, unless `known` says its Binding is not known
 * yet: then it is pending. main accepts any non-negative archive time, a future one too (a clock
 * set wrong, a Layout written on another machine): `archivedAt` is capped at `now`, so such a
 * Session reads and sorts as archived just now instead of staying above the ones archived after it.
 */
export function archiveList(
  layout: Layout,
  history: readonly ArchiveHistoryEntry[],
  bindings: ReadonlyMap<string, BindingTarget>,
  known: (sessionId: string) => boolean = () => true,
  now: number = Date.now(),
): ArchiveList {
  const historyById = new Map(history.map((entry) => [entry.sessionId, entry]))
  const tickets = new Map<string, ArchivedSession[]>()
  const epics = new Map<string, ArchivedSession[]>()
  const unbound: ArchivedSession[] = []
  const pending: ArchivedSession[] = []
  const nodes = archivedSessionNodes(layout)
  for (const node of nodes) {
    const sessionId = node.data.sessionId as string
    const recorded = historyById.get(sessionId)
    const name = typeof node.data.name === 'string' && node.data.name !== '' ? node.data.name : undefined
    const binding = bindings.get(sessionId) ?? null
    const session: ArchivedSession = {
      nodeId: node.id,
      sessionId,
      title: recorded?.title ?? name ?? `Session ${sessionId.slice(0, 8)}`,
      archivedAt: Math.min(node.archived!.at, now),
      rule: node.archived!.rule,
      endedAt: timeOf(recorded?.lastAt),
      binding,
    }
    if (binding === null) (known(sessionId) ? unbound : pending).push(session)
    else if (binding.kind === 'ticket') push(tickets, ticketKey(binding), session)
    else push(epics, binding.epic, session)
  }
  for (const group of [...tickets.values(), ...epics.values(), unbound, pending]) group.sort(newestFirst)
  return { tickets, epics, unbound, pending, count: nodes.length }
}

function push(groups: Map<string, ArchivedSession[]>, key: string, session: ArchivedSession): void {
  const group = groups.get(key)
  if (group === undefined) groups.set(key, [session])
  else group.push(session)
}

const NONE: readonly ArchivedSession[] = []

/** The archived Sessions bound to one Ticket, newest first. */
export function ticketHistory(list: ArchiveList, epic: string, num: number): readonly ArchivedSession[] {
  return list.tickets.get(ticketKey({ epic, num })) ?? NONE
}

/** The archived Sessions bound to an Epic or to one of its Tickets, newest first. */
export function epicHistory(list: ArchiveList, epic: string): ArchivedSession[] {
  const own = list.epics.get(epic) ?? NONE
  const ofTickets = [...list.tickets.values()].flatMap((group) => group.filter((session) => session.binding?.epic === epic))
  return [...own, ...ofTickets].sort(newestFirst)
}

/** The Sessions whose title holds `query`, ignoring case; an empty query keeps all. */
export function searchArchive(sessions: readonly ArchivedSession[], query: string): readonly ArchivedSession[] {
  const wanted = query.trim().toLocaleLowerCase()
  if (wanted === '') return sessions
  return sessions.filter((session) => session.title.toLocaleLowerCase().includes(wanted))
}

/** The Sessions archived since the local midnight before `now`. */
export function archivedToday(sessions: readonly ArchivedSession[], now: number): ArchivedSession[] {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  return sessions.filter((session) => session.archivedAt >= midnight.getTime())
}

/** Where Show puts a Node of this size near `spot`: the spot itself when it is clear, else the nearest clear place. */
export function showPlace(size: { w: number; h: number }, spot: { x: number; y: number }, obstacles: readonly Rect[]): { x: number; y: number } {
  return freePlace({ x: spot.x, y: spot.y, w: size.w, h: size.h }, obstacles)
}

/**
 * Restore: the archived ones of these Nodes come back, as one step of the history. Its undo puts
 * each Node back into the archive at the place it had, even when main moved it off a Node that
 * took that place (history.ts, the inverse of `restore`).
 */
export async function restoreSessions(ops: ArchiveOps, layout: Layout, nodeIds: readonly string[]): Promise<void> {
  const named = new Set(nodeIds)
  const ids = layout.nodes.filter((node) => named.has(node.id) && isArchived(node)).map((node) => node.id)
  if (ids.length === 0) return
  await ops.apply({ op: 'restore', ids })
}

/**
 * Show: the archived Node moves next to `spot` (clear of the Nodes on the plane and of `keepOut`,
 * the strip of Epic frames) and comes back there, as one gesture. Without a spot — no frame or
 * Ticket drawn to put it next to — it is a plain Restore.
 */
export async function showSession(ops: ArchiveOps, layout: Layout, nodeId: string, spot: { x: number; y: number } | undefined, keepOut: readonly Rect[]): Promise<void> {
  const node = layout.nodes.find((each) => each.id === nodeId)
  if (node === undefined || !isArchived(node)) return
  if (spot === undefined) return restoreSessions(ops, layout, [nodeId])
  const obstacles = [...layout.nodes.filter((each) => each.id !== nodeId && onThePlane(each)), ...keepOut]
  const place = showPlace(node, spot, obstacles)
  await grouped(async (group) => {
    await ops.apply({ op: 'move', id: nodeId, x: place.x, y: place.y }, group)
    await ops.apply({ op: 'restore', ids: [nodeId] }, group)
  })
}

// ── the published list ──────────────────────────────────────────────────────

const useArchiveStore = create<{ byProject: Readonly<Record<string, ArchiveList>> }>(() => ({ byProject: {} }))

/** The Archive popover publishes the Project's list each time it changes. */
export function publishArchive(projectId: string, list: ArchiveList): void {
  useArchiveStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: list } }))
}

/** The Project's archive as the Canvas last published it; empty before. */
export function useArchive(projectId: string): ArchiveList {
  return useArchiveStore((store) => store.byProject[projectId] ?? EMPTY_ARCHIVE)
}
