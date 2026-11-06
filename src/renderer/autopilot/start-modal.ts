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
// "change in Modes" of the window (openOrchestratorModes) shows the Session view of the Project's
// Orchestrator and opens the Modes menu under its input field (session/composer/Modes.tsx).
import { create } from 'zustand'
import type { RunMode } from '../../shared/autopilot/run-mode'
import type { AutopilotConfirmAnswer, AutopilotConfirmAsk } from '../../shared/ipc/autopilot-confirm'
import { failureReason } from '../../shared/ipc/channels'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { currentLayout } from '../canvas/useLayout'
import { invoke, readableReason } from '../ipc'
import { openSession } from '../session/navigation'

/** A start the window asks about. */
export interface StartRequest {
  projectId: string
  /** The Epics of the run, in order; one from the Autopilot button. */
  epics: readonly string[]
  /** Named Tickets of a run over one Epic; absent: the whole Epic. */
  tickets?: readonly number[]
  /** Where the ask comes from: the Autopilot button on the Canvas, or an agent's `autopilot_start`. */
  from: 'canvas' | 'agent'
  /** An agent's ask: the Session that asks and when main stops waiting (Date.now() time). */
  agent?: { id: string; session: string; deadline: number }
  /** Starts the run in `mode`; resolves to main's reason when the start was refused, undefined when it went (or waits for the Orchestrator). */
  start(mode: RunMode): Promise<string | undefined>
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
    epics: [ask.epic],
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
