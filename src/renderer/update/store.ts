// The Update snapshot in the window (worfy-update ticket 01): main's `update.state`, then every
// `update.changed`. The version chip, the toasts, Settings and Health of tickets 06–09 draw it; main
// owns the state (src/main/ipc/update.ts), the window only shows it and asks for a check.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { RestartAnswer, UpdateBuildStep, UpdateSnapshot } from '../../shared/ipc/update'
import { numberedBuilds, versionLabel } from '../../shared/version-number'
import { invoke, subscribe } from '../ipc'
import { showToast } from '../toast/toasts'

export interface UpdateStore {
  /** Main's snapshot; null until it has answered once. */
  snapshot: UpdateSnapshot | null
  /**
   * "Update worfy" was pressed in this window and main has not answered yet, nor sent a change
   * (ticket 16): the chip and Settings say "Starting update…" at once.
   */
  starting: boolean
}

export const useUpdateStore = create<UpdateStore>(() => ({ snapshot: null, starting: false }))

/** Counts the snapshots taken: the answer to the first read loses to an event that came before it. */
let accepted = 0

function accept(snapshot: UpdateSnapshot): void {
  accepted += 1
  useUpdateStore.setState({ snapshot, starting: false })
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

/**
 * `version` as the Update texts name it (ticket 14): `<major>.<minor>.<N>` when the snapshot knows its
 * build number (this run's is `current`), else the build version.
 */
export function updateVersionLabel(snapshot: UpdateSnapshot | null, version: string): string {
  return snapshot === null ? version : versionLabel(version, numberedBuilds(snapshot))
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

/**
 * Builds the Available update (`update.install`) and takes the snapshot with the build begun; the
 * reason when main refused. Until main answers the window is `starting` (ticket 16). `call`: the
 * toasts of update/toasts.ts pass the one they were given.
 */
export async function installUpdate(call: typeof invoke = invoke): Promise<string | undefined> {
  useUpdateStore.setState({ starting: true })
  const result = await call('update.install')
  if (!result.ok) {
    useUpdateStore.setState({ starting: false })
    return failureReason('update.install', result.error)
  }
  accept(result.value)
  return undefined
}

/** The toast of a refused "Update worfy" (ticket 16). */
export const INSTALL_REFUSED_KEY = 'update-install-refused'

/**
 * Tells a refused "Update worfy" in a toast, with "Show log" when a build left a log (one that runs,
 * failed or is ready); the chip, the Command palette and the toast "Update" use it (ticket 16).
 */
export function tellInstallRefusal(reason: string, snapshot: UpdateSnapshot | null, call: typeof invoke = invoke): void {
  const text = `The update did not start: ${reason}`
  const build = snapshot?.build
  const logged = build !== undefined && (build.log !== undefined || build.phase === 'building')
  if (!logged) {
    showToast({ kind: 'error', key: INSTALL_REFUSED_KEY, testId: INSTALL_REFUSED_KEY, text })
    return
  }
  const showLog = (): void => {
    void call('update.showLog').then((result) => {
      if (!result.ok) showToast({ kind: 'error', key: INSTALL_REFUSED_KEY, testId: INSTALL_REFUSED_KEY, text: failureReason('update.showLog', result.error) })
    })
  }
  showToast({ kind: 'action', key: INSTALL_REFUSED_KEY, testId: INSTALL_REFUSED_KEY, text, actions: [{ label: 'Show log', run: showLog }] })
}

/**
 * "Update worfy" of the chip and of the Command palette: builds, and tells a refusal in a toast.
 * `seen`: the snapshot the caller drew, for a window whose store has none yet.
 */
export async function installUpdateTelling(seen: UpdateSnapshot | null = null): Promise<undefined> {
  const reason = await installUpdate()
  if (reason !== undefined) tellInstallRefusal(reason, useUpdateStore.getState().snapshot ?? seen)
  return undefined
}

// What a window shows while an Update builds (ticket 16).

/** The words of each step of a build. */
export const BUILD_STEP_TEXT: Record<UpdateBuildStep, string> = {
  fetch: 'Fetching source',
  install: 'Installing dependencies',
  electron: 'Downloading Electron',
  package: 'Building app',
}

/** The place of each step: `package` is the last, 3 or 4 as the build counts. */
const STEP_PLACE: Record<Exclude<UpdateBuildStep, 'package'>, number> = { fetch: 1, install: 2, electron: 3 }

/** The step a build runs as "2/3 Installing dependencies", or undefined while it has none (before its first spawn). */
export function buildStepText(build: UpdateSnapshot['build']): string | undefined {
  if (build.phase !== 'building' || build.step === undefined) return undefined
  const count = build.steps ?? (build.step === 'electron' ? 4 : 3)
  const place = build.step === 'package' ? count : STEP_PLACE[build.step]
  return `${place}/${count} ${BUILD_STEP_TEXT[build.step]}`
}

/** The time from `since` to `now` as m:ss, or h:mm:ss from an hour on. */
export function elapsedText(since: string, now: number): string {
  const total = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** `now()`, read again at each render; while `on`, the component renders each second. */
export function useTicking(on: boolean, now: () => number): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!on) return undefined
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now()
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
