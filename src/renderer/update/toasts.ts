// The sticky toasts of Update (worfy-update ticket 07; the epic's spec, owner's points 5, 7 and 8,
// R11 and R12, texts from "Toasts"). They draw main's Update snapshot (update/store.ts) and the
// Harness status (`harness.state`, `harness.changed`) through the toast store (toast/toasts.ts):
//
// - a built Update: "worfy <version> ready" with "Restart now" while nothing works, else "Restart
//   when idle", and "Later"; the button changes in place (the same key) when `idle` changes;
// - otherwise, without "Update automatically", an Available update that is not quiet: "New worfy
//   <version> available" · "Update" · "Later" (R11: with it on, the build runs in the background
//   and only "ready" comes);
// - a failed build: "Update failed" · "Show log";
// - a Harness behind this copy's: "Harness out of date: <from> → <to>" · "Update" · "Later";
// - the end of the restart that ended the last run (`lastRestart`), and a Harness of the new copy
//   that did not install (`harnessAfterUpdate`).
//
// Each toast is offered once per window load for the same state: "Later", or any other way the
// user closes it, keeps it closed until the next start (R12). A new state (another build, a new
// failure, another Harness version) is offered again. Nothing shows while Update is off for this
// copy (`enabled`: only the Stable copy, or WORFY_UPDATE=1).
//
// Main keeps `lastRestart` in its state until the next restart, so the toast of it is remembered in
// this window's localStorage (worfy's data folder, ADR-0005), not shown at every start.
import type { HarnessStatus } from '../../shared/ipc/harness'
import { failureReason } from '../../shared/ipc/channels'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { autoUpdateOf, type AppSettings } from '../../shared/settings/app-settings'
import { invoke, subscribe } from '../ipc'
import { openSettings } from '../settings/settings-window'
import { dismissToast, isToastShown, showToast } from '../toast/toasts'
import { followUpdate, useUpdateStore } from './store'

export const AVAILABLE_KEY = 'update-available'
export const READY_KEY = 'update-ready'
export const FAILED_KEY = 'update-failed'
export const HARNESS_KEY = 'harness-outdated'
export const RESTART_RESULT_KEY = 'update-restart-result'
export const HARNESS_AFTER_UPDATE_KEY = 'update-harness-failed'
export const WAITING_KEY = 'update-restart-waiting'
/** Where a refusal or a failure of a button's call is told. */
export const ERROR_KEY = 'update-error'

/** The `lastRestart` already told, in localStorage. */
export const RESTART_SHOWN_ITEM = 'worfy.update.lastRestartShown'

export const WAITING_TEXT = 'worfy restarts when no Session is working and Autopilot has stopped'

/** The calls the toasts make; installUpdateToasts gives the app's, a test its fakes. */
export interface UpdateToastActions {
  invoke: typeof invoke
  /** "Open Health": Settings → Health. */
  openHealth: () => void
  /** Where the told `lastRestart` is kept; undefined — nowhere, it is told once per window load. */
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
}

export interface UpdateToasts {
  /** A snapshot of main's Update state. */
  update: (snapshot: UpdateSnapshot) => void
  /** The Harness status. */
  harness: (status: HarnessStatus) => void
  /** "Update automatically" of the app settings. */
  autoUpdate: (on: boolean) => void
}

type LastRestart = NonNullable<UpdateSnapshot['lastRestart']>

/** The text of the end of the last restart. */
function restartText(last: LastRestart): string {
  if (last.ok) {
    return last.action === 'rollback'
      ? `worfy is back to ${last.version}. Automatic updates wait for the next commit on main.`
      : `worfy updated to ${last.version}. The new Harness applies from the next Session.`
  }
  const what = last.action === 'rollback' ? 'rolled back' : 'updated'
  const to = last.version === '' ? '' : ` to ${last.version}`
  return `worfy was not ${what}${to}${last.reason === undefined ? '' : `: ${last.reason}`}`
}

