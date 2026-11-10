import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { imageMediaTypeSchema } from '../../shared/agent/attachments'
import { isArchived, type Layout } from '../../shared/layout/types'
import type { QuoteComment, SentQuote } from './quote-comments'

// The comments of a Session's agent messages (worfy-polish ticket 102, quote-comments.ts): the ones
// not sent yet, which the tray above the input field holds, and the sent ones, whose quotes stay
// dim in the messages for good (owner, answer 2).
//
// - Kept like the field's draft (drafts.ts, worfy-polish ticket 95): in this window's localStorage,
//   which lives in worfy's data folder (ADR-0005), so the comments survive another Session picked,
//   another Project and a restart. The copy in memory changes at once; the storage is written
//   WRITE_DELAY_MS after the last change and when the page goes.
// - One entry per Session of a Node (quoteKey): `<Project>/<Node>/<SDK session id>`. A Node that
//   leaves the Layout or that the archive takes drops its entries (dropGoneQuotes, canvas/useLayout.ts).
// - An entry the storage cannot hold (the images of its comments are past the window's quota) is
//   kept in this window alone while it is open, and the error goes to the console. An entry that
//   does not read as one (another version wrote it, or it is damaged) reads as none.
// - SENT_KEPT sent quotes stay per Session, the newest; older ones lose their dim light.

const PREFIX = 'worfy.quotes:'

/** How long after the last change the storage is written, in ms. */
export const WRITE_DELAY_MS = 300

/** The sent quotes kept per Session. */
export const SENT_KEPT = 500

/** The key of a Session's comments: `<Project>/<Node>/<SDK session id>`. */
export function quoteKey(projectId: string, nodeId: string, sessionId: string): string {
  return `${projectId}/${nodeId}/${sessionId}`
}

const imageSchema = z.object({ kind: z.literal('image'), name: z.string(), mediaType: imageMediaTypeSchema, size: z.number(), data: z.string() })
const rangeFields = { id: z.string(), anchor: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), quote: z.string(), text: z.string(), at: z.number() }
const commentSchema = z.object({ ...rangeFields, images: z.array(imageSchema), messageAt: z.number().nullable() })
const sentSchema = z.object({ ...rangeFields, images: z.number().int().nonnegative(), message: z.string(), number: z.number().int().positive() })
const entrySchema = z.object({ v: z.literal(1), drafts: z.array(commentSchema), sent: z.array(sentSchema) })

/** The comments of one Session. */
export interface QuoteState {
  drafts: readonly QuoteComment[]
  sent: readonly SentQuote[]
}

export const EMPTY_QUOTES: QuoteState = { drafts: [], sent: [] }

let entries: Map<string, QuoteState> | null = null
const pending = new Set<string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function known(): Map<string, QuoteState> {
  if (entries !== null) return entries
  entries = new Map()
  try {
    const storage = globalThis.localStorage
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index)
      if (!name?.startsWith(PREFIX)) continue
      try {
        const parsed = entrySchema.safeParse(JSON.parse(storage.getItem(name) ?? 'null'))
        if (parsed.success) entries.set(name.slice(PREFIX.length), { drafts: parsed.data.drafts, sent: parsed.data.sent })
      } catch {
        // Not JSON: no comments.
      }
    }
  } catch {
    // An unreadable storage holds no comments.
  }
  return entries
}

function store(key: string): void {
  pending.delete(key)
  const state = known().get(key)
  try {
    if (state === undefined || (state.drafts.length === 0 && state.sent.length === 0)) globalThis.localStorage.removeItem(PREFIX + key)
    else globalThis.localStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, drafts: state.drafts, sent: state.sent }))
  } catch (error) {
    console.error('[quotes] could not keep the comments of a Session', error)
  }
}

/** Writes every entry that changed since its last write, now. */
export function flushQuotes(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  for (const key of [...pending]) store(key)
}

