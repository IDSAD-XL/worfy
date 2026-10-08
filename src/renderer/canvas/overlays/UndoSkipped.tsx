// The notice at the top centre of the Canvas that ⌘Z or ⇧⌘Z skipped a step (worfy-link ticket 07,
// ADR-0053): another screen — a second window, a Linked machine — changed the step's Node since, so
// undoing it would have wiped out that change. The state lives in history.ts (skippedNotice), which
// also takes the notice down after SKIPPED_NOTICE_MS; this only shows it for the active Project.
//
// Colours and sizes are the tokens of tokens.css (docs/design/F-SPEC.md): the surface, its border
// and shadow, as the Trash popover has them, with secondary text.
import type { CSSProperties } from 'react'
import { Panel } from '@xyflow/react'
import { useStore } from 'zustand'
import { activeProject, useProjects } from '../../projects/useProjects'
import { skippedNotice } from '../history'

export const order = 40

const TEXT = { undo: 'Not undone: this Node was changed on another screen', redo: 'Not redone: this Node was changed on another screen' } as const

const NOTICE: CSSProperties = {
  maxWidth: 420,
  marginTop: 'var(--space-2)',
  padding: 'var(--space-1) var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-control)',
  color: 'var(--text-secondary)',
  font: 'var(--text-12) / 18px var(--font-ui)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  pointerEvents: 'none',
}

export default function UndoSkipped() {
  const projectId = activeProject(useProjects())?.id
  const notice = useStore(skippedNotice, (state) => state.notice)
  if (notice === null || notice.projectId !== projectId) return null
  return (
    <Panel position="top-center" className="nodrag nopan nowheel">
      <div key={notice.count} role="status" data-testid="undo-skipped" data-direction={notice.direction} style={NOTICE}>
        {TEXT[notice.direction]}
      </div>
    </Panel>
  )
}
