// The Orchestrator's canvas tool `autopilot_start` (worfy-flight-recorder ticket 23, ADR-0091): a
// start of Autopilot that an agent asks for in a chat, confirmed by a person first.
//
// - A Session that runs unattended (Autopilot) is refused before any dialog: no one is there to
//   answer it. So is a call whose Session worfy cannot find: no one could tell whether it is.
// - While a run of the Project goes on, or a start from a chat waits for the Orchestrator's turn to
//   end, the refusal is ChatStarts' own (chatRunningHint, chatWaitingHint), also before any dialog,
//   and nothing reaches the journal. An Epic or a Ticket the Project does not have is refused before
//   the dialog too (startRefusal): no one is asked about a start that cannot happen.
// - The dialog is a native message box of the main process on the Machine of the Project, which runs
//   the Session and this tool (owner's answer Q2). It always has a parent window (dialogOwner): on
//   macOS a box without one runs synchronously, blocks the main process until a click, and its
//   signal cannot close it (Electron's MessageBoxOptions.signal). A window that is minimised or
//   hidden is brought back first; with no worfy window at all the answer is NO_WINDOW_MESSAGE. A
//   Linked machine's screen is a client without a window (src/main/clients.ts): it gets no dialog,
//   and no channel lets it answer one. The dialog names the Project, the Epic and the named
//   Tickets. Without an answer in CONFIRM_WAIT_MS the dialog closes and the answer is
//   NO_ONE_CONFIRMED. One dialog per Project at a time.
// - The person chooses the Run mode of this run in the dialog (worfy-resource-planner ticket 06,
//   ADR-0093): "Start: Fastest", "Start: Budget-aware", "Start: Start window" (RUN_MODES, in that
//   order), then "Cancel"; the default mode of Settings → Autopilot ends with " (default)". Cancel is
//   the default button and the cancel button, so Enter or Escape alone start nothing.
// - The dialog's `detail` has the Epic forecast (dialogLines, src/shared/autopilot/forecast-lines.ts)
//   after its first paragraph: the per-Ticket samples and Wave durations of the Project's recent run
//   journals, the Waves left of the same fresh workflow read the start is checked on (only the named
//   Tickets in a run over them), the app's Limits now and the reserve and window of Settings. Journals
//   that cannot be read leave the forecast out; the dialog still asks.
// - A start button goes to startFromChat with `by: 'tool'` and its mode (src/main/autopilot/chat-start.ts),
//   as the command typed in a chat: the same run as the button. Asked from the turn of the
//   Project's own Orchestrator, the run starts after that turn (AFTER_TURN_MESSAGE).
import { BrowserWindow, dialog, type Dialog, type MessageBoxOptions } from 'electron'
import { ticketNumber } from '../../shared/actions/render-template'
import type { LimitsState } from '../../shared/agent/limits'
import { budgetFromSettings, type AutopilotBudget } from '../../shared/autopilot/budget'
import { epicForecast, remainingWaves } from '../../shared/autopilot/forecast'
import { dialogLines } from '../../shared/autopilot/forecast-lines'
import type { JournalEvent } from '../../shared/autopilot/journal'
import { waveSamples } from '../../shared/autopilot/limits-estimate'
import { RUN_MODE_LABELS, RUN_MODES, type RunMode } from '../../shared/autopilot/run-mode'
import { waveDurationP90 } from '../../shared/autopilot/wave-duration'
import { autopilotRunOf, type AutopilotRunSettings } from '../../shared/settings/app-settings'
import type { WorkflowModel } from '../../shared/workflow/types'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { harnessScriptEnv } from '../harness/script-env'
import { readWorkflow } from '../workflow/reader'
import type { ChatStartAnswer, ChatStartRequest } from './chat-start'
import { startRefusal } from './run'

/** How long the dialog waits for a person: as long as a Card's `session.ask` (owner's answer Q2). */
export const CONFIRM_WAIT_MS = 10 * 60_000

/** The button that starts the run in `mode`; the default mode of Settings is marked. */
export const startButton = (mode: RunMode, defaultMode: RunMode): string => `Start: ${RUN_MODE_LABELS[mode]}${mode === defaultMode ? ' (default)' : ''}`

