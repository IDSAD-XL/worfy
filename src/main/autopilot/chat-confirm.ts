// The Orchestrator's canvas tool `autopilot_start` (worfy-flight-recorder ticket 23, ADR-0091): a
// start of Autopilot that an agent asks for in a chat, confirmed by a person first.
//
// - A Session that runs unattended (Autopilot) is refused before any dialog: no one is there to
//   answer it. So is a call whose Session worfy cannot find: no one could tell whether it is. An
//   Orchestrator's Session whose run has stopped and which only waits to be given back (for its turn
//   or its background tasks) is no longer driven by a run: it gets the dialog, and the new run takes
//   it over as it is (Orchestrators.awaitsGiveBack, worfy-polish ticket 50).
// - While a run of the Project goes on, starts or waits for its Orchestrator, the refusal is
//   ChatStarts' own (chatRunningHint), also before any dialog, and nothing reaches the journal. An Epic or a Ticket the Project does not have is refused before
//   the dialog too (startRefusal): no one is asked about a start that cannot happen.
// - The dialog is the Start Autopilot window inside worfy, its "Agent asks" view
//   (src/renderer/autopilot/StartAutopilotModal.tsx; worfy-autopilot-queue ticket 11, owner's
//   decisions 10, 11 and 14 of that spec), no longer a native message box. The ask goes as the event
//   `autopilot.confirm.ask` (src/shared/ipc/autopilot-confirm.ts) to one window of the Machine of the
//   Project, which runs the Session and this tool (dialogOwner); a window that is minimised or hidden
//   is brought back first, and with no worfy window at all the answer is NO_WINDOW_MESSAGE. Only
//   that window's answer (`autopilot.confirm.answer`) counts: a Linked machine's screen is a client
//   without a window (src/main/clients.ts), it gets no ask, and the `local` channels are closed to it.
//   The window names the Project, the Epic, the named Tickets and the Session that asks, and counts
//   down CONFIRM_WAIT_MS (10 minutes, as a Card's `session.ask`); without an answer by then the window
//   gets `autopilot.confirm.close` and the answer is NO_ONE_CONFIRMED. A window closed meanwhile
//   answers NO_WINDOW_MESSAGE. One ask per Project at a time. Nothing guards the window against a
//   click an agent makes in it (owner's decision 14 of the spec, 2026-11-05).
// - The person chooses the Run mode of this run in the window (worfy-resource-planner ticket 06,
//   ADR-0093): Fastest, Budget-aware or Start window, the default of Settings → Autopilot chosen.
//   The focus is on Cancel, so Enter alone starts nothing; Esc is Cancel.
// - The ask carries the Epic forecast (dialogLines, src/shared/autopilot/forecast-lines.ts): the
//   per-Ticket samples and Wave durations of the Project's recent run journals, the Waves left of the
//   same fresh workflow read the start is checked on (only the named Tickets in a run over them), the
//   app's Limits now and the reserve and window of Settings. Journals that cannot be read leave the
//   forecast out; the window still asks.
// - A start goes to startFromChat with `by: 'tool'` and its mode (src/main/autopilot/chat-start.ts),
//   as the command typed in a chat: the same run as the button. While the Orchestrator is busy, also
//   in the turn that asked, the run is accepted and waits for it (WAIT_MESSAGE, worfy-autopilot-queue ticket 07).
import { BrowserWindow } from 'electron'
import { ticketNumber } from '../../shared/actions/render-template'
import type { LimitsState } from '../../shared/agent/limits'
import { budgetFromSettings, type AutopilotBudget } from '../../shared/autopilot/budget'
import { vendorLimitsOf, type VendorLimits } from '../../shared/autopilot/budget-window'
import { epicForecast, remainingWaves } from '../../shared/autopilot/forecast'
import { dialogLines } from '../../shared/autopilot/forecast-lines'
import type { JournalEvent } from '../../shared/autopilot/journal'
import { waveSamples } from '../../shared/autopilot/limits-estimate'
import type { RunMode } from '../../shared/autopilot/run-mode'
import { waveDurationP90 } from '../../shared/autopilot/wave-duration'
import { autopilotConfirmAsk, autopilotConfirmClose, type AutopilotConfirmAnswer } from '../../shared/ipc/autopilot-confirm'
import { autopilotRunOf, type AutopilotRunSettings } from '../../shared/settings/app-settings'
import type { WorkflowModel } from '../../shared/workflow/types'
import { projectStore } from '../projects/store'
import { claudeHome } from '../storage/paths'
import { harnessScriptEnv } from '../harness/script-env'
import { emit, type EventTarget } from '../ipc/index'
import { readWorkflow } from '../workflow/reader'
import type { ChatStartAnswer, ChatStartRequest } from './chat-start'
import { startRefusal } from './run'

