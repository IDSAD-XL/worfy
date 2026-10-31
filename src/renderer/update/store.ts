// The Update snapshot in the window (worfy-update ticket 01): main's `update.state`, then every
// `update.changed`. The version chip, the toasts, Settings and Health of tickets 06–09 draw it; main
// owns the state (src/main/ipc/update.ts), the window only shows it and asks for a check.
import { useEffect } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { invoke, subscribe } from '../ipc'

export interface UpdateStore {
  /** Main's snapshot; null until it has answered once. */
  snapshot: UpdateSnapshot | null
}

export const useUpdateStore = create<UpdateStore>(() => ({ snapshot: null }))

/** Counts the snapshots taken: the answer to the first read loses to an event that came before it. */
let accepted = 0

function accept(snapshot: UpdateSnapshot): void {
  accepted += 1
  useUpdateStore.setState({ snapshot })
}

let started = false

/** Subscribes to the changes and reads the snapshot, once per window load. */
function start(): void {
  if (started) return
  started = true
  try {
    subscribe('update.changed', accept)
  } catch (error) {
    console.error('update.changed: cannot subscribe', error)
  }
  const before = accepted
  void invoke('update.state').then((result) => {
    if (!result.ok) console.error('update.state failed:', result.error)
    else if (accepted === before) accept(result.value)
  })
}

/** Starts the reading outside React: the Update toasts of the start (ticket 07, update/toasts.ts). */
export const followUpdate = start

/** Main's Update snapshot; null until it has answered. The first call starts the reading. */
export function useUpdate(): UpdateSnapshot | null {
  useEffect(start, [])
  return useUpdateStore((store) => store.snapshot)
}

/** "Check now": checks and takes the snapshot after it; answers the reason when main refuses. */
export async function checkForUpdateNow(): Promise<string | undefined> {
  start()
  const result = await invoke('update.check')
  if (!result.ok) return failureReason('update.check', result.error)
  accept(result.value)
  return undefined
}