/** "Cancel": the button after the start buttons, one per mode. */
const CANCEL_ID = RUN_MODES.length

/** The answer when the dialog had no answer in CONFIRM_WAIT_MS. */
export const NO_ONE_CONFIRMED = 'No one confirmed the start of Autopilot within 10 minutes. Nothing started.'

/** The answer when the person chose "Cancel". */
export const CANCELED_MESSAGE = 'The user chose Cancel in the dialog: Autopilot did not start.'

/** The answer to a Session that runs unattended: no dialog is shown. */
export const UNATTENDED_MESSAGE = 'No one is at this Session to confirm a start of Autopilot: it runs unattended (worfy Autopilot). Nothing started.'

/** The answer when worfy cannot tell which Session asked, so cannot tell whether a person is there. */
export const UNKNOWN_SESSION_MESSAGE = 'worfy cannot tell which Session asked, so no one can confirm a start of Autopilot. Nothing started.'

/** The answer while a dialog of this Project waits already. */
export const CONFIRM_PENDING_MESSAGE = 'A start of Autopilot in this Project already waits for the user to confirm it. Nothing started.'

/** The answer when the Project's Machine has no worfy window to put the dialog on. */
export const NO_WINDOW_MESSAGE = "No worfy window is open on the Project's Machine, so no one can confirm a start of Autopilot. Nothing started."

/** What the dialog names. */
export interface AutopilotPrompt {
  /** The Project's name, as its list shows it. */
  project: string
  epic: string
  /** The named Tickets; absent: the whole Epic. */
  tickets?: readonly number[] | undefined
  /** The default Run mode of Settings → Autopilot, marked on its button. */
  mode: RunMode
  /** The forecast lines of the detail (dialogLines); empty: none. */
  forecast: readonly string[]
}

/** What became of the dialog: the Run mode of the start button chosen, or why nothing starts; 'no-window': there was no window to show it on. */
export type Confirmation = RunMode | 'cancel' | 'timeout' | 'no-window'

const ticketsText = (tickets: readonly number[]): string => `${tickets.length === 1 ? 'Ticket' : 'Tickets'} ${tickets.map(ticketNumber).join(', ')}`

/**
 * The message box: a start button per Run mode, in the order of RUN_MODES, then Cancel, the default,
 * so Enter alone starts nothing. The forecast lines go between the first paragraph and the last.
 */
export function confirmationOptions(prompt: AutopilotPrompt): MessageBoxOptions {
  const named = prompt.tickets !== undefined && prompt.tickets.length > 0 ? prompt.tickets : null
  const what = named === null ? `Epic "${prompt.epic}"` : `${ticketsText(named)} of Epic "${prompt.epic}"`
  const paragraphs = [
    `An agent asked for it in a chat. Autopilot then runs the ${named === null ? "Epic's" : 'named'} Waves without asking anyone, as the Autopilot button does.`,
    ...(prompt.forecast.length === 0 ? [] : [prompt.forecast.join('\n')]),
    'Without an answer in 10 minutes nothing starts.',
  ]
  return {
    type: 'question',
    buttons: [...RUN_MODES.map((mode) => startButton(mode, prompt.mode)), 'Cancel'],
    defaultId: CANCEL_ID,
    cancelId: CANCEL_ID,
    title: 'Start Autopilot',
    message: `Start Autopilot on ${what} in Project "${prompt.project}"?`,
    detail: paragraphs.join('\n\n'),
    noLink: true,
  }
}

/**
 * Asks the person with a message box on `owner`, a window of this Machine; never without one (see
 * the top of the file). After `waitMs` the box is closed and the answer is 'timeout'.
 */
