// Handlers of the `autopilot` domain (src/shared/ipc/autopilot.ts), and the app's Autopilot
// (src/main/autopilot/run.ts) wired to its Projects, Orchestrators, Sessions, workflow watch, run
// journal, keep-awake and the Limits (the wait after a refusal, worfy-daily ticket 05). Stop gives
// the Orchestrator back at once (Orchestrators.giveBackNow, worfy-week ticket 17). A run's
// changes go to every window. When the app quits during a run, the quit waits (a few seconds at
// most) until the run has written `run-stopped` with `app-quit`; that also cancels a Limits wait.
import { execFile } from 'node:child_process'
import { app } from 'electron'
import { autopilotChanged, autopilotStart, autopilotState, autopilotStop, type AutopilotState } from '../../shared/ipc/autopilot'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { appLimits, observeSessionLimits } from '../agent/limits'
import { openRun } from '../autopilot/journal'
import { KeepAwake } from '../autopilot/power'
import { Autopilot, selfProjectRefusal } from '../autopilot/run'
import { toEveryWindow } from '../broadcast'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readWorkflow } from '../workflow/reader'
import { sharedLauncher } from './actions'
import { defineHandler, emit, type HandlerModule } from './index'
import { workflowHub } from './workflow'

/** The handlers over an Autopilot; tests pass their own. */
export function autopilotHandlers(autopilot: () => Pick<Autopilot, 'start' | 'stop' | 'state'>): HandlerModule {
  return [
    defineHandler(autopilotStart, ({ projectId, epic }) => autopilot().start(projectId, epic)),
    defineHandler(autopilotStop, ({ projectId }) => autopilot().stop(projectId)),
    defineHandler(autopilotState, ({ projectId }) => autopilot().state(projectId)),
  ]
}

/** The repository's common git folder of `dir`, absolute; null outside git. */
function gitCommonDir(dir: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }, (error, stdout) => done(error ? null : stdout.trim() || null))
  })
}

/** How long a quit waits for the runs to write their end. */
const QUIT_WAIT_MS = 3000

/** Subscribers of the workflow watch get ids of their own, apart from the windows' webContents ids. */
let watchIds = 0

let shared: Autopilot | undefined

/** The app's Autopilot, made on first use. */
export function sharedAutopilot(): Autopilot {
  if (shared !== undefined) return shared
  const autopilot = new Autopilot({
    projectRoot: (projectId) => projectStore().get(projectId).path,
    selfRefusal: (root) => selfProjectRefusal({ packaged: app.isPackaged, appPath: app.getAppPath(), projectRoot: root, gitCommonDir }),
    workflow: async (root) => (await readWorkflow({ root, claudeHome: claudeHome() })).model,
    watchWorkflow: async (root, onChange) => {
      watchIds -= 1
      const id = watchIds
      await workflowHub.open(root, { id, send: () => onChange() })
      return async () => {
        await workflowHub.close(root, id)
      }
    },
    orchestrators: {
      setUnattended: (projectId, unattended) => sharedOrchestrators().setUnattended(projectId, unattended),
      giveBackNow: (projectId) => sharedOrchestrators().giveBackNow(projectId),
    },
    registry: {
      get: (sessionId) => sharedRegistry().get(sessionId),
      observe: (sink) => sharedRegistry().observe(sink),
      observeInput: (listener) => sharedRegistry().observeInput(listener),
    },
    waves: { autopilotWave: (projectId, epic, resume) => sharedLauncher().autopilotWave(projectId, epic, resume), autopilotRefusal: (projectId) => sharedLauncher().autopilotRefusal(projectId) },
    journal: (start) => openRun(start),
    keepAwake: () => new KeepAwake(),
    onChange: (state: AutopilotState) => toEveryWindow((target) => emit(target, autopilotChanged, state)),
    limits: {
      state: () => appLimits().snapshot(),
      observeSession: (isSession, listener) => observeSessionLimits((sink) => sharedRegistry().observe(sink), isSession, listener),
      send: (sessionId, text) => {
        sharedRegistry().get(sessionId).send(text)
      },
    },
  })
  sharedLauncher().attachAutopilot(autopilot)
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !autopilot.anyRunning()) return
    quitting = true
    event.preventDefault()
    const waited = new Promise((done) => setTimeout(done, QUIT_WAIT_MS))
    void Promise.race([autopilot.stopAll(), waited])
      .catch((error: unknown) => console.error('[autopilot] could not stop the runs on quit', error))
      .finally(() => app.quit())
  })
  shared = autopilot
  return autopilot
}

export default autopilotHandlers(sharedAutopilot) satisfies HandlerModule
