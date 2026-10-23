import { useCallback, useSyncExternalStore } from 'react'

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
// the Node. A Subagent is keyed under its Session by its agent id. Only "hidden" is written; "shown"
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

function setToolsHidden(key: string, hidden: boolean): void {
  try {
    if (hidden) globalThis.localStorage.setItem(PREFIX + key, '1')
    else globalThis.localStorage.removeItem(PREFIX + key)
    unsaved.delete(key)
  } catch (error) {
    unsaved.set(key, hidden)
    console.error('[transcript-view] could not keep the «Hide tools» choice', error)
  }
  for (const listener of listeners) listener()
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
