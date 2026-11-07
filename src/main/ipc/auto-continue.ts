// Handlers of the `autoContinue` domain (src/shared/ipc/auto-continue.ts, worfy-retry ticket 02): the
// Auto-continue item of the Orchestrator's Modes menu. The setting lives in app-settings.json of worfy's
// data folder (src/main/settings/store.ts, ADR-0005) and is written only here; the retry of the
// Orchestrator's turn reads it with autoContinueOn() of the store. A Project id that is not one of this
// Machine's Projects is refused: the setting of a Project is set on the Machine it lives on — from a
// window of a Linked machine too, through the link (worfy-retry ticket 13). A write that changes the
// setting reaches every client as `autoContinue.changed` — the windows of this Machine and the Linked
// machines with access — so a menu open anywhere shows it at once.
//
// The wait (worfy-retry ticket 07): what the Project's Orchestrator waits for, for the countdown over its
// input field — the Project's Autopilot run when it waits (Autopilot.continueWait), else the Auto-continue
// of manual turns (OrchestratorContinue.wait). `Retry now` and `Cancel` go to the one that waits. A change
// of a manual wait reaches every client as `autoContinue.waitChanged`; a run's goes with its state
// (`autopilot.changed`). Both are loaded on first use, not with this module (its tests load it alone).
import type { LimitWindow } from '../../shared/agent/limits'
import { toEveryWindow } from '../broadcast'
import {
  autoContinueCancel,
  autoContinueChanged,
  autoContinueRead,
  autoContinueRetryNow,
  autoContinueSet,
  autoContinueWait,
  autoContinueWaitChanged,
  type AutoContinueState,
  type ContinueWaitView,
} from '../../shared/ipc/auto-continue'
import type { ContinueWait } from '../agent/orchestrator-continue'
import { projectStore } from '../projects/store'
import { appSettingsStore, type AppSettingsStore } from '../settings/store'
import { defineHandler, emit, type HandlerModule } from './index'

/** The waits of one source, as the Autopilot runs and the Auto-continue of manual turns give them. */
export interface ContinueWaits {
  wait(projectId: string): ContinueWait | null
  retryNow(projectId: string): boolean | Promise<boolean>
  cancel(projectId: string): boolean | Promise<boolean>
}

/** The waits of manual turns, which also tell of their changes. */
export interface ManualWaits extends ContinueWaits {
  observeWaits(listener: (projectId: string) => void): () => void
}

export interface AutoContinueHandlersOptions {
  /** This Machine's Projects; the app's (projectStore) when absent. */
  projects?: () => readonly { readonly id: string }[]
  /** The settings store; the app's (appSettingsStore) when absent. */
  store?: () => AppSettingsStore
  /** The Autopilot runs' waits; the app's Autopilot when absent. */
  runs?: () => Promise<ContinueWaits>
  /** The waits of manual turns; the app's (sharedOrchestratorContinue) when absent. */
  manual?: () => Promise<ManualWaits>
  /** The windows of every Vendor as last known, for the label of a window; the app's Limits when absent. */
  windows?: () => Promise<readonly LimitWindow[]>
}

/** The label of Claude's windows by the start of their name (`seven_day_opus` reads `7-day opus`). */
const CLAUDE_LABELS: readonly (readonly [string, string])[] = [
  ['five_hour', '5-hour'],
  ['seven_day', '7-day'],
]

/**
 * The label of the window `id` a Vendor reported: the label its known window has (Codex's `weekly`,
 * src/main/vendors/codex/limits.ts), else Claude's (`five_hour` — `5-hour`, `seven_day` — `7-day`), else
 * the name with spaces.
 */
export function windowLabel(id: string, windows: readonly LimitWindow[]): string {
  const known = windows.find((window) => window.id === id)
  if (known !== undefined) return known.label
  const claude = CLAUDE_LABELS.find(([prefix]) => id === prefix || id.startsWith(`${prefix}_`))
  const rest = claude === undefined ? id : id.slice(claude[0].length)
  return `${claude?.[1] ?? ''}${rest.replaceAll('_', ' ')}`.trim()
}

