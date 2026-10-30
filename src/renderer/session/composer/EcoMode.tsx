import { useEffect, useState } from 'react'
import type { EcoModeState } from '../../../shared/ipc/eco-mode'
import { useOrchestratorViews } from '../../canvas/nodes/orchestrator-view'
import { invoke, readableReason, windowMachine } from '../../ipc'
import { useProjects, useReadOnly } from '../../projects/useProjects'
import { showToast } from '../../toast/toasts'
import type { ComposerItemProps } from './index'

// The Eco mode switch (worfy-throughput ticket 60), in the bar under the input field of the
// Orchestrator only: a regular Session has none. It shows `workflow.agents` of the Project's Profile
// ("eco" — on, anything else or absent — off) and a click writes it through main (`ecoMode.set`,
// src/main/ipc/eco-mode.ts): on — the eco set of the Pro preset, off — neither field. It changes
// what the next Ticket handed out gets, in this Orchestrator and in the Project's Autopilot; a
// Ticket already running keeps its agents. The Profile is read when the switch appears and again
// after a write that did not go through, so a Profile changed outside worfy shows as it is.

/** Right of the pickers (Pickers.tsx, order 10), before the queue (Queue.tsx, order 20). */
export const order = 15

/** The tooltip of the working switch: what eco does, and from when. */
export const ECO_MODE_TITLE = "Eco mode: fewer agents per Ticket, Sonnet with effort medium for every agent role. Writes the Project's Profile; applies to the next Ticket."
/** The tooltip in a window that shows a Linked machine: the Profile is that Machine's. */
export const ECO_MODE_ELSEWHERE = 'Eco mode is set in worfy on the Machine of the Project'
/** The toast of a conflict: the Profile changed since the switch read it; nothing was written. */
export const ECO_MODE_CHANGED = 'The Profile changed outside worfy: Eco mode shows what it says now. Nothing was written.'

/** What the switch knows of the Profile: undefined while it is read. */
type Shown = EcoModeState | undefined

const TOAST_KEY = 'eco-mode'

function LeafIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-testid="eco-mode-icon" data-icon="leaf">
      <path d="M14 2C7 2 2.5 5 2.5 10.5c0 1.2.3 2.2.8 3 .9-3.6 3.6-6.4 7.4-8.2-3.2 2.2-5.4 5-6.2 8.4C11 14 14 9.5 14 2z" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" data-testid="eco-mode-icon" data-icon="bolt">
      <path d="M9.5 1 3 9h4.5L6.5 15 13 7H8.5L9.5 1z" />
    </svg>
  )
}

/** The switch for the Project at `root`; `projectId` keeps its toasts to that Project. */
function EcoSwitch({ root, projectId }: { root: string; projectId: string }) {
  // A window that shows a Linked machine reads and writes nothing here: the Profile lives there.
  const readOnly = useReadOnly()
  const elsewhere = windowMachine() !== null
  const [shown, setShown] = useState<Shown>(undefined)
  /** The value being written; null while no write runs. */
  const [writing, setWriting] = useState<boolean | null>(null)
  /** Counts the reads: a write that did not go through asks for one more. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (elsewhere) return
    let active = true
    void invoke('ecoMode.read', { root }).then((result) => {
      if (!active) return
      setShown(result.ok ? result.value : { available: false, reason: `could not read the Project's Profile: ${readableReason(result.error)}` })
    })
    return () => {
      active = false
    }
  }, [root, generation, elsewhere])

  const failed = (text: string): void => {
    showToast({ kind: 'error', key: TOAST_KEY, projectId, text, testId: 'eco-mode-toast' })
    setGeneration((count) => count + 1)
  }

  const toggle = async (): Promise<void> => {
    if (shown?.available !== true || writing !== null) return
    const next = !shown.on
    const what = next ? 'turned on' : 'turned off'
    setWriting(next)
    const result = await invoke('ecoMode.set', { root, on: next, expected: shown.fingerprint })
    setWriting(null)
    if (!result.ok) return failed(`Eco mode was not ${what}: ${readableReason(result.error)}`)
    const done = result.value
    switch (done.status) {
      case 'saved':
        setShown({ available: true, on: done.on, fingerprint: done.fingerprint })
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

  const checked = writing ?? (shown?.available === true && shown.on)
  const hint = readOnly ?? (elsewhere ? ECO_MODE_ELSEWHERE : null)
  const unavailable = hint ?? (shown === undefined ? "Reading the Project's Profile…" : shown.available ? null : `Eco mode is not available: ${shown.reason}`)
  return (
    <button
      type="button"
      role="switch"
      className="w-eco"
      aria-label="Eco mode"
      aria-checked={checked}
      // aria-disabled rather than disabled: a disabled button shows no tooltip (read-only.ts).
      aria-disabled={unavailable !== null ? 'true' : undefined}
      aria-busy={writing !== null ? 'true' : undefined}
      title={unavailable ?? ECO_MODE_TITLE}
      data-testid="eco-mode"
      data-read-only={hint !== null ? '' : undefined}
      onClick={() => {
        if (unavailable === null) void toggle()
      }}
    >
      <span className="w-eco__label">Eco mode</span>
      <span className="w-eco__track" aria-hidden="true">
        <span className="w-eco__knob">{checked ? <LeafIcon /> : <BoltIcon />}</span>
      </span>
    </button>
  )
}

/** The switch of the Orchestrator of Project `projectId`, once the Project's folder is known. */
function OrchestratorEcoMode({ projectId }: { projectId: string }) {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  return root === undefined ? null : <EcoSwitch key={root} root={root} projectId={projectId} />
}

export default function EcoMode({ sessionId }: ComposerItemProps) {
  // Only the Orchestrator's input field: the live Session of an Orchestrator view of this window. Any
  // other Session gets nothing, and asks main for nothing.
  const views = useOrchestratorViews()
  const projectId = sessionId === null ? undefined : Object.values(views).find((each) => each.sessionId === sessionId)?.projectId
  return projectId === undefined ? null : <OrchestratorEcoMode projectId={projectId} />
}