/** How long the window waits for a person: as long as a Card's `session.ask` (owner's answer Q2). */
export const CONFIRM_WAIT_MS = 10 * 60_000

/** The answer when the window had no answer in CONFIRM_WAIT_MS. */
export const NO_ONE_CONFIRMED = 'No one confirmed the start of Autopilot within 10 minutes. Nothing started.'

/** The answer when the person chose "Cancel". */
export const CANCELED_MESSAGE = 'The user chose Cancel in the Start Autopilot window: Autopilot did not start.'

/** The answer to a Session that runs unattended: no dialog is shown. */
export const UNATTENDED_MESSAGE = 'No one is at this Session to confirm a start of Autopilot: it runs unattended (worfy Autopilot). Nothing started.'

/** The answer when worfy cannot tell which Session asked, so cannot tell whether a person is there. */
export const UNKNOWN_SESSION_MESSAGE = 'worfy cannot tell which Session asked, so no one can confirm a start of Autopilot. Nothing started.'

/** The answer while a dialog of this Project waits already. */
export const CONFIRM_PENDING_MESSAGE = 'A start of Autopilot in this Project already waits for the user to confirm it. Nothing started.'

/** The answer when the Project's Machine has no worfy window to put the dialog on. */
export const NO_WINDOW_MESSAGE = "No worfy window is open on the Project's Machine, so no one can confirm a start of Autopilot. Nothing started."

/** The answer when the window was open for another start already, so the ask was not shown. */
export const WINDOW_OCCUPIED_MESSAGE = 'The Start Autopilot window of worfy is open for another start, so this one was not shown. Nothing started.'

/** What the window names. */
export interface AutopilotPrompt {
  projectId: string
  /** The Project's name, as its list shows it. */
  project: string
  epic: string
  /** The named Tickets; absent: the whole Epic. */
  tickets?: readonly number[] | undefined
  /** The id of the Session that asks. */
  session: string
  /** The default Run mode of Settings → Autopilot, chosen when the window opens. */
  mode: RunMode
  /** The forecast lines of the start (dialogLines); empty: none. */
  forecast: readonly string[]
}

/**
 * What became of the ask: the Run mode the person started in, or why nothing starts; 'no-window':
 * there was no window to show it on, or it closed; 'occupied': the window was busy with another start.
 */
export type Confirmation = RunMode | 'cancel' | 'timeout' | 'no-window' | 'occupied'

const ticketsText = (tickets: readonly number[]): string => `${tickets.length === 1 ? 'Ticket' : 'Tickets'} ${tickets.map(ticketNumber).join(', ')}`

/** A window of this Machine as an ask uses it: its page gets the events, and its close ends the ask. */
export interface AskWindow {
  readonly webContents: EventTarget & { readonly id: number; isDestroyed(): boolean }
  isDestroyed(): boolean
  once(event: 'closed', listener: () => void): unknown
  removeListener(event: 'closed', listener: () => void): unknown
}

/** An ask a window has not answered yet. */
interface PendingAsk {
  /** The webContents id of the window asked: only its answer counts. */
  sender: number
  done(answer: Confirmation): void
}

/**
 * The asks in the windows of this Machine: each goes to one window as `autopilot.confirm.ask` and
 * waits for that window's `autopilot.confirm.answer`. After `waitMs` the window gets
 * `autopilot.confirm.close` and the answer is 'timeout'; a window closed meanwhile answers 'no-window'.
 */
export class WindowAsks {
  private readonly pending = new Map<string, PendingAsk>()
  private made = 0

  constructor(private readonly waitMs: number = CONFIRM_WAIT_MS) {}

