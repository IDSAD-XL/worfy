// The Update snapshot in the window (worfy-update ticket 01): main's `update.state`, then every
// `update.changed`. The version chip, the toasts, Settings and Health of tickets 06–09 draw it; main
// owns the state (src/main/ipc/update.ts), the window only shows it and asks for a check.
import { useEffect } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { RestartAnswer, UpdateSnapshot } from '../../shared/ipc/update'
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

// The presses of Settings → General → Updates and of the Command palette's "Update worfy" (ticket 09).

/** What a press of an Update button can do now. */
export type UpdateStep = { kind: 'check' } | { kind: 'install'; version: string; building: boolean } | { kind: 'restart'; version: string; when: 'now' | 'idle' }

/**
 * The step "Update worfy" stands for in this snapshot: restart into a built Update, build the
 * Available update, or check. The commit rolled back from (`quiet`) is no Available update until
 * the next one (spec R8).
 */
export function updateStep(snapshot: UpdateSnapshot): UpdateStep {
  const { build, available } = snapshot
  if (build.phase === 'ready' && build.version !== undefined) return { kind: 'restart', version: build.version, when: snapshot.idle ? 'now' : 'idle' }
  if (available !== null && !available.quiet) return { kind: 'install', version: available.version, building: build.phase === 'building' }
  return { kind: 'check' }
}

/** Builds the Available update (`update.install`) and takes the snapshot with the build begun; the reason when main refused. */
export async function installUpdate(): Promise<string | undefined> {
  const result = await invoke('update.install')
  if (!result.ok) return failureReason('update.install', result.error)
  accept(result.value)
  return undefined
}

/** The reason of a refusal; nothing for an answer that worked or was cancelled. */
function refusalOf(answer: RestartAnswer): string | undefined {
  return answer.outcome === 'refused' ? answer.reason : undefined
}

/** "Restart now" or "Restart when idle" (`update.restart`); the reason when main refused. */
export async function restartIntoUpdate(when: 'now' | 'idle'): Promise<string | undefined> {
  const result = await invoke('update.restart', { when })
  return result.ok ? refusalOf(result.value) : failureReason('update.restart', result.error)
}

/** "Roll back to previous version": main asks the native dialog first; `cancelled` is no problem. */
export async function rollBackUpdate(): Promise<string | undefined> {
  const result = await invoke('update.rollback')
  return result.ok ? refusalOf(result.value) : failureReason('update.rollback', result.error)
}
