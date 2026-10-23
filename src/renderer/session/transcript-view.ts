import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

// Where the choice of the Session view's «Hide tools» button (HideToolsButton.tsx, worfy-ui ticket
// 25) is kept: per Session, in this window's localStorage. It is how this screen shows a transcript,
// not a setting of the agent: Claude Code never reads it (the agent's own picks are
// session-settings.json, useSessionControls), and it is not one for the whole Machine
// (app-settings.json) nor for every screen of the Project (the Layout, which a read-only screen
// cannot write). localStorage lives in
// userData, which main sets to worfy's data folder (src/main/index.ts), so it stays within ADR-0005,
// survives a restart and is shared by every window of worfy on this Machine.
//
// A Session is keyed by its SDK session id: one Session keeps one choice wherever it is opened — live
// on its Node, read-only, from the Command palette — and a new conversation on the same Node starts
// with tools shown. Only while no id is known yet (a Node whose Session has not started) the key is
// the Node; the choice moves to the Session's key once its id appears (useSessionToolsHidden). A
// Session that main renames (src/main/agent/session.ts: a process that died before its first turn,
// or a resume that Claude Code answered with another id) keeps its choice under the new id
// (toolsHiddenRenamed, called by store.ts on the `renamed` event). A Subagent is keyed under its
// Session by its agent id. Only "hidden" is written; "shown"
// is the key's absence. A storage that cannot be read reads as "shown"; a choice
// that cannot be written holds in this window alone, for as long as it is open.

const PREFIX = 'worfy.transcript.hideTools:'

/**
 * The key of a Session's choice: `session:<SDK session id>`, a Subagent's with `/<agent id>` after
 * it; `node:<Project>/<Node>` while the Session's id is not known yet.
 */
export function hideToolsKey(where: { projectId: string; nodeId: string; sessionId: string | null; agentId?: string | undefined }): string {
  const session = where.sessionId === null ? `node:${where.projectId}/${where.nodeId}` : `session:${where.sessionId}`
  return where.agentId === undefined ? session : `${session}/${where.agentId}`
}

/** Choices this window could not write: they stand over the storage, so the view still switches. */
const unsaved = new Map<string, boolean>()
const listeners = new Set<() => void>()

function readStored(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) === '1'
  } catch {
    return false
  }
}

function toolsHidden(key: string): boolean {
  return unsaved.get(key) ?? readStored(key)
}

/** Keeps a choice without telling the views: the callers tell them once they are done. */
function write(key: string, hidden: boolean): void {
  try {
    if (hidden) globalThis.localStorage.setItem(PREFIX + key, '1')
    else globalThis.localStorage.removeItem(PREFIX + key)
    unsaved.delete(key)
  } catch (error) {
    unsaved.set(key, hidden)
    console.error('[transcript-view] could not keep the «Hide tools» choice', error)
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

function setToolsHidden(key: string, hidden: boolean): void {
  write(key, hidden)
  notify()
}

/** The keys of `key` and of its Subagents (`<key>/<agent id>`) that hold "hidden". */
function hiddenUnder(key: string): string[] {
  const found = new Set<string>()
  try {
    const storage = globalThis.localStorage
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index)
      if (name?.startsWith(PREFIX) && storage.getItem(name) === '1') found.add(name.slice(PREFIX.length))
    }
  } catch {
    // An unreadable storage holds no choice to move.
  }
  for (const [name, hidden] of unsaved) {
    if (hidden) found.add(name)
    else found.delete(name)
  }
  return [...found].filter((name) => name === key || name.startsWith(`${key}/`))
}

/**
 * Moves the choice of `from` and of its Subagents to `to`: "hidden" goes over, and `from` is
 * cleared. A choice `to` already has is kept.
 */
export function moveToolsHidden(from: string, to: string): void {
  if (from === to) return
  const moved = hiddenUnder(from)
  if (moved.length === 0) return
  for (const name of moved) {
    write(`${to}${name.slice(from.length)}`, true)
    write(name, false)
  }
  notify()
}

/** The key each live Session's view used, by the live id: a rename names the old live id. */
const liveKeys = new Map<string, string>()

/**
 * main renamed a live Session `from` → `to` (the `renamed` event): its choice goes to the new id.
 * The view keyed it by the id it knew then — for a resumed Session the id it resumes, not the
 * temporary `pending-…` one — so the key is the one the view noted for `from`.
 */
export function toolsHiddenRenamed(from: string, to: string): void {
  const before = liveKeys.get(from) ?? `session:${from}`
  liveKeys.delete(from)
  moveToolsHidden(before, `session:${to}`)
}

/** Another window of worfy changed a choice: what it wrote replaces this window's. */
function onStorage(event: StorageEvent): void {
  if (event.key === null) unsaved.clear()
  else if (event.key.startsWith(PREFIX)) unsaved.delete(event.key.slice(PREFIX.length))
  else return
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) globalThis.addEventListener?.('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage)
  }
}

/** Whether the Session of `key` shows its tool calls folded, and the setter of that choice. */
export function useToolsHidden(key: string): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(
    subscribe,
    () => toolsHidden(key),
    () => false,
  )
  const set = useCallback((value: boolean) => setToolsHidden(key, value), [key])
  return [hidden, set]
}

/**
 * The choice of a live Session's view (SessionView.tsx), keyed as hideToolsKey keys it. `liveId` is
 * the id the `agent.*` channels know it by (temporary for a resumed Session until system/init);
 * `sessionId` its SDK session id, null while unknown. A choice made while the Node stood in for the
 * Session moves to the Session's key once its id is known.
 */
export function useSessionToolsHidden(where: { projectId: string; nodeId: string; liveId: string | null; sessionId: string | null }): [boolean, (hidden: boolean) => void] {
  const { projectId, nodeId, liveId, sessionId } = where
  const key = hideToolsKey({ projectId, nodeId, sessionId })
  const previous = useRef(key)
  useLayoutEffect(() => {
    if (liveId !== null) liveKeys.set(liveId, key)
    const before = previous.current
    previous.current = key
    if (sessionId !== null && before === hideToolsKey({ projectId, nodeId, sessionId: null })) moveToolsHidden(before, key)
  }, [key, liveId, projectId, nodeId, sessionId])
  return useToolsHidden(key)
}
