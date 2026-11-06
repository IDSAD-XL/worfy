// The Start Autopilot window (worfy-autopilot-queue ticket 09), outside React: which start it asks about,
// if any. The Autopilot button of an Epic frame (canvas/actions/AutopilotAction.tsx) asks through
// askStart and waits for the answer; StartAutopilotModal.tsx, mounted once in the shell (AppShell.tsx),
// shows the window. One window at a time: a second ask while one is open is answered at once with
// nothing started, the open one stays.
//
// An agent's `autopilot_start` opens the same window (worfy-autopilot-queue ticket 11, view "Agent
// asks"): main sends `autopilot.confirm.ask` to one window of its Machine (src/main/autopilot/chat-confirm.ts),
// askFromAgent opens it with the Session that asks and the time left, and the window's choice goes back
// as `autopilot.confirm.answer` — the Run mode, `cancel`, or `occupied` when a window was open already.
// `autopilot.confirm.close` (the time is up in main) shows "time is up" (agentTimeUp); nothing is answered then.
//
// "Run all accepted" of the Command palette (worfy-autopilot-queue ticket 16, runAllAccepted) opens the
// window over the Project's accepted Epics (acceptedEpics: the owner accepted the spec, a Ticket is ready),
// oldest acceptance first, in its "Queue" view; the person unticks and reorders them there, and the start
// goes to main with the ticked Epics in that order (`autopilot.start` with `epics`). With no accepted Epic,
// a toast says so and no window opens. An agent's ask with a list of Epics (ticket 15) shows the same
// view, its order fixed: the answer to main carries only the Run mode.
//
// "change in Modes" of the window (openOrchestratorModes) shows the Session view of the Project's
// Orchestrator and opens the Modes menu under its input field (session/composer/Modes.tsx).
import { create } from 'zustand'
import { MAX_QUEUE_EPICS } from '../../shared/autopilot/epic-queue'
import type { RunMode } from '../../shared/autopilot/run-mode'
import type { AutopilotConfirmAnswer, AutopilotConfirmAsk } from '../../shared/ipc/autopilot-confirm'
import { failureReason } from '../../shared/ipc/channels'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { acceptedEpics } from '../../shared/workflow/accepted-epics'
import type { WorkflowModel } from '../../shared/workflow/types'
import { currentLayout } from '../canvas/useLayout'
import { invoke, readableReason } from '../ipc'
import { openSession } from '../session/navigation'
import { showToast } from '../toast/toasts'

/** A start the window asks about. */
export interface StartRequest {
  projectId: string
  /** The Epics of the run, in order; one from the Autopilot button. */
  epics: readonly string[]
  /** Named Tickets of a run over one Epic; absent: the whole Epic. */
  tickets?: readonly number[]
  /** Where the ask comes from: the Autopilot button on the Canvas, an agent's `autopilot_start`, or "Run all accepted" of the Command palette. */
  from: 'canvas' | 'agent' | 'accepted'
  /** An agent's ask: the Session that asks and when main stops waiting (Date.now() time). */
  agent?: { id: string; session: string; deadline: number }
  /**
   * Starts the run in `mode` over `epics`: the Epics the person left ticked in the window, in its order
   * (`epics` of the request when the window shows no queue). Resolves to main's reason when the start was
   * refused, undefined when it went (or waits for the Orchestrator).
   */
  start(mode: RunMode, epics: readonly string[]): Promise<string | undefined>
  /** Told when the window closes without a start (Cancel, Esc, "change in Modes"); absent: nothing to tell. */
  cancel?(): void
}

/** The open window: its request, and how its asker learns the end. */
export interface OpenStart extends StartRequest {
  /** Grows with every window: a new window is a new component, with nothing kept from the one before. */
  id: number
  /** Ends the ask: the reason of a refused start, undefined after Cancel or a start that went. */
  settle(reason: string | undefined): void
  /** An agent's ask whose time is up in main: the window says so, starts nothing and closes. */
  timeUp?: true
}

export const useStartModal = create<{ open: OpenStart | null }>(() => ({ open: null }))

let made = 0

/**
 * Opens the window for `request`; resolves when it closes: with main's reason when the start was
 * refused, undefined after Cancel or a start that went. While a window is open, a second ask opens
 * nothing and resolves at once.
 */
export function askStart(request: StartRequest): Promise<string | undefined> {
  if (useStartModal.getState().open !== null) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    made += 1
    const id = made
    useStartModal.setState({
      open: {
        ...request,
        id,
        settle: (reason) => {
          // Only this window's end closes it.
          if (useStartModal.getState().open?.id === id) useStartModal.setState({ open: null })
          resolve(reason)
        },
      },
    })
  })
}