export async function confirmAutopilotStart(owner: BrowserWindow, prompt: AutopilotPrompt, box: Pick<Dialog, 'showMessageBox'> = dialog, waitMs: number = CONFIRM_WAIT_MS): Promise<Confirmation> {
  const closer = new AbortController()
  const options = { ...confirmationOptions(prompt), signal: closer.signal }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<Confirmation>((done) => {
    timer = setTimeout(() => {
      closer.abort()
      done('timeout')
    }, waitMs)
  })
  const answered = box.showMessageBox(owner, options).then(({ response }): Confirmation => RUN_MODES[response] ?? 'cancel')
  try {
    // The box closed by the abort answers its cancelId too: the race has gone to the timer by then.
    return await Promise.race([answered, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/** The windows of this Machine as dialogOwner reads them. */
export interface LocalWindows {
  getFocusedWindow(): BrowserWindow | null
  getAllWindows(): BrowserWindow[]
}

/**
 * The window of this Machine the dialog goes on: the focused one when it is on screen, else the
 * first one on screen, else the first one there is, restored and shown first; null when worfy has
 * no window (macOS keeps the app running without one).
 */
export function dialogOwner(windows: LocalWindows = BrowserWindow): BrowserWindow | null {
  const onScreen = (window: BrowserWindow): boolean => window.isVisible() && !window.isMinimized()
  const focused = windows.getFocusedWindow()
  if (focused !== null && !focused.isDestroyed() && onScreen(focused)) return focused
  const live = windows.getAllWindows().filter((window) => !window.isDestroyed())
  const shown = live.find(onScreen)
  if (shown !== undefined) return shown
  const [first] = live
  if (first === undefined) return null
  if (first.isMinimized()) first.restore()
  first.show()
  return first
}

/** A call of the tool, as the canvas server of one Session makes it. */
export interface AutopilotToolRequest {
  projectId: string
  epic: string
  /** The named Tickets; absent: the whole Epic. */
  tickets?: readonly number[] | undefined
  /** The calling Session's id (the SDK id, which the Session registry keys it by); null before it is known. */
  session: string | null
}

export interface AutopilotToolDeps {
  /** Whether the Session runs unattended now; null when the app has no such Session. */
  unattended(sessionId: string): boolean | null
  /** Why a start from a chat is refused now: a run under way or starting, or a start waiting for a turn's end (ChatStarts.busyRefusal); null when none. */
  busy(projectId: string): string | null
  /** A fresh read of the Project's Epics and Tickets. */
  workflow(projectId: string): Promise<Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>>
  /** The Project's name, as its list shows it. */
  projectName(projectId: string): string
  /** Asks the person on a window of this Machine (confirmAutopilotStart on dialogOwner). */
  confirm(prompt: AutopilotPrompt): Promise<Confirmation>
  /** The start from a chat (ChatStarts.startFromChat). */
  startFromChat(request: ChatStartRequest): Promise<ChatStartAnswer>
  /** What the dialog's forecast and its default mode read. */
  forecast: ForecastSources
}

/** What the dialog's forecast and its default mode read (worfy-resource-planner ticket 06). */
export interface ForecastSources {
  /** The events of the Project's recent runs, one list per journal (readRecentRuns); a rejection leaves the forecast out. */
  runs(projectId: string): Promise<JournalEvent[][]>
  /** The app's Limits now. */
  limits(): LimitsState
  /** Settings → Autopilot: the default Run mode and the Start window, and the budget with its reserve. */
  settings(): { run: AutopilotRunSettings; budget: AutopilotBudget }
  now(): number
}

/** The forecast lines of the dialog for `epic` (only the named Tickets when there are any); none when the journals cannot be read. */
async function forecastLines(sources: ForecastSources, projectId: string, model: Pick<WorkflowModel, 'tickets'>, epic: string, tickets: readonly number[] | undefined, settings: ReturnType<ForecastSources['settings']>): Promise<string[]> {
  let runs: JournalEvent[][]
  try {
    runs = await sources.runs(projectId)
  } catch (error) {
    console.warn(`[autopilot] ${projectId}: the start dialog shows no forecast, the run journals cannot be read`, error)
    return []
  }
  const forecast = epicForecast({ samples: waveSamples(runs), waves: remainingWaves(model.tickets, epic, tickets) })
  return dialogLines({ forecast, wave: waveDurationP90(runs), limits: sources.limits(), now: sources.now(), reserve: settings.budget.reserve, window: settings.run.window })
}

/** Answers a call of the tool: the text of a start, or throws the refusal. */
export type AutopilotStarter = (request: AutopilotToolRequest) => Promise<string>

/** The tool over `deps`; one dialog per Project at a time. */
export function autopilotStarter(deps: AutopilotToolDeps): AutopilotStarter {
  const asking = new Set<string>()
  return async ({ projectId, epic, tickets, session }) => {
    if (session === null) throw new Error(UNKNOWN_SESSION_MESSAGE)
    const unattended = deps.unattended(session)
    if (unattended === null) throw new Error(UNKNOWN_SESSION_MESSAGE)
    if (unattended) throw new Error(UNATTENDED_MESSAGE)
    const busy = deps.busy(projectId)
    if (busy !== null) throw new Error(busy)
    if (asking.has(projectId)) throw new Error(CONFIRM_PENDING_MESSAGE)
    asking.add(projectId)
    try {
      const model = await deps.workflow(projectId)
      if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
      const refusal = startRefusal(model, epic, tickets)
      if (refusal !== null) throw new Error(refusal)
      const settings = deps.forecast.settings()
      const forecast = await forecastLines(deps.forecast, projectId, model, epic, tickets, settings)
      const answer = await deps.confirm({ project: deps.projectName(projectId), epic, ...(tickets === undefined ? {} : { tickets }), mode: settings.run.mode, forecast })
      if (answer === 'no-window') throw new Error(NO_WINDOW_MESSAGE)
      if (answer === 'timeout') throw new Error(NO_ONE_CONFIRMED)
      if (answer === 'cancel') throw new Error(CANCELED_MESSAGE)
      const started = await deps.startFromChat({ projectId, epic, ...(tickets === undefined ? {} : { tickets }), by: 'tool', session, mode: answer })
      if (started.kind === 'refused') throw new Error(started.message)
      if (started.kind === 'after-turn') return started.message
      return `Autopilot started ${tickets === undefined ? `Epic ${epic}` : `${ticketsText(tickets)} of Epic ${epic}`}.`
    } finally {
      asking.delete(projectId)
    }
  }
}

/**
 * The app's tool: the Session registry, the app's starts from a chat, the Project list, the run
 * journals, Limits and Settings of the forecast, and a message box on a window of this Machine. The Autopilot module and the registry are loaded on the
 * first call: they load the canvas server, which loads this module.
 */
export function appAutopilotStarter(): AutopilotStarter {
  let tool: Promise<AutopilotStarter> | null = null
  const load = async (): Promise<AutopilotStarter> => {
    const [{ sharedChatStarts }, { sharedRegistry }, { appLimits }, { appSettingsStore }, { readRecentRuns }] = await Promise.all([
      import('../ipc/autopilot'),
      import('../agent/app-registry'),
      import('../agent/limits'),
      import('../settings/store'),
      import('./journal'),
    ])
    return autopilotStarter({
      unattended: (sessionId) => {
        try {
          return sharedRegistry().get(sessionId).unattended
        } catch {
          return null
        }
      },
      busy: (projectId) => sharedChatStarts().busyRefusal(projectId),
      workflow: async (projectId) => (await readWorkflow({ root: projectStore().get(projectId).path, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
      projectName: (projectId) => projectStore().get(projectId).name,
      confirm: (prompt) => {
        const owner = dialogOwner()
        return owner === null ? Promise.resolve('no-window') : confirmAutopilotStart(owner, prompt)
      },
      startFromChat: (request) => sharedChatStarts().startFromChat(request),
      // The same sources as the button's estimate (autopilot.estimate) and the run's start.
      forecast: {
        runs: (projectId) => readRecentRuns(projectId),
        limits: () => appLimits().snapshot(),
        settings: () => {
          const settings = appSettingsStore().get()
          return { run: autopilotRunOf(settings), budget: budgetFromSettings(settings) }
        },
        now: () => Date.now(),
      },
    })
  }
  return async (request) => {
    // A load that failed is tried again by the next call.
    tool ??= load().catch((error: unknown) => {
      tool = null
      throw error
    })
    return (await tool)(request)
  }
}
