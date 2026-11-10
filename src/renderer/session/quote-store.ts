import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { imageMediaTypeSchema } from '../../shared/agent/attachments'
import { isArchived, type Layout } from '../../shared/layout/types'
import type { PendingRound, QuoteComment, SentQuote, SentRound } from './quote-comments'

// The comments of a Session's agent messages (worfy-polish ticket 102, quote-comments.ts): the ones
// not sent yet, which the tray above the input field holds; the rounds sent and waiting in the
// Session's queue; and the sent ones, whose quotes stay dim in the messages for good (owner, answer 2).
//
// - Kept like the field's draft (drafts.ts, worfy-polish ticket 95): in this window's localStorage,
//   which lives in worfy's data folder (ADR-0005), so the comments survive another Session picked,
//   another Project and a restart. The copy in memory changes at once; the storage is written
//   WRITE_DELAY_MS after the last change and when the page goes.
// - No image bytes go into the storage: main keeps each image of a comment (agent.attach with
//   `keep`) and a comment names it by its ref. The bytes this window read are kept in memory alone
//   (keepImageData), so a round sent before a restart needs no read back from main.
// - One entry per Session of a Node (quoteKey): `<Project>/<Node>/<SDK session id>`. A Node that
//   leaves the Layout or that the archive takes drops its entries (dropGoneQuotes, canvas/useLayout.ts);
//   a Node keeps the entries of its SESSIONS_KEPT Sessions changed last, and an older one goes.
// - A sent round keeps its message's text once (SentRound); SENT_KEPT sent quotes stay per Session,
//   the newest; older ones lose their dim light, and a round with no quote left goes.
// - An entry the storage cannot hold is kept in this window alone while it is open: the listeners of
//   onQuoteStoreError hear of it (the Session view shows it). An entry that does not read as one
//   (another version wrote it, or it is damaged) reads as none.

const PREFIX = 'worfy.quotes:'

/** How long after the last change the storage is written, in ms. */
export const WRITE_DELAY_MS = 300

/** The sent quotes kept per Session. */
export const SENT_KEPT = 500

/** The Sessions of one Node whose comments are kept: the ones changed last. */
export const SESSIONS_KEPT = 3

/** The key of a Session's comments: `<Project>/<Node>/<SDK session id>`. */
export function quoteKey(projectId: string, nodeId: string, sessionId: string): string {
  return `${projectId}/${nodeId}/${sessionId}`
}

const imageSchema = z.object({ kind: z.literal('image'), name: z.string(), mediaType: imageMediaTypeSchema, size: z.number(), ref: z.string().regex(/^[0-9a-f]{64}$/) })
const rangeFields = { id: z.string(), anchor: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), quote: z.string(), text: z.string() }
const commentSchema = z.object({ ...rangeFields, images: z.array(imageSchema), messageAt: z.number().nullable(), at: z.number() })
const pendingSchema = z.object({ id: z.string(), message: z.string(), at: z.number(), comments: z.array(commentSchema) })
const roundSchema = z.object({ id: z.string(), message: z.string(), at: z.number() })
const sentSchema = z.object({ ...rangeFields, round: z.string(), images: z.number().int().nonnegative(), number: z.number().int().positive() })
const entrySchema = z.object({ v: z.literal(2), at: z.number(), drafts: z.array(commentSchema), pending: z.array(pendingSchema), rounds: z.array(roundSchema), sent: z.array(sentSchema) })

/** The comments of one Session. */
export interface QuoteState {
  drafts: readonly QuoteComment[]
  pending: readonly PendingRound[]
  rounds: readonly SentRound[]
  sent: readonly SentQuote[]
  /** When it last changed, ms: which Sessions of a Node are kept. */
  at: number
}

export const EMPTY_QUOTES: QuoteState = { drafts: [], pending: [], rounds: [], sent: [], at: 0 }

const isEmpty = (state: QuoteState): boolean => state.drafts.length === 0 && state.pending.length === 0 && state.sent.length === 0

let entries: Map<string, QuoteState> | null = null
const pending = new Set<string>()
const listeners = new Set<() => void>()
const errorListeners = new Set<(error: unknown) => void>()
const imageData = new Map<string, string>()
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
        if (parsed.success) entries.set(name.slice(PREFIX.length), parsed.data)
      } catch {
        // Not JSON: no comments.
      }
    }
  } catch {
    // An unreadable storage holds no comments.
  }
  return entries
}

