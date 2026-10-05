// Pure functions behind the command palette (⌘K) and the search over the Canvas (⌘F), ticket 31.
// Nothing here touches React, the DOM or IPC, so both are tested with plain objects.
//
// - The palette ranks a few hundred commands on every keystroke: rankItems() scores each one
//   against the query. An exact key (a Ticket number such as "07", "7" or "worfy-mvp/07", an ADR
//   number) beats every title, so "07" lands on Ticket 07 and not on a title that has the digits.
// - The search over the Canvas keeps a FindIndex of documents — one per Node title, Ticket title,
//   open transcript, HANDOFF and Card text — that its owner updates when those sources change
//   (set/remove), never per keystroke. A query scans the lower-cased texts; a query that only adds
//   characters to the previous one scans only the documents that matched it.

// ── palette ranking ─────────────────────────────────────────────────────────

export interface Rankable {
  title: string
  /** Shown after the title (an id, a path); searched after the title. */
  detail?: string | undefined
  /** Exact keys: a query equal to one of them ranks above every title match. */
  keys?: readonly string[] | undefined
}

/** Lower-cased, trimmed, inner whitespace collapsed to one space. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

const TIER_KEY = 100_000
const TIER_PREFIX = 50_000
const TIER_WORD = 30_000
const TIER_TITLE = 20_000
const TIER_DETAIL = 15_000
const TIER_WORDS = 10_000
const TIER_FUZZY = 1_000

const isWordStart = (text: string, index: number): boolean => index === 0 || /[\s/\-_.:·—(]/.test(text[index - 1]!)

/** Characters of `query` in order inside `text`: a score that falls with the gaps between them, or 0. */
function fuzzy(query: string, text: string): number {
  let at = 0
  let gaps = 0
  let last = -1
  for (const char of query) {
    if (char === ' ') continue
    const found = text.indexOf(char, at)
    if (found < 0) return 0
    if (last >= 0) gaps += found - last - 1
    last = found
    at = found + 1
  }
  return Math.max(1, TIER_FUZZY - gaps * 10 - (text.length - query.length))
}

/** How well `item` answers an already normalized query; 0 when it does not. Higher is better. */
export function matchScore(query: string, item: Rankable): number {
  if (query === '') return 1
  if (item.keys?.some((key) => key.toLowerCase() === query)) return TIER_KEY
  const title = item.title.toLowerCase()
  const detail = (item.detail ?? '').toLowerCase()
  const at = title.indexOf(query)
  if (at === 0) return TIER_PREFIX - title.length
  if (at > 0) {
    // A match at the start of a word ("ship" in "Ship ticket") beats one inside a word.
    for (let index = at; index >= 0; index = title.indexOf(query, index + 1)) {
      if (isWordStart(title, index)) return TIER_WORD - index
    }
    return TIER_TITLE - at
  }
  const inDetail = detail.indexOf(query)
  if (inDetail >= 0) return TIER_DETAIL - inDetail
  const haystack = `${title} ${detail}`
  const words = query.split(' ')
  if (words.length > 1 && words.every((word) => haystack.includes(word))) return TIER_WORDS - haystack.length
  return fuzzy(query, haystack)
}

