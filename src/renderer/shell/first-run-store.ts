// The state of the first-run screen (FirstRun.tsx, worfy-harness ticket 19) outside React: whether
// it is open and on which page, the last checks main sent and whether a check is running. The
// command palette opens the screen through openFirstRun() without importing the screen.
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { FirstRunReport } from '../../shared/ipc/first-run'
import { useAssistant } from '../assistant/useAssistant'
import { invoke } from '../ipc'

/**
 * The page the screen shows: the three concepts of worfy (FirstRunConcepts.tsx, worfy-onboarding
 * ticket 08), only when it opened by itself on a new user's first start; after them the one offer to
 * turn the Assistant on (worfy-assistant ticket 16), while it stands; else the checks.
 */
export type FirstRunPage = 'concepts' | 'assistant' | 'checks'

export interface FirstRunState {
  open: boolean
  page: FirstRunPage
  report: FirstRunReport | null
  checking: boolean
  /** Why the last check could not run. */
  failure: string | null
}

export const useFirstRun = create<FirstRunState>(() => ({ open: false, page: 'checks', report: null, checking: false, failure: null }))

/** Grows with every close: checks that finish after the screen closed are dropped, so the next opening checks afresh. */
let opening = 0

/** Runs the checks again; a call while one runs does nothing. */
export async function checkAgain(): Promise<void> {
  if (useFirstRun.getState().checking) return
  const asked = opening
  useFirstRun.setState({ checking: true, failure: null })
  const result = await invoke('firstRun.checks')
  if (asked !== opening) {
    useFirstRun.setState({ checking: false })
    // Opened again while these checks ran for the closed screen: check for this opening.
    if (useFirstRun.getState().open) void checkAgain()
    return
  }
  useFirstRun.setState(result.ok ? { checking: false, report: result.value } : { checking: false, failure: failureReason('firstRun.checks', result.error) })
}

/** Opens the screen on `page`; it checks unless it has checks already, so they run behind the concepts too. */
function openOn(page: FirstRunPage): void {
  useFirstRun.setState({ open: true, page })
  if (useFirstRun.getState().report === null) void checkAgain()
}

/** Opens the screen on its checks (the command palette's "First-run checks"). */
export function openFirstRun(): void {
  openOn('checks')
}

/** The checks, which have been running since the screen opened: after the offer of the Assistant. */
export function showFirstRunChecks(): void {
  useFirstRun.setState({ page: 'checks' })
}

/**
 * "Next" of the concepts page: the offer to turn the Assistant on while it stands (the Assistant's view says so; a
 * window without it yet goes on), else the checks.
 */
export function showFirstRunNext(): void {
  useFirstRun.setState({ page: useAssistant.getState().view?.offer.owed === true ? 'assistant' : 'checks' })
}

/** Closes the screen; main writes the mark. The next opening checks again. */
export function closeFirstRun(): void {
  opening += 1
  void invoke('firstRun.close')
  useFirstRun.setState({ open: false, report: null, failure: null })
}

/** Set once the window asked main whether to open at start, so a remount does not ask again. */
let startupAsked = false

/** Asks main once per window load whether the screen opens by itself (`firstRun.startup`). */
export function askAtStartup(): void {
  if (startupAsked) return
  startupAsked = true
  void invoke('firstRun.startup').then((result) => {
    if (!result.ok || !result.value.show) return
    if (result.value.report !== null) useFirstRun.setState({ report: result.value.report })
    openOn(result.value.firstTime ? 'concepts' : 'checks')
  })
}
