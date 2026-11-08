// The format of `mind-map.json`, the Mind map file of a Product Session topic, and its one check
// (ADR-0101, docs/adr/0101-product-session-folder-and-mind-map.md; Epic worfy-product-session, ticket 03).
// This is a public contract: the tools `mind_map_*` check a node with it before they write, and the
// screen checks the file with it when it reads, so a file edited by hand or by another agent shows
// its errors, with the id of each node, instead of an empty map.
//
// A node has one parent (`from`): another node, a Ticket of the topic's map (`ticket:NN`, the large
// nodes, which live in `issues/` and are not copied here) or the topic itself (null). `replaces` is
// the second, optional link: the Decision this Decision overturned. `x`, `y` and `collapsed` are
// written by the screen only, by the owner's hand.
import { z } from 'zod'

export const MIND_MAP_VERSION = 1

/**
 * The layout a node's `x` and `y` were written for: 2 — the Tree that grows left to right (ticket 21). A
 * place without it was written for the earlier top-down Tree, where it means nothing now, so the screen
 * ignores it and lays the node out again; the next move by hand writes it anew with this mark.
 */
export const MIND_MAP_PLACED = 2

/** Longest text of a node, a reason or a source: a Mind map node is a short line, not a document. */
export const MIND_MAP_TEXT_MAX = 2000

export const MIND_MAP_NODE_KINDS = ['idea', 'question', 'decision', 'objection'] as const
export type MindMapNodeKind = (typeof MIND_MAP_NODE_KINDS)[number]

export const DECISION_STATUSES = ['accepted', 'rejected'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

/**
 * `ticket:02` — a Ticket of the topic's map as a parent, in one spelling: the number as Ticket files
 * write it, at least two digits and no extra leading zero (`ticket:02`, `ticket:100`; not `ticket:2`
 * or `ticket:002`), so one Ticket has one reference.
 */
const TICKET_REF = /^ticket:(0[1-9]|[1-9]\d{1,3})$/

/** A node id: letters, digits, `_` and `-`; never `ticket:…`, which names a Ticket of the map. */
export const mindMapNodeIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'a node id is 1 to 64 letters, digits, _ or -')

const text = z
  .string()
  .max(MIND_MAP_TEXT_MAX)
  .refine((value) => value.trim() !== '', 'must not be empty or blanks only')

/** One earlier state of a Decision, oldest first. */
export const decisionHistoryEntrySchema = z.object({
  status: z.enum(DECISION_STATUSES),
  reason: text,
  /** The chat message (transcript event uuid) where the Decision had this state. */
  message: z.string().min(1).optional(),
})

// The rules that tie fields to a kind (a Decision has a status and a reason, an Objection a source)
// are checked by checkMindMap, not here: there each broken rule becomes an error that names its node.
export const mindMapNodeSchema = z.object({
  id: mindMapNodeIdSchema,
  kind: z.enum(MIND_MAP_NODE_KINDS),
  text,
  /** The parent: a node id, `ticket:NN`, or null for the topic itself. */
  from: z.string().min(1).nullable(),
  /** Decision only. */
  status: z.enum(DECISION_STATUSES).optional(),
  /** Decision only: why it was accepted or rejected. */
  reason: z.string().max(MIND_MAP_TEXT_MAX).optional(),
  /** Objection only: the fact it rests on — a document path, a Ticket, a PR, a URL. */
  source: z.string().max(MIND_MAP_TEXT_MAX).optional(),
  /** Proposed by the advisor (an idea, a critic's objection); counted in the share of accepted advice. */
  advice: z.boolean().optional(),
  /** The id of the Decision this Decision overturned. */
  replaces: mindMapNodeIdSchema.optional(),
  /** The earlier statuses and reasons of a Decision. */
  history: z.array(decisionHistoryEntrySchema).optional(),
  /** The chat message (transcript event uuid) where the node appeared or last changed. */
  message: z.string().min(1).optional(),
  /** Position on the screen; written by the screen only. */
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  /** The layout `x` and `y` are for (MIND_MAP_PLACED); written by the screen only, with them. */
  placed: z.literal(MIND_MAP_PLACED).optional(),
  /** The branch under this node is folded; written by the screen only. */
  collapsed: z.boolean().optional(),
})

export const mindMapSchema = z.object({
  version: z.literal(MIND_MAP_VERSION),
  nodes: z.array(mindMapNodeSchema),
})

export type MindMapNode = z.infer<typeof mindMapNodeSchema>
export type MindMap = z.infer<typeof mindMapSchema>

/** One problem of a file; `id` is the node it is about, null when it is about the file as a whole. */
export interface MindMapError {
  id: string | null
  message: string
}

export type MindMapCheck = { ok: true; map: MindMap } | { ok: false; errors: MindMapError[] }