/** The Harness behind this copy's, as "<from> → <to>", or null. */
function harnessBehind(snapshot: UpdateSnapshot, status: HarnessStatus | undefined): { from: string; to: string } | null {
  if (status !== undefined && !status.canInstall) return null
  const state = status?.state
  if (state?.kind === 'outdated' && !state.sameVersion) return { from: state.from ?? 'unknown', to: state.to }
  return snapshot.harnessBehind
}

/** The toasts of Update over `actions`; feed it the snapshots, the Harness status and the setting. */
export function createUpdateToasts(actions: UpdateToastActions): UpdateToasts {
  let snapshot: UpdateSnapshot | undefined
  let status: HarnessStatus | undefined
  let autoUpdate: boolean | undefined
  // What was offered in this window load, by what it was about: offered again only for another.
  let readyFor: string | undefined
  let readyButton: 'now' | 'idle' | undefined
  let availableFor: string | undefined
  let harnessFor: string | undefined
  let lastPhase: UpdateSnapshot['build']['phase'] | undefined
  let restartTold = false
  let harnessAfterTold = false

  const fail = (reason: string): void => {
    showToast({ kind: 'error', key: ERROR_KEY, testId: ERROR_KEY, text: reason })
  }

  const restart = (when: 'now' | 'idle'): void => {
    void actions.invoke('update.restart', { when }).then((result) => {
      if (!result.ok) fail(failureReason('update.restart', result.error))
      else if (result.value.outcome === 'refused') fail(result.value.reason)
      else if (result.value.outcome === 'waiting') showToast({ kind: 'info', key: WAITING_KEY, testId: WAITING_KEY, text: WAITING_TEXT })
    })
  }

  const call = (channel: 'update.install' | 'update.showLog' | 'harness.install'): void => {
    void actions.invoke(channel).then((result) => {
      if (!result.ok) fail(failureReason(channel, result.error))
    })
  }

  const later = { label: 'Later', run: () => undefined }

  function showReady(version: string, idle: boolean): void {
    readyButton = idle ? 'now' : 'idle'
    const button = idle ? { label: 'Restart now', run: () => restart('now') } : { label: 'Restart when idle', run: () => restart('idle') }
    showToast({ kind: 'action', key: READY_KEY, testId: READY_KEY, text: `worfy ${version} ready`, actions: [button, later] })
  }

  /** Draws "ready"; answers whether a build is ready, "Restart when idle" waiting or not. */
  function drawReady(state: UpdateSnapshot): boolean {
    const { build } = state
    if (build.phase !== 'ready' || state.restartWhenIdle) {
      dismissToast(READY_KEY)
      return build.phase === 'ready'
    }
    const about = build.sha ?? build.version ?? ''
    const version = build.version ?? state.available?.version ?? ''
    if (readyFor !== about) {
      readyFor = about
      showReady(version, state.idle)
    } else if (isToastShown(READY_KEY) && readyButton !== (state.idle ? 'now' : 'idle')) showReady(version, state.idle)
    return true
  }

  function drawAvailable(state: UpdateSnapshot, built: boolean): void {
    const { available } = state
    const wanted = available !== null && !available.quiet && autoUpdate === false && !built && state.build.phase !== 'building'
    if (!wanted) {
      dismissToast(AVAILABLE_KEY)
      return
    }
    if (availableFor === available.sha) return
    availableFor = available.sha
    showToast({
      kind: 'action',
      key: AVAILABLE_KEY,
      testId: AVAILABLE_KEY,
      text: `New worfy ${available.version} available`,
      actions: [{ label: 'Update', run: () => call('update.install') }, later],
    })
  }

  function drawFailed(state: UpdateSnapshot): void {
    const { phase } = state.build
    const before = lastPhase
    lastPhase = phase
    if (phase !== 'failed') {
      dismissToast(FAILED_KEY)
      return
    }
    if (before === 'failed') return
    showToast({ kind: 'action', key: FAILED_KEY, testId: FAILED_KEY, text: 'Update failed', actions: [{ label: 'Show log', run: () => call('update.showLog') }] })
  }

  function drawHarness(state: UpdateSnapshot): void {
    const behind = harnessBehind(state, status)
    if (behind === null) {
      dismissToast(HARNESS_KEY)
      return
    }
    const about = `${behind.from} → ${behind.to}`
    if (harnessFor === about) return
    harnessFor = about
    showToast({
      kind: 'action',
      key: HARNESS_KEY,
      testId: HARNESS_KEY,
      text: `Harness out of date: ${about}`,
      actions: [{ label: 'Update', run: () => call('harness.install') }, later],
    })
  }

  function tellRestart(state: UpdateSnapshot): void {
    if (restartTold) return
    restartTold = true
    const last = state.lastRestart
    if (last === null) return
    const told = JSON.stringify(last)
    try {
      if (actions.storage?.getItem(RESTART_SHOWN_ITEM) === told) return
      actions.storage?.setItem(RESTART_SHOWN_ITEM, told)
    } catch (error) {
      console.error('update toasts: localStorage cannot be used', error)
    }
    showToast({ kind: last.ok ? 'success' : 'error', key: RESTART_RESULT_KEY, testId: RESTART_RESULT_KEY, text: restartText(last) })
  }

  function tellHarnessAfterUpdate(state: UpdateSnapshot): void {
    if (state.harnessAfterUpdate !== 'failed') {
      dismissToast(HARNESS_AFTER_UPDATE_KEY)
      return
    }
    if (harnessAfterTold) return
    harnessAfterTold = true
    showToast({
      kind: 'action',
      key: HARNESS_AFTER_UPDATE_KEY,
      testId: HARNESS_AFTER_UPDATE_KEY,
      text: 'The Harness was not updated',
      actions: [{ label: 'Open Health', run: actions.openHealth }],
    })
  }

  function draw(): void {
    // The available toast waits for the setting: R11 decides it.
    if (snapshot === undefined || !snapshot.enabled || autoUpdate === undefined) return
    tellRestart(snapshot)
    tellHarnessAfterUpdate(snapshot)
    const built = drawReady(snapshot)
    drawAvailable(snapshot, built)
    drawFailed(snapshot)
    drawHarness(snapshot)
  }

  return {
    update: (next) => {
      snapshot = next
      draw()
    },
    harness: (next) => {
      status = next
      draw()
    },
    autoUpdate: (on) => {
      if (autoUpdate === on) return
      autoUpdate = on
      draw()
    },
  }
}

