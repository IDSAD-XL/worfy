// The renderer's copy of each Project's documents: whether HANDOFF.md exists and the list of its
// ADRs, each with a version that changes with the file (src/shared/ipc/docs.ts). Several views
// read one Project — the HANDOFF Node, the sidebar's ADR section — so the copy is shared: the
// first user opens the Project in main (`docs.open`), the last one to leave closes it
// (`docs.close`), and every `docs.changed` replaces the state once. Texts are read on demand
// through `docs.read` (useDocText), again whenever the file's version changes.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { DocsState } from '../../shared/ipc/docs'
import { invoke, subscribe } from '../ipc'

export interface DocsEntry {
  /** Undefined until main has answered `docs.open`. */
  state: DocsState | undefined
  /** Why `docs.open` failed. */
  error: string | undefined
}

const useDocsStore = create<{ byProject: Readonly<Record<string, DocsEntry>> }>(() => ({ byProject: {} }))

const EMPTY: DocsEntry = { state: undefined, error: undefined }

function setEntry(projectId: string, entry: DocsEntry): void {
  useDocsStore.setState(({ byProject }) => ({ byProject: { ...byProject, [projectId]: entry } }))
}

let subscribed = false
const users = new Map<string, number>()

function onChanged(state: DocsState): void {
  // Until `docs.open` has answered, its answer is the newest state: main computes it after any
  // change it reported before.
  if (!users.has(state.projectId) || useDocsStore.getState().byProject[state.projectId]?.state === undefined) return
  setEntry(state.projectId, { state, error: undefined })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('docs.changed', onChanged)
  } catch (error) {
    console.error('docs.changed: cannot subscribe', error)
  }
}

function acquire(projectId: string): void {
  ensureSubscribed()
  const count = users.get(projectId) ?? 0
  users.set(projectId, count + 1)
  if (count > 0) return
  void invoke('docs.open', { projectId }).then((result) => {
    // Everyone left while main was reading; the close below already went out.
    if (!users.has(projectId)) return
    if (result.ok) setEntry(projectId, { state: result.value, error: undefined })
    else {
      console.error(`docs.open ${projectId} failed:`, result.error)
      setEntry(projectId, { state: undefined, error: result.error })
    }
  })
}

function release(projectId: string): void {
  const count = users.get(projectId) ?? 0
  if (count > 1) {
    users.set(projectId, count - 1)
    return
  }
  users.delete(projectId)
  useDocsStore.setState(({ byProject }) => {
    const rest = { ...byProject }
    delete rest[projectId]
    return { byProject: rest }
  })
  void invoke('docs.close', { projectId })
}

/** HANDOFF.md and the ADRs of the Project, kept current while the calling component is mounted. */
export function useDocs(projectId: string | undefined): DocsEntry {
  useEffect(() => {
    if (projectId === undefined) return
    acquire(projectId)
    return () => release(projectId)
  }, [projectId])
  return useDocsStore((store) => (projectId === undefined ? EMPTY : (store.byProject[projectId] ?? EMPTY)))
}

export interface DocText {
  text: string | undefined
  error: string | undefined
}

/**
 * The text of one document of the Project, read again whenever `version` changes. Nothing is read
 * while any argument is missing. A new version keeps the old text on screen until the new one is in.
 */
export function useDocText(projectId: string | undefined, path: string | undefined, version: string | undefined): DocText {
  const [doc, setDoc] = useState<DocText & { key: string | undefined }>({ key: undefined, text: undefined, error: undefined })
  const key = projectId !== undefined && path !== undefined ? `${projectId}\n${path}` : undefined
  useEffect(() => {
    if (projectId === undefined || path === undefined || version === undefined) return
    let live = true
    void invoke('docs.read', { projectId, path }).then((result) => {
      if (!live) return
      const docKey = `${projectId}\n${path}`
      if (result.ok) setDoc({ key: docKey, text: result.value.text, error: undefined })
      else setDoc({ key: docKey, text: undefined, error: result.error })
    })
    return () => {
      live = false
    }
  }, [projectId, path, version])
  // Another document's text is never shown, not even for the moment before this one is read.
  return doc.key === key && key !== undefined ? { text: doc.text, error: doc.error } : { text: undefined, error: undefined }
}
