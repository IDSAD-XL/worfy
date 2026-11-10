// The live state of every Project of the window's Machine (worfy-polish ticket 99,
// src/shared/ipc/project-pulse.ts): live and busy Sessions, pull requests that need the user, Tickets
// that wait for a person. One copy per window: the first user asks `projectPulse.get`, which subscribes
// the window to `projectPulse.changed` for as long as it lives; every later user reads the same copy. The
// subscription is never ended by the window (the channel has no close): main keeps one reader for all
// windows anyway (src/main/claude-home/pulse.ts).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ProjectPulse, ProjectPulseState } from '../../shared/ipc/project-pulse'
import { invoke, showSubscribeError, subscribe } from '../ipc'

interface PulseStore {
  /** Undefined until main has answered. */
  state: ProjectPulseState | undefined
  /** Why `projectPulse.get` failed; the next user asks again. */
  error: string | undefined
}

const usePulseStore = create<PulseStore>(() => ({ state: undefined, error: undefined }))

let subscribed = false
let asking = false
/** An event that came before the answer is newer than it: main reads after it subscribes. */
let heard = false

function ensure(): void {
  if (!subscribed) {
    subscribed = true
    try {
      subscribe('projectPulse.changed', (state) => {
        heard = true
        usePulseStore.setState({ state, error: undefined })
      })
    } catch (error) {
      showSubscribeError('projectPulse.changed', error)
    }
  }
  if (asking || usePulseStore.getState().state !== undefined) return
  asking = true
  void invoke('projectPulse.get').then((result) => {
    asking = false
    if (!result.ok) {
      console.error('projectPulse.get failed:', result.error)
      if (!heard) usePulseStore.setState({ error: result.error })
      return
    }
    if (!heard) usePulseStore.setState({ state: result.value, error: undefined })
  })
}

/** The live state of every Project of the window's Machine; undefined until main answered. */
export function useProjectPulse(): ProjectPulseState | undefined {
  useEffect(() => ensure(), [])
  return usePulseStore((store) => store.state)
}

/** The part of `state` of Project `projectId`; undefined while unknown. */
export function pulseOf(state: ProjectPulseState | undefined, projectId: string): ProjectPulse | undefined {
  return state?.projects.find((project) => project.projectId === projectId)
}

/** One part of the live line of a card: its words and its colour. */
export interface PulsePart {
  key: string
  text: string
  tone: 'busy' | 'needs'
}

/** The live line of a Project's card in the Projects section, as the sidebar prototype words it; empty for a quiet Project. */
export function pulseParts(pulse: Pick<ProjectPulse, 'busy' | 'prNeedYou' | 'waits'>): PulsePart[] {
  const parts: PulsePart[] = []
  if (pulse.busy > 0) parts.push({ key: 'busy', text: `${pulse.busy} busy`, tone: 'busy' })
  if (pulse.prNeedYou !== null && pulse.prNeedYou > 0) parts.push({ key: 'pr', text: `${pulse.prNeedYou} PR need you`, tone: 'needs' })
  if (pulse.waits !== null && pulse.waits > 0) parts.push({ key: 'waits', text: `${pulse.waits} waits`, tone: 'needs' })
  return parts
}