  ask(owner: AskWindow, prompt: AutopilotPrompt): Promise<Confirmation> {
    if (owner.isDestroyed() || owner.webContents.isDestroyed()) return Promise.resolve('no-window')
    this.made += 1
    const id = `ask-${this.made}`
    return new Promise<Confirmation>((resolve) => {
      const finish = (answer: Confirmation): void => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        clearTimeout(timer)
        owner.removeListener('closed', onClosed)
        resolve(answer)
      }
      const onClosed = (): void => finish('no-window')
      const timer = setTimeout(() => {
        if (!owner.webContents.isDestroyed()) emit(owner.webContents, autopilotConfirmClose, { id })
        finish('timeout')
      }, this.waitMs)
      this.pending.set(id, { sender: owner.webContents.id, done: finish })
      owner.once('closed', onClosed)
      emit(owner.webContents, autopilotConfirmAsk, {
        id,
        projectId: prompt.projectId,
        project: prompt.project,
        epic: prompt.epic,
        ...(prompt.tickets === undefined || prompt.tickets.length === 0 ? {} : { tickets: [...prompt.tickets] }),
        session: prompt.session,
        mode: prompt.mode,
        forecast: [...prompt.forecast],
        waitMs: this.waitMs,
      })
    })
  }

  /**
   * The answer of the window whose webContents id is `sender` to ask `id`. An ask that is over (its
   * time was up, its window closed) takes it and changes nothing; another window's answer is refused.
   */
  answer(id: string, answer: AutopilotConfirmAnswer, sender: number): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    if (pending.sender !== sender) throw new Error('This window was not asked to confirm this start of Autopilot')
    pending.done(answer)
  }
}

let appAsks: WindowAsks | null = null

/** The asks of the app, one for every Session and every window. */
export function sharedWindowAsks(): WindowAsks {
  appAsks ??= new WindowAsks()
  return appAsks
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
  /** Whether the Session is an Orchestrator's whose run has stopped and which only waits to be given back (Orchestrators.awaitsGiveBack). */
  awaitsGiveBack(sessionId: string): boolean
  /** Why a start from a chat is refused now: a run of the Project under way, starting or waiting for its Orchestrator (ChatStarts.busyRefusal); null when none. */
  busy(projectId: string): string | null
  /** A fresh read of the Project's Epics and Tickets. */
  workflow(projectId: string): Promise<Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>>
  /** The Project's name, as its list shows it. */
  projectName(projectId: string): string
  /** Asks the person in a window of this Machine (WindowAsks.ask on dialogOwner). */
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
  /**
   * The Vendor of the Project's Orchestrator and its windows when it is not Claude (worfy-multi-vendor
   * ticket 38): the samples and the lines are that Vendor's. Absent or undefined: Claude.
   */
  vendor?(projectId: string): VendorLimits | undefined
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
  const vendor = sources.vendor?.(projectId)
  const forecast = epicForecast({ samples: waveSamples(runs, vendor?.vendor), waves: remainingWaves(model.tickets, epic, tickets) })
  return dialogLines({ forecast, wave: waveDurationP90(runs), limits: sources.limits(), now: sources.now(), reserve: settings.budget.reserve, window: settings.run.window, ...(vendor === undefined ? {} : { vendor }) })
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
    if (unattended && !deps.awaitsGiveBack(session)) throw new Error(UNATTENDED_MESSAGE)
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
      const answer = await deps.confirm({ projectId, project: deps.projectName(projectId), epic, ...(tickets === undefined ? {} : { tickets }), session, mode: settings.run.mode, forecast })
      if (answer === 'no-window') throw new Error(NO_WINDOW_MESSAGE)
      if (answer === 'occupied') throw new Error(WINDOW_OCCUPIED_MESSAGE)
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
 * journals, Limits and Settings of the forecast, and the Start Autopilot window of this Machine. The Autopilot module and the registry are loaded on the
 * first call: they load the canvas server, which loads this module.
 */
export function appAutopilotStarter(): AutopilotStarter {
  let tool: Promise<AutopilotStarter> | null = null
  const load = async (): Promise<AutopilotStarter> => {
    const [{ sharedChatStarts }, { sharedRegistry }, { sharedOrchestrators }, { appLimits }, { appSettingsStore }, { readRecentRuns }] = await Promise.all([
      import('../ipc/autopilot'),
      import('../agent/app-registry'),
      import('../agent/app-orchestrators'),
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
      awaitsGiveBack: (sessionId) => sharedOrchestrators().awaitsGiveBack(sessionId),
      busy: (projectId) => sharedChatStarts().busyRefusal(projectId),
      workflow: async (projectId) => (await readWorkflow({ root: projectStore().get(projectId).path, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
      projectName: (projectId) => projectStore().get(projectId).name,
      confirm: (prompt) => {
        const owner = dialogOwner()
        return owner === null ? Promise.resolve('no-window') : sharedWindowAsks().ask(owner, prompt)
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
        // As appVendorLimits of the button's estimate (ipc/autopilot.ts): the Vendor the Project's Orchestrator runs on.
        vendor: (projectId) => {
          const vendor = sharedOrchestrators().runsOn(projectId)
          return vendorLimitsOf(vendor, appLimits().windowsOf(vendor))
        },
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
