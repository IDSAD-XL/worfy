import { useEffect, useState } from 'react'
import type { EcoModeState } from '../../../shared/ipc/eco-mode'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { useProjects, useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'

// Eco mode of the Orchestrator's Project (worfy-throughput ticket 60), the first item of the Modes
// menu (composer/Modes.tsx, worfy-retry ticket 12). It shows `workflow.agents` of the Project's Profile
// ("eco" — on, anything else or absent — off), and a toggle writes it through main (`ecoMode.set`,
// src/main/ipc/eco-mode.ts): on — the eco set of the Pro preset, off — neither field. It changes what
// the next Ticket handed out gets, in this Orchestrator and in the Project's Autopilot; a Ticket already
// running keeps its agents. The Profile is read when the menu's button appears and again after a write
// that did not go through, so a Profile changed outside worfy shows as it is.
//
// No `order` here: every .tsx of composer/ is an item of the bar (src/renderer/shell/registry.ts).

/** The tooltip of the working item: what eco does, and from when. */
export const ECO_MODE_TITLE = "Eco mode: fewer agents per Ticket, Sonnet with effort medium for every agent role. Writes the Project's Profile; applies to the next Ticket."
/** The tooltip in a window that shows a Linked machine: the Profile is that Machine's. */
export const ECO_MODE_ELSEWHERE = 'Eco mode is set in worfy on the Machine of the Project'
/** The toast of a conflict: the Profile changed since the item read it; nothing was written. */
export const ECO_MODE_CHANGED = 'The Profile changed outside worfy: Eco mode shows what it says now. Nothing was written.'

const TOAST_KEY = 'eco-mode'

/** What the Modes menu shows of Eco mode, and the one thing it does. */
export interface EcoMode {
  /** On or off as shown — the value being written while a write runs; null while it is not known. */
  on: boolean | null
  /** Why the item cannot be used, as its tooltip; null when it can. */
  unavailable: string | null
  /** The item's tooltip. */
  title: string
  /** The Profile is being read. */
  reading: boolean
  /** A write runs. */
  busy: boolean
  /** The window shows a Linked machine or has read-only access: the item says so and reads nothing. */
  readOnly: boolean
  /** Writes the other value; does nothing while unavailable or busy. */
  toggle: () => void
}

/** What the item knows of the Profile at `root`; a value read for another folder does not count. */
type Shown = { root: string; state: EcoModeState } | undefined

/** Eco mode of Project `projectId`; its toasts stay with that Project. */
export function useEcoMode(projectId: string): EcoMode {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  // A window that shows a Linked machine reads and writes nothing here: the Profile lives there.
  const readOnly = useReadOnly()
  const elsewhere = windowMachine() !== null
  const [shown, setShown] = useState<Shown>(undefined)
  /** The value being written; null while no write runs. */
  const [writing, setWriting] = useState<boolean | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (elsewhere || root === undefined) return
    let active = true
    void invoke('ecoMode.read', { root }).then((result) => {
      if (!active) return
      setShown({ root, state: result.ok ? result.value : { available: false, reason: `could not read the Project's Profile: ${readableReason(result.error)}` } })
    })
    return () => {
      active = false
    }
  }, [root, generation, elsewhere])

  const state = shown !== undefined && shown.root === root ? shown.state : undefined

  const failed = (text: string): void => {
    showToast({ kind: 'error', key: TOAST_KEY, projectId, text, testId: 'eco-mode-toast' })
    setGeneration((count) => count + 1)
  }

  const write = async (at: string, next: boolean, expected: string): Promise<void> => {
    const what = next ? 'turned on' : 'turned off'
    setWriting(next)
    const result = await invoke('ecoMode.set', { root: at, on: next, expected })
    setWriting(null)
    if (!result.ok) return failed(`Eco mode was not ${what}: ${readableReason(result.error)}`)
    const done = result.value
    switch (done.status) {
      case 'saved':
        setShown({ root: at, state: { available: true, on: done.on, fingerprint: done.fingerprint } })
        if (done.warning !== null) showToast({ kind: 'info', key: TOAST_KEY, projectId, text: `Eco mode ${what}. The change was not committed in the Harness home: ${done.warning}` })
        return
      case 'conflict':
        showToast({ kind: 'info', key: TOAST_KEY, projectId, text: ECO_MODE_CHANGED, testId: 'eco-mode-toast' })
        setGeneration((count) => count + 1)
        return
      case 'busy':
        return failed(`Eco mode was not ${what}: another write of the Profile is in progress — try again.`)
      case 'invalid':
        return failed(`Eco mode was not ${what}: ${done.reason}`)
      case 'too-old':
        return failed(`Eco mode was not ${what}: the Harness is too old. Update it from the Harness item of the toolbar.`)
    }
  }

  const hint = readOnly ?? (elsewhere ? ECO_MODE_ELSEWHERE : null)
  const unavailable = hint ?? (state === undefined ? "Reading the Project's Profile…" : state.available ? null : `Eco mode is not available: ${state.reason}`)
  const on = hint !== null ? null : (writing ?? (state?.available === true ? state.on : null))
  return {
    on,
    unavailable,
    title: unavailable ?? ECO_MODE_TITLE,
    reading: hint === null && state === undefined,
    busy: writing !== null,
    readOnly: hint !== null,
    toggle: () => {
      if (unavailable !== null || writing !== null || root === undefined || state?.available !== true) return
      void write(root, !state.on, state.fingerprint)
    },
  }
}