let installed = false

/**
 * Follows main's Update state, the Harness status and "Update automatically" for this window and
 * draws their toasts; once per window load (main.tsx, with the other toasts of the start).
 */
export function installUpdateToasts(): void {
  if (installed) return
  installed = true
  let storage: UpdateToastActions['storage']
  try {
    storage = globalThis.localStorage
  } catch {
    storage = undefined
  }
  const toasts = createUpdateToasts({ invoke, openHealth: () => openSettings('HealthSection'), storage })
  const follow = (what: string, start: () => void): void => {
    try {
      start()
    } catch (error) {
      console.error(`update toasts: cannot follow ${what}`, error)
    }
  }
  // An answer and an event can come in either order: the newer settings, and the event's status, win.
  let revision = -1
  const takeSettings = (settings: AppSettings): void => {
    if (settings.revision < revision) return
    revision = settings.revision
    toasts.autoUpdate(autoUpdateOf(settings))
  }
  follow('appSettings.changed', () => subscribe('appSettings.changed', takeSettings))
  void invoke('appSettings.get').then((result) => {
    if (result.ok) takeSettings(result.value)
    // Unread, the setting counts as its default, on: only "ready" comes, never a wrong "available".
    else {
      console.error('appSettings.get failed:', result.error)
      if (revision === -1) toasts.autoUpdate(true)
    }
  })
  let harnessHeard = false
  follow('harness.changed', () =>
    subscribe('harness.changed', (status) => {
      harnessHeard = true
      toasts.harness(status)
    }),
  )
  void invoke('harness.state').then((result) => {
    if (!result.ok) console.error('harness.state failed:', result.error)
    else if (!harnessHeard) toasts.harness(result.value)
  })
  useUpdateStore.subscribe((state) => {
    if (state.snapshot !== null) toasts.update(state.snapshot)
  })
  const now = useUpdateStore.getState().snapshot
  if (now !== null) toasts.update(now)
  followUpdate()
}
