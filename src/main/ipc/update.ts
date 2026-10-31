// Handlers of the `update` domain (src/shared/ipc/update.ts, worfy-update tickets 01, 03 and 04) and
// the schedule of the Update checks, which src/main/index.ts starts and stops on `will-quit`; the stop
// ends a build that runs too.
//
// Update is on only in the packaged Stable copy, or with WORFY_UPDATE=1 (spec R1,
// src/main/update/stable-copy.ts). Off, the snapshot says `enabled: false`, no check or build runs
// and the state file is neither read nor written.
//
// After each check "Update automatically" may start a build (src/main/update/auto.ts); the build
// itself is src/main/update/build.ts.
//
// "Restart now", "Restart when idle" and the roll back (ticket 04) are src/main/update/restart.ts;
// whether nothing works is src/main/update/idle.ts, followed while Update is on and kept in the
// state's `idle`. At the start the result of the restart that ended the last run is read.
//
// "What's new" (ticket 10) is src/main/update/whats-new.ts: one comparison of the running commit
// with the new version, kept for the run.
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, shell } from 'electron'
import type { AgentEvent } from '../../shared/agent/events'
import {
  updateChanged,
  updateCheck,
  updateInstall,
  updateRestart,
  updateRollback,
  updateShowLog,
  updateStateChannel,
  updateWhatsNew,
  type RestartAnswer,
  type UpdateSnapshot,
  type WhatsNew,
} from '../../shared/ipc/update'
import { autoUpdateOf } from '../../shared/settings/app-settings'
import { agentEnv, recaptureAgentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessVersion } from '../harness/bundled'
import { appSettingsStore } from '../settings/store'
import { autoBuildFor, installTarget } from '../update/auto'
import { UpdateBuilder, updateBuildOverride, updateRepo, type UpdateBuilds } from '../update/build'
import { checkForUpdate, UpdateChecks } from '../update/check'
import { updateGitHub, type UpdateGitHub } from '../update/github'
import { IdleWatch, type IdleSession } from '../update/idle'
import { Restarts } from '../update/restart'
import { readStableMetadata, runningOf, runsFromStableCopy, stableCopyPath, updateEnabled } from '../update/stable-copy'
import { changeUpdateState, emptyUpdateState, readUpdateState, updateDir, updateStateFile } from '../update/state'
import { WhatsNewReader } from '../update/whats-new'
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
  /** Follows whether nothing works (ticket 04); without it, `idle` is left as the file has it. */
  idle?: IdleWatch
  /** "Restart now", "Restart when idle" and the roll back (ticket 04); without them a restart is refused. */
  restarts?: Restarts
  now?: () => Date
}

const OFF_REASON = 'Update is off in this copy of worfy'
const OFF: RestartAnswer = { outcome: 'refused', reason: OFF_REASON }

export class UpdateService {
  readonly checks: UpdateChecks
  private readonly whatsNewReader: WhatsNewReader

  constructor(private readonly options: UpdateServiceOptions) {
    this.whatsNewReader = new WhatsNewReader(options.client)
    this.checks = new UpdateChecks(
      (manual) => this.run(manual),
      () => this.options.broadcast(this.snapshot()),
    )
  }

  snapshot(): UpdateSnapshot {
    if (!this.options.enabled) return { ...emptyUpdateState(), enabled: false, checking: false, restartWhenIdle: false }
    return { ...readUpdateState(this.options.stateFile()), enabled: true, checking: this.checks.checking, restartWhenIdle: this.options.restarts?.pending ?? false }
  }

  /** "Restart now", "Restart when idle" or the cancel of that wish. */
  restart(when: 'now' | 'idle' | 'cancel'): Promise<RestartAnswer> {
    const { restarts } = this.options
    if (!this.options.enabled || restarts === undefined) return Promise.resolve(OFF)
    return restarts.restart(when)
  }

  /** The roll back to the previous copy, once `confirm` said yes. */
  rollback(confirm: (version: string) => Promise<boolean>): Promise<RestartAnswer> {
    const { restarts } = this.options
    if (!this.options.enabled || restarts === undefined) return Promise.resolve(OFF)
    return restarts.rollback(confirm)
  }

