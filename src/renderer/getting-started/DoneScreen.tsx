import { useState, type CSSProperties } from 'react'
import '../canvas/actions/actions.css'
import { failureReason } from '../../shared/ipc/channels'
import { invoke } from '../ipc'
import { requestAddProject } from '../projects/add-project'
import { showToast } from '../toast/toasts'

/**
 * The screen Done of Getting started (worfy-onboarding ticket 10; spec, decision 7), in the section in
 * place of the steps once step 6 is marked. "Connect your own project" opens the same "Add project" as
 * "+" of Projects; "Remove the demo project" asks main, which shows the native confirmation and
 * removes the demo (`gettingStarted.removeDemo`); "Show steps" goes back to the list. Nothing here
 * removes the demo by itself. Texts are those of the spec, section "Texts (draft)".
 */

const styles = {
  root: { padding: '2px 8px 4px' },
  title: {
    margin: 0,
    fontSize: 'var(--text-13)',
    lineHeight: '16px',
    fontWeight: 600,
    color: 'var(--text)',
  },
  text: {
    margin: '4px 0 0',
    fontSize: 'var(--text-12)',
    lineHeight: '15px',
    color: 'var(--text-secondary)',
  },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  link: {
    marginTop: 6,
    border: 0,
    padding: '2px 0',
    background: 'transparent',
    color: 'var(--text-muted)',
    font: 'inherit',
    fontSize: 'var(--text-12)',
    textDecoration: 'underline',
  },
} satisfies Record<string, CSSProperties>

export const REMOVED_TEXT = 'The demo project was removed.'

interface Props {
  /** Whether there is a Demo project to remove: without one the button is not offered. */
  hasDemo: boolean
  /** Back to the list of steps. */
  onShowSteps: () => void
  /**
   * Why the removal refused, or what stays after one that did not finish; null clears it. The
   * section shows it: a removal that went part of the way takes steps 2–6 back, and this screen with them.
   */
  onMessage: (text: string | null) => void
}

export default function DoneScreen({ hasDemo, onShowSteps, onMessage }: Props) {
  const [busy, setBusy] = useState(false)

  const remove = async (): Promise<void> => {
    onMessage(null)
    setBusy(true)
    const result = await invoke('gettingStarted.removeDemo')
    setBusy(false)
    if (!result.ok) onMessage(failureReason('gettingStarted.removeDemo', result.error))
    else if (result.value.removed)
      showToast({
        kind: 'success',
        text: REMOVED_TEXT,
        testId: 'getting-started-removed-toast',
      })
    // Cancel (no reason) says nothing.
    else if (result.value.reason !== null) onMessage(result.value.reason)
  }

  return (
    <div style={styles.root} data-testid="getting-started-done">
      <h3 style={styles.title}>Done — the ticket is merged</h3>
      <p style={styles.text}>You took one ticket from the Orchestrator through review to main. That is the whole loop.</p>
      <div style={styles.actions}>
        <button type="button" className="w-action w-action--primary" onClick={() => requestAddProject()}>
          Connect your own project
        </button>
        {hasDemo ? (
          <button type="button" className="w-action" disabled={busy} onClick={() => void remove()}>
            Remove the demo project
          </button>
        ) : null}
      </div>
      <button type="button" style={styles.link} onClick={onShowSteps}>
        Show steps
      </button>
    </div>
  )
}
