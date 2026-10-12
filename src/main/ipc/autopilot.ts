// Handlers of the `autopilot` domain (src/shared/ipc/autopilot.ts), and the app's Autopilot
// (src/main/autopilot/run.ts) wired to its Projects, Orchestrators, Sessions, workflow watch, run
// journal, keep-awake and the Limits (the wait after a refusal, worfy-daily ticket 05). Stop is
// graceful (worfy-week ticket 18); Force stop gives the Orchestrator back at once
// (Orchestrators.giveBackNow, worfy-week ticket 17). A run's
// changes go to every window. When the app quits during a run, the quit waits (a few seconds at
// most) until the run has written `run-stopped` with `app-quit`; that also cancels a Limits wait.
// Asking a Project's state also asks again, at most once a minute, whether the Harness in its main
// is newer than this build's (worfy-harness ticket 21, packaged builds only); a changed answer comes
// as `autopilot.changed`. The run reads the PRs of its Wave Tickets for the narrow fix round
// (worfy-harness ticket 20) through the app's one PR tracker, the PR badges' (checks.ts).
// One run per Epic and origin across the Linked machines (worfy-link ticket 15): a start asks them
// through the link (src/main/link/autopilot-runs.ts), and this Machine answers their questions from
// the moment its link starts, whether or not its Autopilot has been used. A start refused for a run
// elsewhere answers `runningElsewhere`, not an error. The question goes after the quit's wait
// (before-quit) has begun no more: the link stops in will-quit, after it (service.ts).
import { execFile } from 'node:child_process'
import { app } from 'electron'
import { autopilotChanged, autopilotForceStop, autopilotStart, autopilotState, autopilotStop, type AutopilotState } from '../../shared/ipc/autopilot'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { sharedRegistry } from '../agent/app-registry'
import { appLimits, observeSessionLimits } from '../agent/limits'
import { harnessDriftWatch } from '../autopilot/harness-drift'
import { openRun } from '../autopilot/journal'
import { KeepAwake } from '../autopilot/power'
import { readOriginKey } from '../autopilot/origin'
import { Autopilot, RunningElsewhere, selfProjectRefusal } from '../autopilot/run'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessVersion } from '../harness/bundled'
import { AutopilotRunsLink } from '../link/autopilot-runs'
import { appLinkService, onAppLinkStart, type LinkService } from '../link/service'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { readWorkflow } from '../workflow/reader'
import { sharedLauncher } from './actions'
import { sharedPrTracker } from './checks'
import { defineHandler, emit, type HandlerModule } from './index'
import { workflowHub } from './workflow'

/** The handlers over an Autopilot; tests pass their own. */
export function autopilotHandlers(autopilot: () => Pick<Autopilot, 'start' | 'stop' | 'forceStop' | 'state'> & Partial<Pick<Autopilot, 'refreshHarness'>>): HandlerModule {
  return [
    defineHandler(autopilotStart, async ({ projectId, epic, override }) => {
      try {
        return await autopilot().start(projectId, epic, { override: override === true })
      } catch (error) {
        if (!(error instanceof RunningElsewhere)) throw error
        return { runningElsewhere: { epic: error.epic, machine: error.machine, message: error.message } }
      }
    }),
    defineHandler(autopilotStop, ({ projectId }) => autopilot().stop(projectId)),
    defineHandler(autopilotForceStop, ({ projectId }) => autopilot().forceStop(projectId)),
    defineHandler(autopilotState, ({ projectId }) => {
      const current = autopilot()
      // The state answers at once; git answers later, through autopilot.changed.
      void current.refreshHarness?.(projectId)?.catch((error: unknown) => console.warn(`[autopilot] ${projectId}: could not compare the Harness with main`, error))
      return current.state(projectId)
    }),
  ]
}

/** The repository's common git folder of `dir`, absolute; null outside git. */
export function gitCommonDir(dir: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }, (error, stdout) => done(error ? null : stdout.trim() || null))
  })
}

/** How long a quit waits for the runs to write their end. */
const QUIT_WAIT_MS = 3000

/** Subscribers of the workflow watch get ids of their own, apart from the windows' webContents ids. */
let watchIds = 0

let shared: Autopilot | undefined

/** The question about Autopilot runs on each link service (one per app; tests may start more). */
const runsLinks = new WeakMap<LinkService, AutopilotRunsLink>()

/** The question on the app's link service, registered on first use; undefined while the link does not run. */
function runsLink(): AutopilotRunsLink | undefined {
  const service = appLinkService()
  if (service === undefined) return undefined
  let link = runsLinks.get(service)
  if (link === undefined) {
    link = new AutopilotRunsLink(service, () => shared?.runKeys() ?? [])
    runsLinks.set(service, link)
  }
  return link
}

// This Machine answers from the start of its link: a Linked machine asking must not wait 3 s for a
// worfy whose Autopilot was never opened.
onAppLinkStart(() => void runsLink())
runsLink()

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
    harnessDrift: harnessDriftWatch({ packaged: app.isPackaged, harnessVersion: () => bundledHarnessVersion() }),
    prs: sharedPrTracker(),
    origin: (root) => readOriginKey(root),
    linkedRuns: async () => (await runsLink()?.ask()) ?? [],
    // Named only while this Machine has Linked machines: alone, which Machine runs it says nothing.
    machine: () => {
      const service = appLinkService()
      return service !== undefined && service.linkedMachines().length > 0 ? service.machine : null
    },
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
