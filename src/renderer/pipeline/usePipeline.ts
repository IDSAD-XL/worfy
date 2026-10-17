// The renderer's copy of each Project's Pipeline and the Stages of its Tickets, computed in main
// (src/main/workflow/stages.ts, ADR-0067). Several views read one Project — the Pipeline board, the
// sidebar section, the stepper on a Ticket's Card — so the copy is shared: the first user asks main
// (`pipeline.get`), which from then on sends `pipeline.changed` with the whole snapshot; the last
// one to leave closes it (`pipeline.close`).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { PipelineSnapshot, PipelineTicket } from '../../shared/ipc/pipeline'
import { invoke, subscribe } from '../ipc'

export interface PipelineEntry {
  /** Undefined until main has answered `pipeline.get`. */
  snapshot: PipelineSnapshot | undefined
  /** Why `pipeline.get` failed. */
  error: string | undefined
}

const usePipelineStore = create<{ byRoot: Readonly<Record<string, PipelineEntry>> }>(() => ({ byRoot: {} }))

const EMPTY: PipelineEntry = { snapshot: undefined, error: undefined }

function setEntry(root: string, entry: PipelineEntry): void {
  usePipelineStore.setState(({ byRoot }) => ({ byRoot: { ...byRoot, [root]: entry } }))
}

let subscribed = false
const users = new Map<string, number>()
/** A snapshot that came while `pipeline.get` was on its way: newer than the answer, so it wins. */
const early = new Map<string, PipelineSnapshot>()

function onChanged(snapshot: PipelineSnapshot): void {
  if (!users.has(snapshot.root)) return
  if (!usePipelineStore.getState().byRoot[snapshot.root]?.snapshot) {
    early.set(snapshot.root, snapshot)
    return
  }
  setEntry(snapshot.root, { snapshot, error: undefined })
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  try {
    subscribe('pipeline.changed', onChanged)
  } catch (error) {
    console.error('pipeline.changed: cannot subscribe', error)
  }
}

function acquire(root: string): void {
  ensureSubscribed()
  const count = users.get(root) ?? 0
  users.set(root, count + 1)
  if (count > 0) return
  void invoke('pipeline.get', { root }).then((result) => {
    // Everyone left while main was computing; the close below already went out.
    if (!users.has(root)) return
    const newer = early.get(root)
    early.delete(root)
    if (result.ok) setEntry(root, { snapshot: newer ?? result.value, error: undefined })
    else {
      console.error(`pipeline.get ${root} failed:`, result.error)
      setEntry(root, { snapshot: undefined, error: result.error })
    }
  })
}

function release(root: string): void {
  const count = users.get(root) ?? 0
  if (count > 1) {
    users.set(root, count - 1)
    return
  }
  users.delete(root)
  early.delete(root)
  usePipelineStore.setState(({ byRoot }) => {
    const rest = { ...byRoot }
    delete rest[root]
    return { byRoot: rest }
  })
  void invoke('pipeline.close', { root })
}

/** The Pipeline and Stages of the Project at `root`, kept current while the calling component is mounted. */
export function usePipeline(root: string | undefined): PipelineEntry {
  useEffect(() => {
    if (root === undefined) return
    acquire(root)
    return () => release(root)
  }, [root])
  return usePipelineStore((store) => (root === undefined ? EMPTY : (store.byRoot[root] ?? EMPTY)))
}

/** The Stage of one Ticket in a snapshot; null when the snapshot does not name it. */
export function stageOfTicket(snapshot: PipelineSnapshot | undefined, ticket: { epic: string; num: number }): PipelineTicket | null {
  return snapshot?.tickets.find((each) => each.epic === ticket.epic && each.num === ticket.num) ?? null
}
