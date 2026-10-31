// Handlers of the `update` domain (src/shared/ipc/update.ts, worfy-update ticket 01) and the
// schedule of the Update checks, which src/main/index.ts starts and stops on `will-quit`.
//
// Update is on only in the packaged Stable copy, or with WORFY_UPDATE=1 (spec R1,
// src/main/update/stable-copy.ts). Off, the snapshot says `enabled: false`, no check runs and the
// state file is neither read nor written.
import { app } from 'electron'
import { updateChanged, updateCheck, updateStateChannel, type UpdateSnapshot } from '../../shared/ipc/update'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessVersion } from '../harness/bundled'
import { checkForUpdate, UpdateChecks } from '../update/check'
import { updateGitHub, type UpdateGitHub } from '../update/github'
import { readStableMetadata, runningOf, runsFromStableCopy, stableCopyPath, updateEnabled } from '../update/stable-copy'
import { changeUpdateState, emptyUpdateState, readUpdateState, updateStateFile } from '../update/state'
import { defineHandler, emit, type HandlerModule } from './index'

export interface UpdateServiceOptions {
  enabled: boolean
  /** The commit and the build version of the copy that runs. */
  running: () => { commit: string; version: string }
  client: UpdateGitHub
  /** The state file; asked for at each use. */
  stateFile: () => string
  /** Sends the snapshot to every window. */
  broadcast: (snapshot: UpdateSnapshot) => void
  now?: () => Date
}

export class UpdateService {
  readonly checks: UpdateChecks

  constructor(private readonly options: UpdateServiceOptions) {
    this.checks = new UpdateChecks(
      (manual) => this.run(manual),
      () => this.options.broadcast(this.snapshot()),
    )
  }

  snapshot(): UpdateSnapshot {
    if (!this.options.enabled) return { ...emptyUpdateState(), enabled: false, checking: false }
    return { ...readUpdateState(this.options.stateFile()), enabled: true, checking: this.checks.checking }
  }

  /** Checks now ("Check now") and answers the snapshot after it; off, only the snapshot. */
  async check(): Promise<UpdateSnapshot> {
    if (this.options.enabled) await this.checks.now(true)
    return this.snapshot()
  }

  /** The schedule, when Update is on; the function returned stops it. */
  start(): () => void {
    if (!this.options.enabled) return () => undefined
    return this.checks.start()
  }

  private async run(manual: boolean): Promise<void> {
    const file = this.options.stateFile()
    const running = this.options.running()
    const outcome = await checkForUpdate({
      client: this.options.client,
      running: running.commit,
      rolledBackFrom: readUpdateState(file).rolledBackFrom,
      manual,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    })
    // Spec R15: one line in the log of main, nothing on the screen.
    if (outcome.lastCheck.result === 'skipped') console.warn(`[update] the check was skipped: ${outcome.lastCheck.reason ?? 'no reason given'}`)
    changeUpdateState(
      (state) => ({ ...state, running, lastCheck: outcome.lastCheck, ...(outcome.available === undefined ? {} : { available: outcome.available }) }),
      file,
    )
  }
}

/** The copy that runs: the commit of the file next to the Stable copy when this run is that copy (or names one for a test), else the build version's. */
function appRunning(): { commit: string; version: string } {
  const version = bundledHarnessVersion() ?? app.getVersion()
  const copy = stableCopyPath()
  const named = runsFromStableCopy({ packaged: app.isPackaged, execPath: process.execPath, env: process.env }) || Boolean(process.env.WORFY_UPDATE_STABLE)
  return runningOf(named ? readStableMetadata(process.platform, copy) : undefined, version)
}

let shared: UpdateService | undefined

/** The app's service, made on first use: after src/main/index.ts has set the build kind of the data folder. */
export function appUpdate(): UpdateService {
  if (shared === undefined) {
    let running: { commit: string; version: string } | undefined
    shared = new UpdateService({
      enabled: updateEnabled({ packaged: app.isPackaged, execPath: process.execPath, env: process.env }),
      running: () => (running ??= appRunning()),
      // Only WORFY_UPDATE_API is passed: the client never sees GH_TOKEN or GITHUB_TOKEN.
      client: updateGitHub({ env: { WORFY_UPDATE_API: process.env.WORFY_UPDATE_API } }),
      stateFile: () => updateStateFile(),
      broadcast: (snapshot) => toEveryWindow((client) => emit(client, updateChanged, snapshot)),
    })
  }
  return shared
}

/** Starts the checks (10 s after the start, then every hour) when Update is on; the function returned stops them. */
export function startUpdateChecks(): () => void {
  return appUpdate().start()
}

export function updateHandlers(service: () => UpdateService = appUpdate): HandlerModule {
  return [defineHandler(updateStateChannel, () => service().snapshot()), defineHandler(updateCheck, () => service().check())]
}

export default updateHandlers()
