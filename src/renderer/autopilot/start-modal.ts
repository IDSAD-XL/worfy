// The Start Autopilot window (worfy-autopilot-queue ticket 09), outside React: which start it asks about,
// if any. The Autopilot button of an Epic frame (canvas/actions/AutopilotAction.tsx) asks through
// askStart and waits for the answer; StartAutopilotModal.tsx, mounted once in the shell (AppShell.tsx),
// shows the window. One window at a time: a second ask while one is open is answered at once with
// nothing started, the open one stays.
//
// "change in Modes" of the window (openOrchestratorModes) shows the Session view of the Project's
// Orchestrator and opens the Modes menu under its input field (session/composer/Modes.tsx).
import { create } from 'zustand'
import type { RunMode } from '../../shared/autopilot/run-mode'
import { ORCHESTRATOR_KIND } from '../../shared/ipc/orchestrator'
import { currentLayout } from '../canvas/useLayout'
import { openSession } from '../session/navigation'

/** A start the window asks about. */
export interface StartRequest {
  projectId: string
  /** The Epics of the run, in order; one from the Autopilot button. */
  epics: readonly string[]
  /** Named Tickets of a run over one Epic; absent: the whole Epic. */
  tickets?: readonly number[]
  /** Where the ask comes from: the Autopilot button on the Canvas. */
  from: 'canvas'
  /** Starts the run in `mode`; resolves to main's reason when the start was refused, undefined when it went (or waits for the Orchestrator). */
  start(mode: RunMode): Promise<string | undefined>
}

/** The open window: its request, and how its asker learns the end. */
export interface OpenStart extends StartRequest {
  /** Grows with every window: a new window is a new component, with nothing kept from the one before. */
  id: number
  /** Ends the ask: the reason of a refused start, undefined after Cancel or a start that went. */
  settle(reason: string | undefined): void
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