const tell = (): void => {
  for (const listener of [...listeners]) listener()
}

function store(key: string): void {
  pending.delete(key)
  const state = known().get(key)
  try {
    if (state === undefined || isEmpty(state)) globalThis.localStorage.removeItem(PREFIX + key)
    else globalThis.localStorage.setItem(PREFIX + key, JSON.stringify({ v: 2, ...state }))
  } catch (error) {
    console.error('[quotes] could not keep the comments of a Session', error)
    for (const listener of [...errorListeners]) listener(error)
  }
}

/** Hears every write the storage refused; answers the call that stops it. */
export function onQuoteStoreError(listener: (error: unknown) => void): () => void {
  errorListeners.add(listener)
  return () => errorListeners.delete(listener)
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

/** The Node part of a key: `<Project>/<Node>/`. */
const nodeOf = (key: string): string => key.slice(0, key.lastIndexOf('/') + 1)

/** Changes a Session's comments: in memory now, in the storage after WRITE_DELAY_MS. */
export function changeQuotes(key: string, change: (state: QuoteState) => QuoteState, now = Date.now()): void {
  const map = known()
  const next = change(map.get(key) ?? EMPTY_QUOTES)
  const sent = next.sent.length > SENT_KEPT ? next.sent.slice(-SENT_KEPT) : next.sent
  const used = new Set(sent.map((each) => each.round))
  const kept: QuoteState = { ...next, sent, rounds: next.rounds.filter((each) => used.has(each.id)), at: Math.max(now, next.at) }
  if (isEmpty(kept)) map.delete(key)
  else map.set(key, kept)
  pending.add(key)
  // The Sessions of this Node past SESSIONS_KEPT, the ones changed longest ago, go.
  const node = nodeOf(key)
  const siblings = [...map.entries()].filter(([name]) => nodeOf(name) === node).sort(([, a], [, b]) => b.at - a.at)
  for (const [name] of siblings.slice(SESSIONS_KEPT)) {
    map.delete(name)
    pending.add(name)
  }
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flushQuotes, WRITE_DELAY_MS)
  tell()
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

/** The comments went in a message with the text `message`: they leave the tray and wait for its prompt. */
export function markPending(key: string, round: PendingRound): void {
  const ids = new Set(round.comments.map((each) => each.id))
  changeQuotes(key, (state) => ({ ...state, drafts: state.drafts.filter((each) => !ids.has(each.id)), pending: [...state.pending.filter((each) => each.id !== round.id), round] }))
}

/**
 * A waiting round is settled: `sent` — its prompt came: its comments stay as sent quotes, numbered in
 * its order, its text kept once; `back` — its message left the queue unsent: its comments go back to
 * the tray as they were.
 */
export function settlePending(key: string, id: string, how: 'sent' | 'back'): PendingRound | null {
  const round = readQuotes(key).pending.find((each) => each.id === id)
  if (round === undefined) return null
  changeQuotes(key, (state) => {
    const rest = state.pending.filter((each) => each.id !== id)
    if (how === 'back') return { ...state, pending: rest, drafts: [...state.drafts, ...round.comments] }
    return {
      ...state,
      pending: rest,
      rounds: [...state.rounds, { id: round.id, message: round.message, at: round.at }],
      sent: [
        ...state.sent,
        ...round.comments.map((each, index): SentQuote => ({ id: each.id, round: round.id, anchor: each.anchor, start: each.start, end: each.end, quote: each.quote, text: each.text, images: each.images.length, number: index + 1 })),
      ],
    }
  })
  return round
}

/** Keeps the bytes of a kept image in this window's memory, by its ref (never in the storage). */
export function keepImageData(ref: string, data: string): void {
  imageData.set(ref, data)
}

/** The bytes of a kept image this window read; undefined when it has to be read back from main. */
export function imageDataOf(ref: string): string | undefined {
  return imageData.get(ref)
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
      tell()
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
  imageData.clear()
}

// A quit or a reload goes before the timer fires: the comments are written as the page goes.
globalThis.addEventListener?.('pagehide', flushQuotes)
globalThis.addEventListener?.('beforeunload', flushQuotes)
