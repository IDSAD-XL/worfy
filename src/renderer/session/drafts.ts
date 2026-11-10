import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { isArchived, type Layout } from '../../shared/layout/types'

// The draft of a chat input field (worfy-polish ticket 95): the text typed and not sent yet. It stays
// when the field goes away — another Session picked in the Session view, another Project, a restart
// of worfy — and is there again when the field comes back.
//
// - One draft per field: the Session view's field of a Node (`chat`: every Session, Claude Code and
//   Codex alike, the Orchestrator and a Product Session — MessageInput.tsx) and the field of a Session
//   Node on the Canvas (`node`: canvas/nodes/SessionNode.tsx) each keep their own. The Node, not the
//   Session, is the key: the Session view's field is made again per Node (SessionView.tsx), and a
//   Node keeps its field whichever Session runs on it.
// - Kept like the other choices of a Session's view (transcript-view.ts): in this window's
//   localStorage, which lives in userData — worfy's data folder (ADR-0005) — so it survives a restart.
//   The copy in memory changes at once; the storage is written DRAFT_DELAY_MS after the last change,
//   and at once when the page goes (a quit, a reload). A draft past DRAFT_LIMIT characters is cut to
//   it in the storage; the window that has it keeps it whole while it is open.
// - Sending clears the draft at once (clearDraft). A Node that leaves the Layout (Delete, to the
//   trash) or that the archive takes (`archived`) takes its drafts along (dropGoneDrafts, called by
//   canvas/useLayout.ts for every Layout it takes).
// - A storage that cannot be read reads as no draft; a draft that cannot be written holds in this
//   window alone, for as long as it is open. Another window sees a draft the next time its field opens.

const PREFIX = 'worfy.draft:'

/** The most characters a draft keeps in the storage (about 100 kB of text). */
export const DRAFT_LIMIT = 100_000

/** How long after the last change the storage is written, in ms. */
export const DRAFT_DELAY_MS = 300

/** Which field of a Node the draft is of: the Session view's (`chat`) or the Session Node's on the Canvas (`node`). */
export type DraftField = 'chat' | 'node'

const FIELDS: readonly DraftField[] = ['chat', 'node']

/** The key of a field's draft: `<field>:<Project>/<Node>`. */
export function draftKey(field: DraftField, projectId: string, nodeId: string): string {
  return `${field}:${projectId}/${nodeId}`
}

/** Every draft known to this window, by key; read from the storage once, at first use. */
let drafts: Map<string, string> | null = null
/** The keys whose storage is behind their draft in memory. */
const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function known(): Map<string, string> {
  if (drafts !== null) return drafts
  drafts = new Map()
  try {
    const storage = globalThis.localStorage
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index)
      if (!name?.startsWith(PREFIX)) continue
      const text = storage.getItem(name)
      if (text !== null && text !== '') drafts.set(name.slice(PREFIX.length), text)
    }
  } catch {
    // An unreadable storage holds no draft.
  }
  return drafts
}

/** Writes one key's draft as memory has it now: the text cut to DRAFT_LIMIT, or no entry for an empty one. */
function store(key: string): void {
  pending.delete(key)
  const text = known().get(key) ?? ''
  try {
    if (text === '') globalThis.localStorage.removeItem(PREFIX + key)
    else globalThis.localStorage.setItem(PREFIX + key, text.slice(0, DRAFT_LIMIT))
  } catch (error) {
    console.error('[drafts] could not keep the draft of a message', error)
  }
}

/** Writes every draft that changed since its last write, now. */
export function flushDrafts(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  for (const key of [...pending]) store(key)
}

/** The draft of a field; empty when there is none. */
export function readDraft(key: string): string {
  return known().get(key) ?? ''
}

/** Keeps a field's text as its draft: in memory now, in the storage after DRAFT_DELAY_MS. */
export function keepDraft(key: string, text: string): void {
  const map = known()
  if ((map.get(key) ?? '') === text) return
  if (text === '') map.delete(key)
  else map.set(key, text)
  pending.add(key)
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flushDrafts, DRAFT_DELAY_MS)
}

/** Forgets a field's draft, in memory and in the storage, now: the message was sent. */
export function clearDraft(key: string): void {
  known().delete(key)
  store(key)
}

/**
 * Drops the drafts of the Nodes of `projectId` that `after` no longer shows: archived in it, or in
 * `before` and gone from it (deleted). A Node absent from both is left alone: it may be one this
 * window has not seen in a Layout yet.
 */
export function dropGoneDrafts(projectId: string, before: Layout | undefined, after: Layout): void {
  const map = known()
  if (map.size === 0) return
  const now = new Map(after.nodes.map((node) => [node.id, node]))
  const had = new Set(before?.nodes.map((node) => node.id) ?? [])
  const prefixes = FIELDS.map((field) => draftKey(field, projectId, ''))
  for (const key of [...map.keys()]) {
    const prefix = prefixes.find((each) => key.startsWith(each))
    if (prefix === undefined) continue
    const nodeId = key.slice(prefix.length)
    const node = now.get(nodeId)
    if (node === undefined ? had.has(nodeId) : isArchived(node)) clearDraft(key)
  }
}

/**
 * A field's text kept as its draft under `key` (none: a plain state). Opens with the draft there is,
 * and keeps every change. A new key shows its own draft.
 */
export function useDraft(key: string | undefined): [string, Dispatch<SetStateAction<string>>] {
  const [state, setState] = useState(() => ({ key, text: key === undefined ? '' : readDraft(key) }))
  let current = state
  if (state.key !== key) {
    current = { key, text: key === undefined ? '' : readDraft(key) }
    setState(current)
  }
  const setText = useCallback((next: SetStateAction<string>) => setState((was) => ({ key: was.key, text: typeof next === 'function' ? next(was.text) : next })), [])
  const { text } = current
  useEffect(() => {
    if (key !== undefined) keepDraft(key, text)
  }, [key, text])
  return [text, setText]
}

// A quit or a reload goes before the timer fires: the drafts are written as the page goes.
globalThis.addEventListener?.('pagehide', flushDrafts)
globalThis.addEventListener?.('beforeunload', flushDrafts)
