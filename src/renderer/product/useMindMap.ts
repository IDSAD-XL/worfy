// The renderer's copy of the Product Session topics on screen (ADR-0101; Epic worfy-product-session,
// ticket 05): the wayfinder map, its Tickets and the Mind map of one topic, kept current without a
// reload. The topic is read once through `product.topic`; after that every `product.changed` of it
// replaces it, whoever changed its files — a tool, an agent or a hand edit.
//
// `product.changed` comes with the Project's documents: main sends it to the windows that have them
// open (`docs.open`), so the hook holds them open through useDocs, and reads the topic only once main
// has answered `docs.open`: then the Project's watcher runs and knows the topic from that read on.
// The copy is shared by the views of one topic: the first one reads it, the last one to leave drops it.
//
// Main reads one topic at a time and answers `product.topic` in turn with the reads behind
// `product.changed` (src/main/docs/watch.ts), so whichever of the two arrives last is the newest.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ProductTopicChange, ProductTopicState } from '../../shared/ipc/product'
import { useDocs } from '../docs/useDocs'
import { invoke, showSubscribeError, subscribe } from '../ipc'

export interface MindMapEntry {
  /** Undefined until main has answered; null when the topic's folder is not there. */
  topic: ProductTopicState | null | undefined
  /** Why `product.topic` failed. */
  error: string | undefined
}

const EMPTY: MindMapEntry = { topic: undefined, error: undefined }

const useMindMapStore = create<{ byKey: Readonly<Record<string, MindMapEntry>> }>(() => ({ byKey: {} }))

const keyOf = (projectId: string, name: string): string => `${projectId}\n${name}`

function setEntry(key: string, entry: MindMapEntry): void {
  useMindMapStore.setState(({ byKey }) => ({ byKey: { ...byKey, [key]: entry } }))
}

let subscribed = false
const users = new Map<string, number>()

function onChanged({ projectId, name, topic }: ProductTopicChange): void {
  const key = keyOf(projectId, name)
  if (users.has(key)) setEntry(key, { topic, error: undefined })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('product.changed', onChanged)
  } catch (error) {
    showSubscribeError('product.changed', error)
  }
}

function acquire(projectId: string, name: string): void {
  ensureSubscribed()
  const key = keyOf(projectId, name)
  const count = users.get(key) ?? 0
  users.set(key, count + 1)
  if (count > 0) return
  void invoke('product.topic', { projectId, name }).then((result) => {
    // Everyone left while main was reading.
    if (!users.has(key)) return
    if (result.ok) setEntry(key, { topic: result.value.topic, error: undefined })
    else {
      console.error(`product.topic ${projectId} ${name} failed:`, result.error)
      setEntry(key, { topic: undefined, error: result.error })
    }
  })
}

function release(projectId: string, name: string): void {
  const key = keyOf(projectId, name)
  const count = users.get(key) ?? 0
  if (count > 1) {
    users.set(key, count - 1)
    return
  }
  users.delete(key)
  useMindMapStore.setState(({ byKey }) => {
    const rest = { ...byKey }
    delete rest[key]
    return { byKey: rest }
  })
}

/** The Product Session topic `name` of the Project, kept current while the calling component is mounted. */
export function useMindMap(projectId: string | undefined, name: string | undefined): MindMapEntry {
  const docs = useDocs(projectId)
  // A failed `docs.open` still reads the topic once: main reads it then without the watcher.
  const open = docs.state !== undefined || docs.error !== undefined
  useEffect(() => {
    if (projectId === undefined || name === undefined || !open) return
    acquire(projectId, name)
    return () => release(projectId, name)
  }, [projectId, name, open])
  return useMindMapStore((store) => (projectId === undefined || name === undefined ? EMPTY : (store.byKey[keyOf(projectId, name)] ?? EMPTY)))
}