/** The comments of a Session; none when it has none. */
export function readQuotes(key: string): QuoteState {
  return known().get(key) ?? EMPTY_QUOTES
}

/** Changes a Session's comments: in memory now, in the storage after WRITE_DELAY_MS. */
export function changeQuotes(key: string, change: (state: QuoteState) => QuoteState): void {
  const map = known()
  const next = change(map.get(key) ?? EMPTY_QUOTES)
  const kept = next.sent.length > SENT_KEPT ? { ...next, sent: next.sent.slice(-SENT_KEPT) } : next
  if (kept.drafts.length === 0 && kept.sent.length === 0) map.delete(key)
  else map.set(key, kept)
  pending.add(key)
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flushQuotes, WRITE_DELAY_MS)
  for (const listener of [...listeners]) listener()
}

/** Adds a comment, or puts a deleted one back. */
export function addDraft(key: string, comment: QuoteComment): void {
  changeQuotes(key, (state) => ({ ...state, drafts: [...state.drafts.filter((each) => each.id !== comment.id), comment] }))
}

/** Changes the text and the images of a comment. */
export function editDraft(key: string, id: string, change: Pick<QuoteComment, 'text' | 'images'>): void {
  changeQuotes(key, (state) => ({ ...state, drafts: state.drafts.map((each) => (each.id === id ? { ...each, ...change } : each)) }))
}

/** Deletes comments; answers the ones deleted, for Undo. */
export function removeDrafts(key: string, ids: readonly string[]): QuoteComment[] {
  const gone = readQuotes(key).drafts.filter((each) => ids.includes(each.id))
  if (gone.length > 0) changeQuotes(key, (state) => ({ ...state, drafts: state.drafts.filter((each) => !ids.includes(each.id)) }))
  return gone
}

/** The comments went in `message`, numbered in its order: they leave the tray and stay as sent quotes. */
export function markSent(key: string, sent: readonly QuoteComment[], message: string, at: number): void {
  const ids = new Set(sent.map((each) => each.id))
  changeQuotes(key, (state) => ({
    drafts: state.drafts.filter((each) => !ids.has(each.id)),
    sent: [
      ...state.sent,
      ...sent.map((each, index): SentQuote => ({ id: each.id, anchor: each.anchor, start: each.start, end: each.end, quote: each.quote, text: each.text, images: each.images.length, message, number: index + 1, at })),
    ],
  }))
}

/**
 * Drops the comments of the Nodes of `projectId` that `after` no longer shows: archived in it, or in
 * `before` and gone from it (deleted). A Node absent from both is left alone, as drafts.ts does.
 */
export function dropGoneQuotes(projectId: string, before: Layout | undefined, after: Layout): void {
  const map = known()
  if (map.size === 0) return
  const now = new Map(after.nodes.map((node) => [node.id, node]))
  const had = new Set(before?.nodes.map((node) => node.id) ?? [])
  const prefix = `${projectId}/`
  for (const key of [...map.keys()]) {
    if (!key.startsWith(prefix)) continue
    const nodeId = key.slice(prefix.length).split('/')[0] ?? ''
    const node = now.get(nodeId)
    if (node === undefined ? had.has(nodeId) : isArchived(node)) {
      map.delete(key)
      store(key)
      for (const listener of [...listeners]) listener()
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A Session's comments, kept up to date; none without a key. */
export function useQuotes(key: string | null): QuoteState {
  return useSyncExternalStore(
    subscribe,
    () => (key === null ? EMPTY_QUOTES : readQuotes(key)),
    () => EMPTY_QUOTES,
  )
}

/** Forgets what memory holds, so the next read is from the storage: for tests, as a restart. */
export function forgetQuotesInMemory(): void {
  flushQuotes()
  entries = null
}

// A quit or a reload goes before the timer fires: the comments are written as the page goes.
globalThis.addEventListener?.('pagehide', flushQuotes)
globalThis.addEventListener?.('beforeunload', flushQuotes)
