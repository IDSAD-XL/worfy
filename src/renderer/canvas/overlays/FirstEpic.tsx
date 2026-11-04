// The label "Plan your first epic →" at the bottom right of the Canvas of a Project without Epics
// (worfy-harness ticket 24; worfy-polish 56 made it a label next to the minimap instead of a panel
// in the middle of the Canvas): a Project that was just connected has an empty Canvas, and the
// label says what to do next. A click opens the Project's Orchestrator (`orchestrator.open`) and
// sends it nothing: the person names the first goal. The label shows only when the workflow was
// read without an error and has no Epic; the first Epic takes it away. While the Orchestrator opens
// it is inactive, a failure is said under it; on a read-only screen (worfy-link ticket 25) it is
// inactive and its tooltip says why.
//
// It sits above the minimap (MiniMapOverlay.tsx, its size in minimap-view.ts), or in its corner while the minimap is hidden,
// and holds its box in that corner (pinning.ts, holdCorner), so a pinned Node keeps out of it too.
// Colours are the tokens of tokens.css (docs/design/F-SPEC.md), in first-epic.css: no surface,
// border or shadow, only text.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { invoke } from '../../ipc'
import { openSession } from '../../session/navigation'
import { useWorkflow, type WorkflowEntry } from '../../workflow/useWorkflow'
import { holdCorner } from '../pinning'
import { useElementSize } from '../use-element-size'
import { MINIMAP_BOX, PANEL_MARGIN, useMinimapShown } from './minimap-view'
import './first-epic.css'

export const order = 45

/** The space between the label and the minimap under it (--space-2). */
const MINIMAP_GAP = 8

/** Whether the label shows: the workflow was read, without an error, and has no Epic. */
function noEpicsYet(entry: WorkflowEntry): boolean {
  const { model, error } = entry
  return error === undefined && model !== undefined && model.error === null && model.epics.length === 0
}

const styles = {
  layer: {
    position: 'absolute',
    right: PANEL_MARGIN,
    zIndex: 5,
    maxWidth: MINIMAP_BOX.width,
    textAlign: 'right',
  },
  error: { margin: '2px 0 0', fontSize: 'var(--text-12)', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

export interface FirstEpicLabelProps {
  onPlan: () => void
  busy?: boolean
  error?: string | null
  /** The read-only hint (worfy-link ticket 25): the label is inactive and the hint is its tooltip. */
  readOnly?: string | null
}

/** The label itself, without the Project and the workflow behind it. */
export function FirstEpicLabel({ onPlan, busy = false, error = null, readOnly = null }: FirstEpicLabelProps) {
  const minimapShown = useMinimapShown()
  const bottom = minimapShown ? PANEL_MARGIN + MINIMAP_BOX.height + MINIMAP_GAP : PANEL_MARGIN
  const [size, setSize] = useState<{ width: number; height: number }>()
  const measure = useElementSize<HTMLDivElement>(useCallback((next: { width: number; height: number }) => setSize(next), []))
  // The label's box at the bottom right: the margin to the Canvas's edges, and as much again to a pinned Node.
  const width = size === undefined ? undefined : PANEL_MARGIN + size.width + PANEL_MARGIN
  const height = size === undefined ? undefined : bottom + size.height + PANEL_MARGIN
  useEffect(() => {
    holdCorner('first-epic', width === undefined || height === undefined ? undefined : { width, height })
    return () => holdCorner('first-epic', undefined)
  }, [width, height])
  return (
    <div ref={measure} style={{ ...styles.layer, bottom }} className="nodrag nopan nowheel" data-testid="first-epic" title={readOnly ?? undefined}>
      <button type="button" className="w-first-epic-label" onClick={onPlan} disabled={busy || readOnly !== null}>
        Plan your first epic →
      </button>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
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

  return <FirstEpicLabel onPlan={() => void plan()} busy={busy} error={error?.projectId === project.id ? error.text : null} readOnly={readOnly} />
}
