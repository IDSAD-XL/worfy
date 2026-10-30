// The Getting started state in the window (worfy-onboarding ticket 07): main's snapshot
// (`gettingStarted.state`, then every `gettingStarted.changed`), and the calls that change the
// section. The sidebar section (shell/sidebar/GettingStartedSection.tsx) draws it; the Command
// palette, the first-run screen and the notice (tickets 08, 09) open it through openGettingStarted()
// without importing the section.
//
// Main owns the state and marks the steps (src/main/getting-started/); the window only shows it,
// and writes nothing but the section.
import { useEffect } from 'react'
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { GettingStartedSection, GettingStartedSnapshot } from '../../shared/ipc/getting-started'
import { invoke, subscribe } from '../ipc'
import { setAppSettings } from '../settings/useAppSettings'
import { showToast } from '../toast/toasts'

export interface GettingStartedStore {
  /** Main's state; null until it has answered once. */
  snapshot: GettingStartedSnapshot | null
  /** Grows with each request to bring the section into view and focus it; the section follows it. */
  focusAsked: number
}

export const useGettingStartedStore = create<GettingStartedStore>(() => ({ snapshot: null, focusAsked: 0 }))

/** The id of the section: its file name, the key of its collapsed state in the app settings. */
export const GETTING_STARTED_SECTION_ID = 'GettingStartedSection'

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

/** Shows or hides the section in every window; answers the reason when main refuses. */
export async function setGettingStartedSection(section: GettingStartedSection): Promise<string | undefined> {
  start()
  const result = await invoke('gettingStarted.setSection', { section })
  if (!result.ok) return failureReason('gettingStarted.setSection', result.error)
  acceptGettingStarted(result.value)
  return undefined
}

/**
 * Shows the section, expanded, scrolled into view and focused (the Command palette's "Getting
 * started"). Answers the reason when main refuses.
 */
export async function openGettingStarted(): Promise<string | undefined> {
  const failure = await setGettingStartedSection('shown')
  if (failure !== undefined) return failure
  // A collapsed section would take the focus with nothing to show under it.
  void setAppSettings({ sidebar: { collapsed: { [GETTING_STARTED_SECTION_ID]: false } } })
  useGettingStartedStore.setState((store) => ({ focusAsked: store.focusAsked + 1 }))
  return undefined
}

/** "Skip": hides the section and says where it comes back from. Answers the reason when main refuses. */
export async function skipGettingStarted(): Promise<string | undefined> {
  const failure = await setGettingStartedSection('hidden')
  // One toast however often Skip is pressed: a second replaces the first.
  if (failure === undefined) showToast({ kind: 'info', text: SKIPPED_TEXT, key: 'getting-started-skipped' })
  return failure
}
