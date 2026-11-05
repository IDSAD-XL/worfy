import { useEffect, useState } from 'react'
import type { EcoModeState } from '../../../shared/ipc/eco-mode'
import { invoke, readableReason, subscribe } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { useProjects, useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'

// Eco mode of the Orchestrator's Project (worfy-throughput ticket 60), the first item of the Modes
// menu (composer/Modes.tsx, worfy-retry ticket 12). It shows `workflow.agents` of the Project's Profile
// ("eco" — on, anything else or absent — off), and a toggle writes it through main (`ecoMode.set`,
// src/main/ipc/eco-mode.ts): on — the eco set of the Pro preset, off — neither field. It changes what
// the next Ticket handed out gets, in this Orchestrator and in the Project's Autopilot; a Ticket already
// running keeps its agents. The Profile is read when the menu's button appears and again after a write
// that did not go through, so a Profile changed outside worfy shows as it is; a write made in another
// window or on another Machine shows at once (`ecoMode.changed`). A window that shows a Linked machine
// reads and writes the Profile on that Machine through the link (worfy-retry ticket 13): with full access
// the item changes it, with read-only access it shows it, unavailable with the read-only hint.
//
// No `order` here: every .tsx of composer/ is an item of the bar (src/renderer/shell/registry.ts).

/** The tooltip of the working item: what eco does, and from when. */
export const ECO_MODE_TITLE = "Eco mode: fewer agents per Ticket, Sonnet with effort medium for every agent role. Writes the Project's Profile; applies to the next Ticket."
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
  /** The window has read-only access to the Machine of the Project: the item shows the mode and changes nothing. */
  readOnly: boolean
  /** Writes the other value; does nothing while unavailable or busy. */
  toggle: () => void
}

/** What the item knows of the Profile at `root`; a value read for another folder does not count. */
type Shown = { root: string; state: EcoModeState } | undefined

/** Eco mode of Project `projectId`; its toasts stay with that Project. */
export function useEcoMode(projectId: string): EcoMode {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  // A window that shows a Linked machine asks that Machine: the channels are `project` (src/renderer/ipc.ts).
  const readOnly = useReadOnly()
  const [shown, setShown] = useState<Shown>(undefined)
  /** The value being written; null while no write runs. */
  const [writing, setWriting] = useState<boolean | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (root === undefined) return
    let active = true
    void invoke('ecoMode.read', { root }).then((result) => {
      if (!active) return
      setShown({ root, state: result.ok ? result.value : { available: false, reason: `could not read the Project's Profile: ${readableReason(result.error)}` } })
    })
    return () => {
      active = false
    }
  }, [root, generation])

  // A write made in another window or on another Machine, with the fingerprint after it.
  useEffect(() => {
    if (root === undefined) return
    return subscribe('ecoMode.changed', (change) => {
      if (change.root === root) setShown({ root, state: { available: true, on: change.on, fingerprint: change.fingerprint } })
    })
  }, [root])

  const state = shown !== undefined && shown.root === root ? shown.state : undefined

  const failed = (text: string): void => {
    showToast({ kind: 'error', key: TOAST_KEY, projectId, text, testId: 'eco-mode-toast' })
    // The write may have gone through on the Machine of the Project with its answer lost: no guess
    // until the Profile is read again.
    setShown(undefined)
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

  const unavailable = readOnly ?? (state === undefined ? "Reading the Project's Profile…" : state.available ? null : `Eco mode is not available: ${state.reason}`)
  return {
    on: writing ?? (state?.available === true ? state.on : null),
    unavailable,
    title: unavailable ?? ECO_MODE_TITLE,
    reading: state === undefined,
    busy: writing !== null,
    readOnly: readOnly !== null,
    toggle: () => {
      // readOnlyNow: the level may have gone read-only since the item was drawn.
      if (unavailable !== null || writing !== null || root === undefined || state?.available !== true || readOnlyNow() !== null) return
      void write(root, !state.on, state.fingerprint)
    },
  }
}
