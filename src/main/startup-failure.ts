// What happens when worfy cannot start: one native error window that says which step of the
// start failed, the error, what to try and where worfy keeps its data, then exit code 1. Every
// step of the start in src/main/index.ts runs inside inStep(), and the window's page load
// (src/main/window.ts) reports here too, so no failure of the start ends as a Dock icon without a
// window or as an unhandled rejection.
import { accessSync, constants, statSync } from 'node:fs'
import { app, dialog } from 'electron'
import { dataRoot } from './storage/paths'

/** The steps of the start, in order. The names are the functions src/main/index.ts calls. */
export type StartupStep =
  | 'checkDataFolder'
  | 'installAppMenu'
  | 'registerIpc'
  | 'installWebPolicy'
  | 'installCardRuntime'
  | 'startOrchestrators'
  | 'installNotifications'
  | 'createMainWindow'
  | 'loadURL'
  | 'loadFile'

/** Title of the error window. */
export const STARTUP_FAILURE_TITLE = 'worfy could not start'

/**
 * Set to `off` to skip the error window and only write the text to stderr. The window is modal
 * and blocks the process until it is dismissed; an e2e test cannot dismiss a native window.
 */
export const STARTUP_DIALOG_ENV = 'WORFY_STARTUP_DIALOG'

const REINSTALL = 'This looks like a bug in this build of worfy. Install worfy again or rebuild it from main; if it keeps failing, report the error above.'

const STEPS: Record<StartupStep, { doing: string; advice: string }> = {
  checkDataFolder: {
    doing: 'checking the data folder',
    advice: 'Make sure the data folder below is a folder (not a file) and that you can write to it. If WORFY_DATA_DIR is set, point it at such a folder.',
  },
  installAppMenu: { doing: 'installing the app menu', advice: REINSTALL },
  registerIpc: {
    doing: 'registering the handlers the window calls',
    advice: `A handler module failed to load or a channel is handled twice. ${REINSTALL}`,
  },
  installWebPolicy: { doing: 'installing the web policy for pages and Cards', advice: REINSTALL },
  installCardRuntime: { doing: 'installing the Card runtime', advice: REINSTALL },
  startOrchestrators: { doing: 'starting the Orchestrators', advice: REINSTALL },
  installNotifications: { doing: 'installing notifications', advice: REINSTALL },
  createMainWindow: { doing: 'creating the main window', advice: REINSTALL },
  loadURL: {
    doing: 'loading the window from the dev server',
    advice: 'Make sure the dev server is running (`pnpm dev` starts it) and start worfy again.',
  },
  loadFile: {
    doing: 'loading the window from the app bundle',
    advice: `The app bundle may be incomplete. ${REINSTALL}`,
  },
}

/** A failure inside one step of the start; reportStartupFailure names the step. */
export class StartupError extends Error {
  constructor(
    readonly step: StartupStep,
    readonly reason: unknown,
  ) {
    super(`${step} failed: ${errorText(reason)}`)
    this.name = 'StartupError'
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs one step of the start. A throw, or the rejection of the promise the step returns, comes
 * out as a StartupError naming the step; a StartupError from a nested step keeps its own name.
 */
export function inStep<T>(step: StartupStep, run: () => T): T {
  const wrap = (error: unknown): StartupError => (error instanceof StartupError ? error : new StartupError(step, error))
  let result: T
  try {
    result = run()
  } catch (error) {
    throw wrap(error)
  }
  if (result instanceof Promise) {
    return result.catch((error: unknown) => {
      throw wrap(error)
    }) as T
  }
  return result
}

/** The text of the error window: the step, the error, what to try, the data folder. */
export function startupFailureText(step: StartupStep | undefined, error: unknown, dataFolder: string): string {
  const what = step === undefined ? 'An unexpected step of the start failed.' : `Step: ${step} (${STEPS[step].doing}) failed.`
  const advice = step === undefined ? REINSTALL : STEPS[step].advice
  return [what, '', `Error: ${errorText(error)}`, '', `What to try: ${advice}`, '', `worfy's data folder: ${dataFolder}`].join('\n')
}

let reported = false

/**
 * Reports a failed start and ends the process with exit code 1. `error` is a StartupError from
 * inStep(), or any error with the step given separately. Only the first failure opens the window:
 * a second one (the page load failing after a later step already did) goes to stderr only.
 *
 * app.exit(1), not app.quit(): quit() has no exit code, so the failure would look like a normal
 * quit to whatever started worfy, and its `before-quit` / `will-quit` handlers (stores flushing,
 * Sessions closing, terminals waiting for their shells) were written for an app that started,
 * not for one that stopped halfway. Nothing worth saving exists yet when the start fails.
 */
export function reportStartupFailure(error: unknown, step?: StartupStep): void {
  const failedStep = error instanceof StartupError ? error.step : step
  const reason = error instanceof StartupError ? error.reason : error
  const text = startupFailureText(failedStep, reason, dataRoot())
  console.error(`[worfy] ${STARTUP_FAILURE_TITLE}\n${text}`)
  if (reason instanceof Error && reason.stack) console.error(reason.stack)
  if (reported) return
  reported = true
  if (process.env[STARTUP_DIALOG_ENV] !== 'off') dialog.showErrorBox(STARTUP_FAILURE_TITLE, text)
  app.exit(1)
}

/**
 * The first step of the start: the data folder is a folder worfy may write to, or does not exist
 * yet (Electron creates it). Only reads: worfy's own folder is created by Electron, and a test
 * that imports src/main/index.ts must not create anything under the real home folder.
 */
export function checkDataFolder(folder: string): void {
  let isFolder: boolean
  try {
    isFolder = statSync(folder).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (!isFolder) throw new Error(`${folder} is a file, not a folder`)
  accessSync(folder, constants.W_OK)
}