  /** worfy quits (before-quit): "Restart when idle" no longer waits, and no restart starts. */
  quitting(): void {
    this.options.restarts?.quitting()
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

  /**
   * "What's new": the PRs between the copy that runs and the new version — the build that runs or is
   * ready when there is one, else the Available update. Fails with the reason.
   */
  async whatsNew(): Promise<WhatsNew> {
    if (!this.options.enabled) throw new Error(OFF_REASON)
    const { available, build } = readUpdateState(this.options.stateFile())
    const target =
      build.phase !== 'idle' && build.sha !== undefined && build.version !== undefined ? { sha: build.sha, version: build.version } : available
    if (target === null) throw new Error('there is no Available update to compare with')
    return this.whatsNewReader.read(this.options.running().commit, target.sha, target.version)
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
    const { builder, idle, restarts } = this.options
    builder?.recover()
    try {
      restarts?.settle()
    } catch (error) {
      console.error('[update] the result of the last restart could not be read', error)
    }
    const stopIdle = idle === undefined ? () => undefined : this.followIdle(idle)
    const stopChecks = this.checks.start()
    return () => {
      stopChecks()
      stopIdle()
      builder?.stop()
    }
  }

  /** Keeps the state's `idle` as the watch sees it; answers the stop. */
  private followIdle(idle: IdleWatch): () => void {
    const write = (value: boolean): void => {
      try {
        if (readUpdateState(this.options.stateFile()).idle !== value) changeUpdateState((state) => ({ ...state, idle: value }), this.options.stateFile())
      } catch (error) {
        console.error('[update] whether anything works could not be written', error)
      }
      this.options.broadcast(this.snapshot())
    }
    const stopWatch = idle.start()
    const unsubscribe = idle.subscribe(write)
    write(idle.idle)
    return () => {
      unsubscribe()
      stopWatch()
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

/** The live Sessions as the rule of spec R6 reads them. */
function sessionsOf(registry: SessionRegistryView): IdleSession[] {
  return registry.list().map((info) => {
    let backgroundTasks = 0
    try {
      backgroundTasks = registry.get(info.sessionId).backgroundTasks().length
    } catch {
      // Closed since the list was taken.
    }
    return { state: info.state, backgroundTasks }
  })
}

type SessionRegistryView = Pick<import('../agent/session/registry').SessionRegistry, 'list' | 'get' | 'observe'>

/**
 * The watch over the app's Sessions and Autopilot. Their modules are loaded when the watch starts,
 * not with this one (the tests of the check load this module alone); until then Autopilot counts as
 * running, so nothing reads as quiet too early. The look every 2 s takes them in once loaded.
 */
function appIdleWatch(): IdleWatch {
  let registry: SessionRegistryView | undefined
  let autopilotRunning: (() => boolean) | undefined
  const loaded = Promise.all([import('../agent/app-registry'), import('./autopilot')]).then(([sessions, autopilot]) => {
    registry = sessions.sharedRegistry()
    autopilotRunning = () => autopilot.sharedAutopilot().anyRunning()
  })
  loaded.catch((error: unknown) => console.error('[update] the Sessions and Autopilot could not be followed', error))
  return new IdleWatch({
    sources: {
      sessions: () => (registry === undefined ? [] : sessionsOf(registry)),
      autopilotRunning: () => autopilotRunning?.() ?? true,
    },
    observe: (listener: (sessionId: string, event: AgentEvent) => void) => {
      let stopped = false
      let unobserve: (() => void) | undefined
      void loaded.then(() => {
        if (!stopped && registry !== undefined) unobserve = registry.observe(listener)
      })
      return () => {
        stopped = true
        unobserve?.()
      }
    },
  })
}

let shared: UpdateService | undefined

/** The app's service, made on first use: after src/main/index.ts has set the build kind of the data folder. */
export function appUpdate(): UpdateService {
  if (shared === undefined) {
    let running: { commit: string; version: string } | undefined
    const idle = appIdleWatch()
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
        // The login shell's environment, captured anew for each build: a packaged app started from
        // the Dock has only the system PATH, and a pnpm installed since the last build is found
        // (spec item 8: install the tool, then "Check now" and "Update worfy").
        env: () => recaptureAgentEnv(),
        stateFile: () => updateStateFile(),
        onChange: () => broadcast(appUpdate().snapshot()),
      }),
      autoUpdate: () => autoUpdateOf(appSettingsStore().get()),
      openPath: (path) => shell.openPath(path),
      idle,
      restarts: new Restarts({
        dir: updateDir(),
        stateFile: () => updateStateFile(),
        target: () => stableCopyPath(),
        pid: process.pid,
        // The login shell's environment, as the build had it: the system's node is found on its PATH.
        env: async () => (await agentEnv()).env,
        running: () => (running ??= appRunning()),
        idle,
        quit: () => app.quit(),
        onChange: () => broadcast(appUpdate().snapshot()),
      }),
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
  const service = appUpdate()
  // Kept for the whole run: the stop comes on will-quit, after before-quit.
  app.on('before-quit', () => service.quitting())
  return service.start()
}

/** The native dialog of the roll back (spec, "Texts"), on the window that asked; button 0 rolls back. */
async function confirmRollback(owner: BrowserWindow | null, version: string): Promise<boolean> {
  const options = {
    type: 'question' as const,
    buttons: ['Roll back', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'worfy',
    message: `Roll back to worfy ${version}?`,
    detail: 'worfy quits, puts the previous copy back and starts it. Its Harness is installed too.',
    noLink: true,
  }
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return response === 0
}

export function updateHandlers(service: () => UpdateService = appUpdate): HandlerModule {
  return [
    defineHandler(updateStateChannel, () => service().snapshot()),
    defineHandler(updateCheck, () => service().check()),
    defineHandler(updateInstall, () => service().install()),
    defineHandler(updateShowLog, () => service().showLog()),
    defineHandler(updateWhatsNew, () => service().whatsNew()),
    defineHandler(updateRestart, ({ when }) => service().restart(when)),
    defineHandler(updateRollback, (_input, { event }) => service().rollback((version) => confirmRollback(BrowserWindow.fromWebContents(event.sender), version))),
  ]
}

export default updateHandlers()
