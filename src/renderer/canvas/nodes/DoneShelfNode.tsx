// The done shelf under the Epic frames' strip (worfy-canvas ticket 02, ADR-0075, point 5): each
// Epic whose every Ticket is done and whose frame is collapsed stands here as a chip
// "✓ <epic> N/N". The Node is drawn by the Epic node source (../sources/epics.ts), which computes
// its place and the chips' places (../epic-layout.ts layoutShelf); the Layout keeps nothing of it.
// A click on a chip opens the Epic's frame: one step of ⌘Z, as the frame's collapse button.
import { memo } from 'react'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { SHELF_CHIP_HEIGHT } from '../epic-layout'
import { expandFromShelf, type DoneShelfData } from '../sources/epics'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'
import '../done-shelf.css'

export const kind = 'done-shelf'
export const defaultWidth = 520
export const defaultHeight = 72

const check = (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </svg>
)

function DoneShelfNode({ data }: CanvasNodeProps) {
  const { projectId, chips } = data.node.data as DoneShelfData
  const ops = useLayoutOps()
  // Opening a frame is saved in the Layout: inactive on a read-only screen (worfy-link ticket 25).
  const readOnly = useReadOnly()
  return (
    <section className="w-shelf" aria-label="Done epics" data-testid="done-shelf">
      <div className="w-shelf__label">
        <span>Done</span>
        <span className="w-shelf__count w-mono">{chips.length}</span>
      </div>
      {chips.map((chip) => (
        <button
          key={chip.epic}
          type="button"
          className="w-shelf__chip nodrag"
          style={{ left: chip.x, top: chip.y, width: chip.w, height: SHELF_CHIP_HEIGHT }}
          aria-label={`Expand ${chip.epic}, ${chip.done} of ${chip.total} done`}
          data-testid="done-shelf-chip"
          data-epic={chip.epic}
          {...writeAction(readOnly, () => void expandFromShelf(projectId, chip.epic, chip.saved, ops), `${chip.epic}: every Ticket is done. Expand the frame`)}
        >
          {check}
          <span className="w-shelf__name w-mono">{chip.epic}</span>
          <span className="w-shelf__progress w-mono">
            {chip.done}/{chip.total}
          </span>
        </button>
      ))}
    </section>
  )
}

export default memo(DoneShelfNode)
