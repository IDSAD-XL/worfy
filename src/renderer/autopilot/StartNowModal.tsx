// The "Start now?" window (worfy-autopilot-queue ticket 10; spec, "Start window (prototype)", view
// "Start now"): opened by "Start now" in the Autopilot line of a run that waits for its Orchestrator
// (canvas/actions/AutopilotAction.tsx). It says what the start stops — the running turn, the background
// tasks by name — and what stays: the queued messages, which wait for the person's Session after the run
// (ADR-0099). The list is the state's `busy`, current while the window is open. The frame is the Start
// Autopilot window's (StartAutopilotModal.tsx, autopilot-modal.css), 460px wide.
//
// - Cancel leaves the run waiting; "Interrupt and start" (the danger button) takes the Orchestrator at
//   once (`autopilot.startNow`), interrupting as Force stop does (ADR-0050).
// - Keys: the focus is on Cancel when the window opens, Tab and Shift+Tab go round its two buttons (the
//   focus trap of the kit's Dialog), Esc is Cancel. No key starts: the start interrupts work, so it
//   takes a click on the button.
import { useId, useRef } from 'react'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import { Dialog } from '../theme/kit/Dialog'
import type { LayerName } from '../theme/kit/layer'
import './autopilot-modal.css'

/**
 * The layer of the scale (theme/layers.ts) of this window and of Start Autopilot: the layer of the
 * windows of a Linked machine (MACHINE_WINDOW_LAYER, machines/machine-dialogs.ts), above the kit's
 * other windows (Settings among them) and, drawn after the toasts, over them, as these windows
 * always were (test/unit/layers.test.tsx).
 */
export const AUTOPILOT_WINDOW_LAYER = 'toast' satisfies LayerName

/** What keeps the Orchestrator busy, as the state of a waiting run says it. */
export type OrchestratorBusy = NonNullable<AutopilotState['busy']>

/** The window's width (the prototype's). */
const WIDTH = 460

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

interface Row {
  /** ✕ stops, ✓ stays. */
  stops: boolean
  text: string
}

/** The rows of the window for `busy`, in the prototype's order. */
function startNowRows(busy: OrchestratorBusy): Row[] {
  const rows: Row[] = []
  if (busy.turn) rows.push({ stops: true, text: 'the running turn' })
  if (busy.tasks.length > 0) rows.push({ stops: true, text: `${count(busy.tasks.length, 'background task')}: ${busy.tasks.map((task) => task.description ?? task.id).join(', ')}` })
  if (busy.queued > 0) rows.push({ stops: false, text: `${count(busy.queued, 'queued message')} ${busy.queued === 1 ? 'stays' : 'stay'} in the queue` })
  if (!rows.some((row) => row.stops)) rows.unshift({ stops: true, text: 'nothing: the Orchestrator is free' })
  return rows
}

export interface StartNowModalProps {
  epic: string
  busy: OrchestratorBusy
  /** The start is on its way to main: both buttons are off. */
  starting: boolean
  onCancel(): void
  onStart(): void
}

export function StartNowModal({ epic, busy, starting, onCancel, onStart }: StartNowModalProps) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  return (
    <Dialog
      open
      // Esc is Cancel, except while the start is on its way.
      onClose={() => {
      if (!starting) onCancel()
      }}
      labelledBy={titleId}
      className="w-apstart"
      style={{ width: WIDTH }}
      // A click outside does nothing, as in the Start Autopilot window.
      closeOnBackdrop={false}
      layer={AUTOPILOT_WINDOW_LAYER}
      // The focus goes to Cancel, so Enter right after opening interrupts nothing.
      initialFocus={() => cancelButton.current}
      data-testid="start-now"
    >
      <div className="w-apstart__head">
        <h2 id={titleId}>Start now?</h2>
      </div>
      <div className="w-apstart__body">
        <p style={{ margin: 0 }}>{`Autopilot ${epic} starts right away. This stops:`}</p>
        <ul data-testid="start-now-list" style={{ listStyle: 'none', margin: 'var(--space-2) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {startNowRows(busy).map((row) => (
            <li key={row.text} data-stops={row.stops ? '' : undefined} style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <span aria-hidden="true" style={{ flex: 'none', width: 12, fontWeight: 600, color: row.stops ? 'var(--blocked-text)' : 'var(--ready-text)' }}>
                {row.stops ? '✕' : '✓'}
              </span>
              <span style={{ color: row.stops ? 'var(--text)' : 'var(--text-secondary)' }}>{row.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="w-apstart__foot">
        <span style={{ flex: 1 }} />
        <button ref={cancelButton} type="button" className="w-apstart__button" data-testid="start-now-cancel" disabled={starting} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="w-apstart__button w-apstart__button--danger" data-testid="start-now-start" disabled={starting} onClick={onStart}>
          Interrupt and start
        </button>
      </div>
    </Dialog>
  )
}
