// The Getting started state in the window (worfy-onboarding ticket 07): main's snapshot
// (`gettingStarted.state`, then every `gettingStarted.changed`), and the calls that show and hide
// Getting started. The panel in the top right corner (GettingStartedPanel.tsx, ticket 13) draws it;
// the Command palette, the first-run screen and the notice (tickets 08, 09) open it through
// openGettingStarted() without importing the panel.
//
// Main owns the state and marks the steps (src/main/getting-started/); the window only shows it,
// and writes nothing but whether it is shown (`section`, the name the state kept from the sidebar
// section the panel replaced).
import { useEffect } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { GettingStartedSection, GettingStartedSnapshot } from '../../shared/ipc/getting-started'
import { invoke, subscribe } from '../ipc'
import { showToast } from '../toast/toasts'

export interface GettingStartedStore {
  /** Main's state; null until it has answered once. */
  snapshot: GettingStartedSnapshot | null
  /** Grows with each request to expand the panel and focus its heading; the panel follows it. */
  focusAsked: number
}

export const useGettingStartedStore = create<GettingStartedStore>(() => ({ snapshot: null, focusAsked: 0 }))

/**
 * The key of the panel's collapsed state in `sidebar.collapsed` of the app settings: the file name of
 * the sidebar section it replaced (ticket 13), kept so a choice made before stays.
 */
export const GETTING_STARTED_COLLAPSED_KEY = 'GettingStartedSection'

export const SKIPPED_TEXT = 'Getting started is hidden. Reopen it from the Command palette: Getting started.'

/** Counts the snapshots taken: the answer to the first read loses to an event that came before it. */
let accepted = 0

export function acceptGettingStarted(snapshot: GettingStartedSnapshot): void {
  accepted += 1
  useGettingStartedStore.setState({ snapshot })
}

let started = false

/** Subscribes to the changes and reads the state, once per window load. */
function start(): void {
  if (started) return
  started = true
  try {
    subscribe('gettingStarted.changed', acceptGettingStarted)
  } catch (error) {
    console.error('gettingStarted.changed: cannot subscribe', error)
  }
  const before = accepted
  void invoke('gettingStarted.state').then((result) => {
    if (!result.ok) console.error('gettingStarted.state failed:', result.error)
    else if (accepted === before) acceptGettingStarted(result.value)
  })
}

/** Main's Getting started state; null until it has answered. The first call starts the reading. */
export function useGettingStarted(): GettingStartedSnapshot | null {
  useEffect(start, [])
  return useGettingStartedStore((store) => store.snapshot)
}

/** Shows or hides Getting started in every window; answers the reason when main refuses. */
export async function setGettingStartedSection(section: GettingStartedSection): Promise<string | undefined> {
  start()
  const result = await invoke('gettingStarted.setSection', { section })
  if (!result.ok) return failureReason('gettingStarted.setSection', result.error)
  acceptGettingStarted(result.value)
  return undefined
}

/**
 * Shows the panel, expanded and with the focus on its heading (the Command palette's "Getting
 * started", First run's "Start Getting started", the notice's "Open"). The panel expands a pill
 * itself, writing the app settings as its own pill does. Answers the reason when main refuses.
 */
export async function openGettingStarted(): Promise<string | undefined> {
  const failure = await setGettingStartedSection('shown')
  if (failure !== undefined) return failure
  useGettingStartedStore.setState((store) => ({ focusAsked: store.focusAsked + 1 }))
  return undefined
}

/** "Skip": hides the panel and its pill, and says where it comes back from. Answers the reason when main refuses. */
export async function skipGettingStarted(): Promise<string | undefined> {
  const failure = await setGettingStartedSection('hidden')
  // One toast however often Skip is pressed: a second replaces the first.
  if (failure === undefined) showToast({ kind: 'info', text: SKIPPED_TEXT, key: 'getting-started-skipped' })
  return failure
}