/** The items that match `query`, best first; ties keep the items' own order. At most `limit`. */
export function rankItems<T extends Rankable>(items: readonly T[], query: string, limit = Number.POSITIVE_INFINITY): T[] {
  const q = normalizeQuery(query)
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const score = matchScore(q, item)
    if (score > 0) scored.push({ item, score, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(({ item }) => item)
}

// ── Node titles ─────────────────────────────────────────────────────────────

/** What a Node of each kind is called when it has no title of its own. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  note: 'Note',
  terminal: 'Terminal',
  handoff: 'HANDOFF',
  card: 'Card',
  orchestrator: 'Orchestrator',
  session: 'Session',
}

/** A kind's name for people: "Note" for `note`, the kind itself for one without a name. */
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

/**
 * A Node's title as the canvas tools name it (src/main/mcp/canvas-server.ts): `data.title`, else
 * the first non-empty line of `data.text`; null when it has neither.
 */
export function nodeTitle(node: { data: Record<string, unknown> }): string | null {
  const { title, text } = node.data
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  if (typeof text === 'string') {
    const line = text.split('\n').find((each) => each.trim() !== '')
    if (line !== undefined) return line.trim().slice(0, 120)
  }
  return null
}

// ── search over the Canvas ──────────────────────────────────────────────────

/** Where a document's text comes from; the find bar names it next to the count. */
export type FindField = 'node' | 'ticket' | 'transcript' | 'handoff' | 'card'

export interface FindDoc {
  /** Unique per document, e.g. `transcript:<sessionId>`. */
  key: string
  /** The Node the Canvas moves to for a match in this document. */
  nodeId: string
  field: FindField
  text: string
  /** Centered instead when `nodeId` is not on the Canvas (a Ticket of a collapsed frame). */
  fallbackId?: string | undefined
}

export interface FindMatch {
  key: string
  nodeId: string
  field: FindField
  /** Position of the match in the document's text. */
  offset: number
  fallbackId?: string | undefined
}

export interface FindResult {
  matches: FindMatch[]
  /** Matches counted, up to the limit. */
  total: number
  /** True when the search stopped at the limit: there are more. */
  capped: boolean
}

/** Queries shorter than this find nothing: a single letter would match most of every transcript. */
export const MIN_FIND_QUERY = 2
/** The search stops counting here; the bar then shows "1000+". */
export const FIND_LIMIT = 1000

interface Stored {
  doc: FindDoc
  lower: string
}

export interface FindOptions {
  /** Only documents of these Nodes; undefined: every document. */
  scope?: ReadonlySet<string> | undefined
  limit?: number
}

/**
 * The documents the search runs over. The owner sets a document when its source changes and
 * removes it when the source is gone; `set` with the same text changes nothing.
 */
export class FindIndex {
  private readonly docs = new Map<string, Stored>()
  private version = 0
  /** The last search, to narrow the next one when the query only grew. */
  private last: { query: string; version: number; scope: ReadonlySet<string> | undefined; limit: number; keys: string[]; capped: boolean } | null = null

  get size(): number {
    return this.docs.size
  }

  keys(): string[] {
    return [...this.docs.keys()]
  }

  /** Adds or replaces a document; true when anything changed. */
  set(doc: FindDoc): boolean {
    const known = this.docs.get(doc.key)
    if (known && known.doc.text === doc.text && known.doc.nodeId === doc.nodeId && known.doc.field === doc.field && known.doc.fallbackId === doc.fallbackId) return false
    this.docs.set(doc.key, { doc, lower: doc.text.toLowerCase() })
    this.version += 1
    return true
  }

  remove(key: string): boolean {
    if (!this.docs.delete(key)) return false
    this.version += 1
    return true
  }

  /** Removes every document whose key is not in `keys` (a source that disappeared). */
  retain(keys: ReadonlySet<string>): void {
    for (const key of [...this.docs.keys()]) if (!keys.has(key)) this.remove(key)
  }

  /**
   * Makes the index hold exactly `docs`: unchanged documents keep their lower-cased text, so only
   * what changed is lower-cased again. Answers the index's version, which changes with any change.
   */
  sync(docs: readonly FindDoc[]): number {
    for (const doc of docs) this.set(doc)
    this.retain(new Set(docs.map((doc) => doc.key)))
    return this.version
  }

  /** The text of a document, as it was set. */
  text(key: string): string | undefined {
    return this.docs.get(key)?.doc.text
  }

  search(query: string, { scope, limit = FIND_LIMIT }: FindOptions = {}): FindResult {
    const q = normalizeQuery(query)
    if (q.length < MIN_FIND_QUERY) {
      this.last = null
      return { matches: [], total: 0, capped: false }
    }
    // The query grew and nothing else changed: only documents that matched before can match now.
    const narrowed =
      this.last !== null &&
      !this.last.capped &&
      this.last.version === this.version &&
      this.last.scope === scope &&
      this.last.limit === limit &&
      q.startsWith(this.last.query)
    const candidates = narrowed ? this.last!.keys : [...this.docs.keys()]

    const matches: FindMatch[] = []
    const matchedKeys: string[] = []
    let capped = false
    for (const key of candidates) {
      const stored = this.docs.get(key)
      if (!stored) continue
      const { doc, lower } = stored
      if (scope !== undefined && !scope.has(doc.nodeId)) continue
      let at = lower.indexOf(q)
      if (at >= 0) matchedKeys.push(key)
      while (at >= 0) {
        if (matches.length >= limit) {
          capped = true
          break
        }
        matches.push({ key, nodeId: doc.nodeId, field: doc.field, offset: at, fallbackId: doc.fallbackId })
        at = lower.indexOf(q, at + q.length)
      }
      if (capped) break
    }
    this.last = { query: q, version: this.version, scope, limit, keys: matchedKeys, capped }
    return { matches, total: matches.length, capped }
  }
}

// ── what the search runs over ───────────────────────────────────────────────

/** The parts of a Session's events that are its transcript's text. */
type TranscriptEvent = { type: string; text?: unknown; kind?: unknown }

const transcriptCache = new WeakMap<readonly TranscriptEvent[], string>()

/**
 * The text of a transcript: what Claude wrote, the user's messages and notices. A streamed answer
 * counts while it streams; once its whole `text` event is in, the stream before it is not counted
 * twice. Cached per events array, which the stores replace on every change.
 */
export function transcriptText(events: readonly TranscriptEvent[]): string {
  const cached = transcriptCache.get(events)
  if (cached !== undefined) return cached
  const parts: string[] = []
  let streaming: string[] = []
  for (const event of events) {
    if (event.type === 'delta') {
      if (event.kind === 'text' && typeof event.text === 'string') streaming.push(event.text)
      continue
    }
    if (event.type === 'text' || event.type === 'notice') {
      streaming = []
      if (typeof event.text === 'string') parts.push(event.text)
    }
  }
  if (streaming.length) parts.push(streaming.join(''))
  const text = parts.join('\n')
  transcriptCache.set(events, text)
  return text
}

/** A Node of the Layout as the search reads it. */
export interface FindNode {
  id: string
  kind: string
  hidden: boolean
  data: Record<string, unknown>
}

export interface FindSources {
  /** The Layout's Nodes. */
  nodes: readonly FindNode[]
  /** Epics and Tickets of the workflow model; Tickets are drawn by the Canvas, not kept in the Layout. */
  epics: readonly { epic: string; title: string | null }[]
  tickets: readonly { epic: string; num: number; title: string }[]
  /** Events of the Sessions open in this window, by session id. */
  transcripts: Readonly<Record<string, { events: readonly TranscriptEvent[] }>>
  /** HANDOFF.md, when the Project has it and it was read. */
  handoff: string | undefined
  /** The visible text of Cards, by Node id, as far as the Cards answered `card.text`. */
  cards: Readonly<Record<string, string>>
}

/** Kinds that the search does not read titles of: drawn by a source, or an anchor without text. */
const NO_TITLE_KINDS = new Set(['epic-frame', 'ticket', 'subagent', 'subagent-tree', 'binding-anchor'])

const pad = (num: number): string => String(num).padStart(2, '0')

/** Every document of the search over the Canvas, from the sources the window holds. */
export function findDocs({ nodes, epics, tickets, transcripts, handoff, cards }: FindSources): FindDoc[] {
  const docs: FindDoc[] = []
  for (const epic of epics) {
    docs.push({ key: `epic:${epic.epic}`, nodeId: `epic:${epic.epic}`, field: 'node', text: epic.title === null ? epic.epic : `${epic.epic} ${epic.title}` })
  }
  for (const ticket of tickets) {
    docs.push({
      key: `ticket:${ticket.epic}/${ticket.num}`,
      nodeId: `ticket:${ticket.epic}/${ticket.num}`,
      fallbackId: `epic:${ticket.epic}`,
      field: 'ticket',
      text: `${ticket.epic}/${pad(ticket.num)} ${ticket.title}`,
    })
  }
  let handoffShown = false
  for (const node of nodes) {
    if (node.hidden || NO_TITLE_KINDS.has(node.kind)) continue
    const title = nodeTitle(node)
    if (title !== null) docs.push({ key: `node:${node.id}`, nodeId: node.id, field: 'node', text: title })
    const sessionId = node.data.sessionId
    if (typeof sessionId === 'string') {
      const log = transcripts[sessionId]
      if (log !== undefined) docs.push({ key: `transcript:${node.id}`, nodeId: node.id, field: 'transcript', text: transcriptText(log.events) })
    }
    if (node.kind === 'handoff' && handoff !== undefined && !handoffShown) {
      handoffShown = true
      docs.push({ key: 'handoff', nodeId: node.id, field: 'handoff', text: handoff })
    }
    const card = cards[node.id]
    if (node.kind === 'card' && card !== undefined) docs.push({ key: `card:${node.id}`, nodeId: node.id, field: 'card', text: card })
  }
  return docs
}

/** The order of fields inside one Node: its title first, then the texts behind it. */
const FIELD_ORDER: Record<FindField, number> = { node: 0, ticket: 1, handoff: 2, card: 3, transcript: 4 }

/**
 * Matches in reading order on the Canvas: by the top of their Node, then its left edge, then the
 * field and the position in the text. A match whose Node is not on the Canvas takes the place of
 * its fallback (a Ticket's frame); one with neither goes last.
 */
export function orderMatches(matches: readonly FindMatch[], placeOf: (nodeId: string) => { x: number; y: number } | undefined): FindMatch[] {
  const places = new Map<string, { x: number; y: number } | undefined>()
  const lookup = (nodeId: string) => {
    if (!places.has(nodeId)) places.set(nodeId, placeOf(nodeId))
    return places.get(nodeId)
  }
  const place = (match: FindMatch) => lookup(match.nodeId) ?? (match.fallbackId === undefined ? undefined : lookup(match.fallbackId))
  return matches
    .map((match, index) => ({ match, index, at: place(match) }))
    .sort((a, b) => {
      const pa = a.at
      const pb = b.at
      if (pa === undefined || pb === undefined) {
        if (pa !== pb) return pa === undefined ? 1 : -1
      } else if (pa.y !== pb.y || pa.x !== pb.x) return pa.y - pb.y || pa.x - pb.x
      if (a.match.nodeId !== b.match.nodeId) return a.match.nodeId.localeCompare(b.match.nodeId)
      return FIELD_ORDER[a.match.field] - FIELD_ORDER[b.match.field] || a.match.key.localeCompare(b.match.key) || a.match.offset - b.match.offset || a.index - b.index
    })
    .map(({ match }) => match)
}

/**
 * The Nodes a search with a selection covers: the selected ones and everything inside them (the
 * Tickets of a selected Epic frame). Undefined when nothing is selected: the whole Canvas.
 */
export function selectionScope(selected: readonly string[], nodes: readonly { id: string; parentId?: string | undefined }[]): Set<string> | undefined {
  if (selected.length === 0) return undefined
  const scope = new Set(selected)
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parentId !== undefined && scope.has(node.parentId) && !scope.has(node.id)) {
        scope.add(node.id)
        grew = true
      }
    }
  }
  return scope
}

/** The next match after `current` (or before it with `back`), wrapping around; -1 when there is none. */
export function stepMatch(current: number, count: number, back = false): number {
  if (count === 0) return -1
  if (current < 0 || current >= count) return back ? count - 1 : 0
  return (current + (back ? count - 1 : 1)) % count
}

/** A short piece of `text` around a match, for the find bar. */
export function snippet(text: string, offset: number, length: number, radius = 32): string {
  const start = Math.max(0, offset - radius)
  const end = Math.min(text.length, offset + length + radius)
  const piece = text.slice(start, end).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`
}