/** The node id at `nodes[index]` of the raw value, when there is one to name. */
function rawNodeId(value: unknown, index: PropertyKey | undefined): string | null {
  if (typeof index !== 'number' || typeof value !== 'object' || value === null) return null
  const nodes = (value as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return null
  const node: unknown = nodes[index]
  if (typeof node !== 'object' || node === null) return null
  const id = (node as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

const nodeError = (id: string, message: string): MindMapError => ({ id, message: `node "${id}": ${message}` })

/** The ids on the cycle that `start` leads into through `parent`, or null when its chain ends. */
function cycleFrom(start: string, parent: ReadonlyMap<string, string | null>, done: Set<string>): string[] | null {
  const path: string[] = []
  const onPath = new Set<string>()
  let at: string | null | undefined = start
  while (at !== null && at !== undefined && parent.has(at) && !done.has(at)) {
    if (onPath.has(at)) return path.slice(path.indexOf(at))
    onPath.add(at)
    path.push(at)
    at = parent.get(at)
  }
  for (const id of path) done.add(id)
  return null
}

/**
 * Checks a parsed `mind-map.json` against the format and the Tickets of its map (their numbers,
 * `02` → 2). Returns the nodes, or every error found, each naming its node: a wrong field, two nodes
 * with one id, a `from` that is neither a node nor a Ticket of the map, a cycle through `from`,
 * `replaces` on a node that is not a Decision or pointing at one that is not, a cycle through
 * `replaces` (a Decision that replaces itself among them), a Decision without a status or a reason,
 * an Objection without a source.
 */
export function checkMindMap(value: unknown, tickets: readonly number[]): MindMapCheck {
  const parsed = mindMapSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const where = issue.path.join('.')
        const id = issue.path[0] === 'nodes' ? rawNodeId(value, issue.path[1]) : null
        const message = `${where === '' ? 'file' : where}: ${issue.message}`
        return id === null ? { id: null, message } : nodeError(id, message)
      }),
    }
  }

  const map = parsed.data
  const errors: MindMapError[] = []
  const byId = new Map<string, MindMapNode>()
  for (const node of map.nodes) {
    if (byId.has(node.id)) errors.push(nodeError(node.id, 'two nodes have this id'))
    else byId.set(node.id, node)
  }
  const ticketSet = new Set(tickets)

  // Only links to nodes take part in the cycle searches; a Ticket, the topic or a missing node ends a chain.
  const parent = new Map<string, string | null>()
  const replaced = new Map<string, string | null>()
  for (const node of byId.values()) {
    parent.set(node.id, node.from !== null && byId.has(node.from) ? node.from : null)
    replaced.set(node.id, node.kind === 'decision' && node.replaces !== undefined && byId.has(node.replaces) ? node.replaces : null)
  }

  for (const node of map.nodes) {
    if (node.from !== null && !byId.has(node.from)) {
      const ticket = TICKET_REF.exec(node.from)
      if (ticket === null) errors.push(nodeError(node.id, `from "${node.from}" is neither a node nor ticket:NN (two digits at least, no extra leading zero)`))
      else if (!ticketSet.has(Number(ticket[1]))) errors.push(nodeError(node.id, `from "${node.from}": the map has no such Ticket`))
    }
    if (node.replaces !== undefined) {
      const target = byId.get(node.replaces)
      if (node.kind !== 'decision') errors.push(nodeError(node.id, `only a decision may carry replaces; this node is a ${node.kind}`))
      else if (target === undefined) errors.push(nodeError(node.id, `replaces "${node.replaces}": there is no such node`))
      else if (target.kind !== 'decision') errors.push(nodeError(node.id, `replaces "${node.replaces}", which is a ${target.kind}, not a decision`))
    }
    if (node.kind === 'decision') {
      if (node.status === undefined) errors.push(nodeError(node.id, 'a decision needs a status: accepted or rejected'))
      if (node.reason === undefined || node.reason.trim() === '') errors.push(nodeError(node.id, 'a decision needs a reason'))
    }
    if (node.kind === 'objection' && (node.source === undefined || node.source.trim() === '')) {
      errors.push(nodeError(node.id, 'an objection needs a source: the fact it rests on'))
    }
  }

  for (const [link, links] of [['from', parent], ['replaces', replaced]] as const) {
    const done = new Set<string>()
    for (const id of byId.keys()) {
      const cycle = cycleFrom(id, links, done)
      if (cycle === null) continue
      for (const member of cycle) done.add(member)
      errors.push(nodeError(cycle[0]!, `a cycle through ${link}: ${[...cycle, cycle[0]!].map((member) => `"${member}"`).join(' → ')}`))
    }
  }

  return errors.length === 0 ? { ok: true, map } : { ok: false, errors }
}