/** Sends the window's answer to the agent's ask `id`; resolves to the reason when main did not take it. */
async function answerAsk(id: string, answer: AutopilotConfirmAnswer): Promise<string | undefined> {
  const result = await invoke('autopilot.confirm.answer', { id, answer })
  return result.ok ? undefined : readableReason(failureReason('autopilot.confirm.answer', result.error))
}

/**
 * Opens the window for an agent's ask from main. While a window is open already, the ask is answered
 * `occupied` at once and the open window stays.
 */
export function askFromAgent(ask: AutopilotConfirmAsk, now: () => number = Date.now): void {
  if (useStartModal.getState().open !== null) {
    void answerAsk(ask.id, 'occupied')
    return
  }
  void askStart({
    projectId: ask.projectId,
    epics: ask.epics ?? [ask.epic],
    ...(ask.tickets === undefined ? {} : { tickets: ask.tickets }),
    from: 'agent',
    agent: { id: ask.id, session: ask.session, deadline: now() + ask.waitMs },
    start: (mode) => answerAsk(ask.id, mode),
    cancel: () => void answerAsk(ask.id, 'cancel'),
  })
}

/** Main stopped waiting for ask `id`: its window, if open, says the time is up. */
export function agentTimeUp(id: string): void {
  const { open } = useStartModal.getState()
  if (open?.agent?.id === id && open.timeUp !== true) useStartModal.setState({ open: { ...open, timeUp: true } })
}

/** The key and `data-testid` of the toast of a refused start: the Autopilot button's (canvas/actions/AutopilotAction.tsx), so either replaces the other. */
const START_REFUSED_TOAST = 'autopilot-start-refused'

/** A refused start of the queue: an error toast with main's reason, as the Autopilot button's; returns the reason. */
function refused(projectId: string, reason: string): string {
  showToast({ kind: 'error', key: `${START_REFUSED_TOAST}:${projectId}`, testId: START_REFUSED_TOAST, projectId, text: reason })
  return reason
}

/**
 * Starts a run over `epics` of the Project, in order, in `mode`; resolves to main's reason when it was
 * refused (a toast says it too). The Autopilot line of the Epic frame learns the run from main's
 * `autopilot.changed`.
 */
export async function startQueue(projectId: string, epics: readonly string[], mode: RunMode): Promise<string | undefined> {
  const [epic] = epics
  if (epic === undefined) return 'No Epic is ticked'
  const result = await invoke('autopilot.start', { projectId, epic, ...(epics.length > 1 ? { epics: [...epics] } : {}), mode })
  if (!result.ok) return refused(projectId, failureReason('autopilot.start', result.error))
  if ('runningElsewhere' in result.value) return refused(projectId, result.value.runningElsewhere.message)
  return undefined
}

/** The toast of "Run all accepted" when no Epic is accepted with a ready Ticket. */
export const NO_ACCEPTED_TEXT = 'No accepted Epic has a ready Ticket'
const NO_ACCEPTED_TOAST = 'autopilot-no-accepted'

/**
 * "Run all accepted": the Start Autopilot window over the accepted Epics of `model`, oldest acceptance
 * first; a toast when there is none. Returns at once: the window does the rest.
 */
export function runAllAccepted(projectId: string, model: WorkflowModel): undefined {
  // shortcut: past MAX_QUEUE_EPICS accepted Epics the window offers the oldest ones only (a run takes no
  // more); when a Project has that many waiting, let the window pick from all of them.
  const epics = acceptedEpics(model)
    .map((each) => each.epic)
    .slice(0, MAX_QUEUE_EPICS)
  if (epics.length === 0) {
    showToast({ kind: 'info', key: `${NO_ACCEPTED_TOAST}:${projectId}`, testId: NO_ACCEPTED_TOAST, projectId, text: NO_ACCEPTED_TEXT })
    return undefined
  }
  void askStart({ projectId, epics, from: 'accepted', start: (mode, chosen) => startQueue(projectId, chosen, mode) })
  return undefined
}

/** How long "change in Modes" looks for the Modes button of the Orchestrator's Session view. */
const MODES_WAIT_MS = 2000

/**
 * Shows the Session view of the Project's Orchestrator and opens its Modes menu. Without an
 * Orchestrator Node in the Layout, nothing happens.
 */
export function openOrchestratorModes(projectId: string): void {
  const node = currentLayout(projectId)?.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)
  if (node === undefined) return
  openSession({ nodeId: node.id, projectId })
  // shortcut: the menu is opened by a click on its button once the Session view has drawn it, found in
  // the DOM; when the Modes menu gets a way to be opened from outside (a store of its own), use that.
  const until = Date.now() + MODES_WAIT_MS
  const look = (): void => {
    const button = document.querySelector<HTMLButtonElement>('.w-shell__view[data-view="session"] [data-testid="modes"]')
    if (button !== null) button.click()
    else if (Date.now() < until) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}
