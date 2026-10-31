// Handlers of the `update` domain (src/shared/ipc/update.ts, worfy-update tickets 01 and 03) and the
// schedule of the Update checks, which src/main/index.ts starts and stops on `will-quit`; the stop
// ends a build that runs too.
//
// Update is on only in the packaged Stable copy, or with WORFY_UPDATE=1 (spec R1,
// src/main/update/stable-copy.ts). Off, the snapshot says `enabled: false`, no check or build runs
// and the state file is neither read nor written.
//
// After each check "Update automatically" may start a build (src/main/update/auto.ts); the build
// itself is src/main/update/build.ts.
import { existsSync } from 'node:fs'
import { app, shell } from 'electron'
import { updateChanged, updateCheck, updateInstall, updateShowLog, updateStateChannel, type UpdateSnapshot } from '../../shared/ipc/update'
import { autoUpdateOf } from '../../shared/settings/app-settings'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessVersion } from '../harness/bundled'
import { appSettingsStore } from '../settings/store'
import { autoBuildFor, installTarget } from '../update/auto'
import { UpdateBuilder, updateBuildOverride, updateRepo, type UpdateBuilds } from '../update/build'
import { checkForUpdate, UpdateChecks } from '../update/check'
import { updateGitHub, type UpdateGitHub } from '../update/github'
import { readStableMetadata, runningOf, runsFromStableCopy, stableCopyPath, updateEnabled } from '../update/stable-copy'
import { changeUpdateState, emptyUpdateState, readUpdateState, updateDir, updateStateFile } from '../update/state'
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
  /** Builds an Update in worfy's own clone; without one (tests of the check) nothing is built. */
  builder?: UpdateBuilds
  /** Whether "Update automatically" is on; asked for after each check. Without it, off. */
  autoUpdate?: () => boolean
  /** Opens a file with the program of the system; answers an error message, or '' (shell.openPath). */
  openPath?: (path: string) => Promise<string>
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

  /** Builds the Available update ("Update worfy"); answers the snapshot with the build begun. Off, only the snapshot. */
  install(): UpdateSnapshot {
    const { builder } = this.options
    if (!this.options.enabled || builder === undefined) return this.snapshot()
    const target = installTarget(readUpdateState(this.options.stateFile()))
    if (target !== null) builder.install(target)
    return this.snapshot()
  }

  /** Opens build.log of the last build with the program of the system. */
  async showLog(): Promise<void> {
    const log = this.options.builder?.logFile
    if (!this.options.enabled || log === undefined || !existsSync(log)) throw new Error('there is no build log yet: no Update was built')
    const failure = await (this.options.openPath ?? shell.openPath)(log)
    if (failure) throw new Error(failure)
  }

  /**
   * The schedule, when Update is on; the function returned stops it and the build that runs. A build
   * the state file says runs, left by a worfy that quit during it, is idle again first.
   */
  start(): () => void {
    if (!this.options.enabled) return () => undefined
    const { builder } = this.options
    builder?.recover()
    const stopChecks = this.checks.start()
    return () => {
      stopChecks()
      builder?.stop()
    }
  }

  /** After a check: the build "Update automatically" asks for, if any. */
  private autoBuild(): void {
    const { builder, autoUpdate } = this.options
    if (builder === undefined || autoUpdate === undefined) return
    const target = autoBuildFor(readUpdateState(this.options.stateFile()), autoUpdate())
    if (target !== null) builder.install(target)
  }

  private async run(manual: boolean): Promise<void> {
    const file = this.options.stateFile()
    const running = this.options.running()
    let rolledBackFrom: string | null = null
    try {
      rolledBackFrom = readUpdateState(file).rolledBackFrom
    } catch (error) {
      // A state file that cannot be read at all (no permission, a folder in its place): the check
      // still runs, and its result is logged when it cannot be written either.
      console.error(`[update] ${file} could not be read`, error)
    }
    const outcome = await checkForUpdate({
      client: this.options.client,
      running: running.commit,
      rolledBackFrom,
      manual,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    })
    // Spec R15: one line in the log of main, nothing on the screen.
    if (outcome.lastCheck.result === 'skipped') console.warn(`[update] the check was skipped: ${outcome.lastCheck.reason ?? 'no reason given'}`)
    try {
      changeUpdateState(
        (state) => ({ ...state, running, lastCheck: outcome.lastCheck, ...(outcome.available === undefined ? {} : { available: outcome.available }) }),
        file,
      )
    } catch (error) {
      throw new Error(`the check ended (${JSON.stringify(outcome)}), but ${file} could not be written`, { cause: error })
    }
    this.autoBuild()
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
      broadcast,
      // The configured repository and build only: never a value of GitHub's answer.
      builder: new UpdateBuilder({
        dir: updateDir(),
        repo: updateRepo(process.env),
        build: updateBuildOverride(process.env),
        // The login shell's environment: a packaged app started from the Dock has only the system PATH.
        env: async () => (await agentEnv()).env,
        stateFile: () => updateStateFile(),
        onChange: () => broadcast(appUpdate().snapshot()),
      }),
      autoUpdate: () => autoUpdateOf(appSettingsStore().get()),
      openPath: (path) => shell.openPath(path),
    })
  }
  return shared
}

/** Sends the snapshot to every window. */
function broadcast(snapshot: UpdateSnapshot): void {
  toEveryWindow((client) => emit(client, updateChanged, snapshot))
}

/** Starts the checks (10 s after the start, then every hour) when Update is on; the function returned stops them. */
export function startUpdateChecks(): () => void {
  return appUpdate().start()
}

export function updateHandlers(service: () => UpdateService = appUpdate): HandlerModule {
  return [
    defineHandler(updateStateChannel, () => service().snapshot()),
    defineHandler(updateCheck, () => service().check()),
    defineHandler(updateInstall, () => service().install()),
    defineHandler(updateShowLog, () => service().showLog()),
  ]
}

export default updateHandlers()
