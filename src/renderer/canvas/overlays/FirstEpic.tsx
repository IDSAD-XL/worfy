// The panel in the middle of the Canvas of a Project without Epics (worfy-harness ticket 24): a
// Project that was just connected has an empty Canvas, and the panel says what to do next. "Plan
// first epic" opens the Project's Orchestrator (`orchestrator.open`) and sends it nothing: the person
// names the first goal. The panel shows only when the workflow was read without an error and has no
// Epic; the first Epic takes it away. On a read-only screen (worfy-link ticket 25) the button is
// inactive and the line under it says why.
//
// Colours and sizes are the tokens of tokens.css (docs/design/F-SPEC.md): the surface with its
// border and the node shadow (none in dark), secondary text, the primary action button.
import { useState, type CSSProperties } from 'react'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { invoke } from '../../ipc'
import { openSession } from '../../session/navigation'
import { PrimaryButton } from '../../theme/primitives'
import { useWorkflow, type WorkflowEntry } from '../../workflow/useWorkflow'

export const order = 45

/** Whether the panel shows: the workflow was read, without an error, and has no Epic. */
function noEpicsYet(entry: WorkflowEntry): boolean {
  const { model, error } = entry
  return error === undefined && model !== undefined && model.error === null && model.epics.length === 0
}

const styles = {
  layer: {
    position: 'absolute',
    inset: 0,
    zIndex: 5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  panel: {
    width: 320,
    maxWidth: 'calc(100% - 32px)',
    boxSizing: 'border-box',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
    color: 'var(--text)',
    textAlign: 'center',
    pointerEvents: 'auto',
  },
  title: { margin: '0 0 var(--space-1)', fontSize: 'var(--text-15)', fontWeight: 600 },
  text: { margin: '0 0 var(--space-3)', fontSize: 'var(--text-13)', lineHeight: '18px', color: 'var(--text-secondary)' },
  error: { margin: 'var(--space-2) 0 0', fontSize: 'var(--text-12)', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

export interface FirstEpicPanelProps {
  onPlan: () => void
  busy?: boolean
  error?: string | null
  /** The read-only hint (worfy-link ticket 25): the button is inactive and the hint shows under it. */
  readOnly?: string | null
}

/** The panel itself, without the Project and the workflow behind it. */
export function FirstEpicPanel({ onPlan, busy = false, error = null, readOnly = null }: FirstEpicPanelProps) {
  return (
    <div style={styles.layer} className="nodrag nopan nowheel">
      <section style={styles.panel} role="region" aria-labelledby="first-epic-title" data-testid="first-epic">
        <h2 id="first-epic-title" style={styles.title}>
          No epics yet
        </h2>
        <p style={styles.text}>Tell the Orchestrator what you want to build, and it plans the first epic with you.</p>
        <PrimaryButton onClick={onPlan} disabled={busy || readOnly !== null}>
          Plan first epic
        </PrimaryButton>
        {readOnly !== null ? (
          <p className="w-read-only-note" style={{ marginTop: 'var(--space-2)' }} data-testid="first-epic-read-only">
            {readOnly}
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}

export default function FirstEpic() {
  const project = activeProject(useProjects())
  const entry = useWorkflow(project?.path)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ projectId: string; text: string } | null>(null)
  const readOnly = useReadOnly()
  if (!project || !noEpicsYet(entry)) return null

  const plan = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await invoke('orchestrator.open', { projectId: project.id })
    setBusy(false)
    if (result.ok) openSession({ nodeId: result.value.nodeId, projectId: project.id })
    else setError({ projectId: project.id, text: result.error })
  }

  return <FirstEpicPanel onPlan={() => void plan()} busy={busy} error={error?.projectId === project.id ? error.text : null} readOnly={readOnly} />
}