/** The app's Autopilot runs, loaded on first use. */
const appRuns = async (): Promise<ContinueWaits> => {
  const autopilot = (await import('./autopilot')).sharedAutopilot()
  return { wait: (projectId) => autopilot.continueWait(projectId), retryNow: (projectId) => autopilot.retryNow(projectId), cancel: (projectId) => autopilot.cancelContinue(projectId) }
}

/** The app's Auto-continue of manual turns, loaded on first use. */
const appManual = async (): Promise<ManualWaits> => (await import('../agent/app-orchestrators')).sharedOrchestratorContinue()

/** Every window the app's Limits know: Claude's and every other Vendor's. */
const appWindows = async (): Promise<readonly LimitWindow[]> => {
  const [{ appLimits }, { limitWindows }] = await Promise.all([import('../agent/limits'), import('../../shared/agent/limits')])
  const view = appLimits().view()
  return [...limitWindows('claude', view.claude), ...Object.values(view.vendors).flat()]
}

export function autoContinueHandlers(options: AutoContinueHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const store = options.store ?? appSettingsStore
  const known = (projectId: string): void => {
    if (!projects().some((project) => project.id === projectId)) throw new Error(`${projectId} is not a Project of this Machine; Auto-continue is set on the Machine of its Project`)
  }
  const runs = options.runs ?? appRuns
  const manual = options.manual ?? appManual
  const windows = options.windows ?? appWindows
  /** The view of a wait of `source`: the time it goes as `at`, the window by its label. */
  const viewOf = async (wait: ContinueWait | null, source: 'run' | 'manual'): Promise<ContinueWaitView> => {
    if (wait === null) return null
    if (wait.kind === 'retry') return { kind: 'retry', attempt: wait.attempt, of: wait.of, error: wait.error, at: wait.until, source }
    return { kind: 'limits', window: wait.window === null ? null : windowLabel(wait.window, await windows()), at: wait.until, source }
  }
  /** The Project's wait: the run's when it waits, else the manual turn's. */
  const waitOf = async (projectId: string): Promise<ContinueWaitView> => {
    const run = (await runs()).wait(projectId)
    return run !== null ? viewOf(run, 'run') : viewOf((await manual()).wait(projectId), 'manual')
  }
  /** Who waits for the Project: the run first. */
  const waiter = async (projectId: string): Promise<ContinueWaits> => {
    const run = await runs()
    return run.wait(projectId) !== null ? run : manual()
  }
  // The manual waits are followed from the first read of a wait on: before it, no window shows one.
  let following: Promise<void> | null = null
  const follow = (): Promise<void> =>
    (following ??= manual().then((waits) => {
      waits.observeWaits((projectId) => {
        void waitOf(projectId)
          .then((wait) => toEveryWindow((client) => emit(client, autoContinueWaitChanged, { projectId, wait })))
          .catch((error: unknown) => console.warn(`[auto-continue] ${projectId}: could not tell the windows of the wait`, error))
      })
    }))
  return [
    defineHandler(autoContinueRead, ({ projectId }): AutoContinueState => {
      known(projectId)
      return { on: store().autoContinue(projectId) }
    }),
    defineHandler(autoContinueSet, ({ projectId, on }): AutoContinueState => {
      known(projectId)
      const before = store().autoContinue(projectId)
      store().setAutoContinue(projectId, on)
      const after = store().autoContinue(projectId)
      if (after !== before) toEveryWindow((client) => emit(client, autoContinueChanged, { projectId, on: after }))
      return { on: after }
    }),
    defineHandler(autoContinueWait, async ({ projectId }) => {
      known(projectId)
      await follow()
      return waitOf(projectId)
    }),
    defineHandler(autoContinueRetryNow, async ({ projectId }) => {
      known(projectId)
      const waits = await waiter(projectId)
      const wait = waits.wait(projectId)
      // Retry now is for a retry after an API error; a Limits wait has only Cancel.
      if (wait === null || wait.kind !== 'retry') return { done: false }
      return { done: await waits.retryNow(projectId) }
    }),
    defineHandler(autoContinueCancel, async ({ projectId }) => {
      known(projectId)
      return { done: await (await waiter(projectId)).cancel(projectId) }
    }),
  ]
}

export default autoContinueHandlers()
