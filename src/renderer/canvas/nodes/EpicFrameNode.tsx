import { memo } from 'react'
import { actions, type SlotSubject } from '../badges'
import { PROGRESS_SEGMENTS, type Progress, type TicketColumn } from '../epic-layout'
import { saveEpicChange, toggleDoneStack, type EpicFrameData } from '../sources/epics'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'
import '../epic-frame.css'

// The frame of one Epic: header with the progress bar, column labels with the "Ready wave · N"
// chip, and the folded done stack. Its Tickets are separate Nodes inside it (TicketNode.tsx), each
// ready one with its own "Ready" chip; both come from the node source sources/epics.ts, never from
// the Layout. The frame is dragged as a whole by its header; its Tickets are not dragged (ADR-0037).
export const kind = 'epic-frame'
export const defaultWidth = 520
export const defaultHeight = 56

const pad = (num: number) => String(num).padStart(2, '0')

function ProgressBar({ progress }: { progress: Progress }) {
  const label = `Progress: ${progress.done} of ${progress.total} done, ${progress.working} working, ${progress.blocked} blocked, ${progress.open} open`
  return (
    <span className="w-progress" role="img" aria-label={label} data-segments={PROGRESS_SEGMENTS}>
      {progress.segments.map((state, index) => (
        <span key={index} className={`w-progress__segment w-progress__segment--${state}`} />
      ))}
    </span>
  )
}

const chevron = (open: boolean) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4'} />
  </svg>
)

const columnClass = (column: TicketColumn) => `w-epic__column w-epic__column--${column.kind}`

function EpicFrameNode({ data }: CanvasNodeProps) {
  const frame = data.node.data as EpicFrameData
  const { projectId, root, epic, tickets, layout, progress, collapsed, doneExpanded, saved } = frame
  const subject: SlotSubject = { kind: 'epic', projectId, root, epic, tickets }
  const ops = useLayoutOps()
  // A step of the ⌘Z history; the done stack below is not (it is not in the Layout, like the viewport).
  const toggleCollapsed = () => void saveEpicChange(projectId, epic.epic, saved, { collapsed: !collapsed }, ops)

  return (
    <section
      className="w-epic"
      aria-label={`Epic ${epic.epic}`}
      data-testid="epic-frame"
      data-epic={epic.epic}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header className="w-epic__header">
        <div className="w-epic__drag">
          <span className="w-epic__tag">Epic</span>
          <h2 className="w-epic__title" title={epic.title ? `${epic.epic} — ${epic.title}` : epic.epic}>
            <span className="w-mono">{epic.epic}</span>
            {epic.title ? <span className="w-epic__subtitle"> — {epic.title}</span> : null}
          </h2>
        </div>
        <ProgressBar progress={progress} />
        <span className="w-epic__count w-mono" data-testid="epic-progress">
          {progress.done}/{progress.total}
        </span>
        {actions.map(({ id, Component }) => (
          <Component key={id} subject={subject} />
        ))}
        <button
          type="button"
          className="w-epic__button nodrag"
          aria-label={collapsed ? `Expand epic ${epic.epic}` : `Collapse epic ${epic.epic}`}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
        >
          {chevron(!collapsed)}
        </button>
      </header>

      {collapsed ? null : (
        <>
          {layout.columns.map((column) => (
            <div key={JSON.stringify(column.column)} className={columnClass(column.column)} style={{ left: column.x }} data-testid="epic-column">
              <span className="w-epic__column-label">{column.label}</span>
              <span className="w-mono w-epic__column-count">{column.count}</span>
              {column.column.kind === 'level' && column.column.level === 0 && layout.readyCount > 0 ? (
                <span className="w-chip w-chip--ready w-epic__ready-chip" data-status="ready">
                  <span className="w-chip__dot" aria-hidden="true" />
                  Ready wave · <span className="w-mono">{layout.readyCount}</span>
                </span>
              ) : null}
              {column.column.kind === 'done' && doneExpanded ? (
                <button type="button" className="w-epic__link nodrag" onClick={() => toggleDoneStack(projectId, epic.epic)}>
                  Fold
                </button>
              ) : null}
            </div>
          ))}
          {layout.doneStack ? (
            <button
              type="button"
              className="w-epic__stack nodrag"
              data-testid="done-stack"
              aria-label={`Expand done tickets of ${epic.epic}`}
              style={{ left: layout.doneStack.x, top: layout.doneStack.y, width: layout.doneStack.width, height: layout.doneStack.height }}
              onClick={() => toggleDoneStack(projectId, epic.epic)}
            >
              <span className="w-epic__stack-title">
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
                <span className="w-mono">{layout.doneStack.nums.length}</span> done
              </span>
              <span className="w-epic__stack-list w-mono" title={layout.doneStack.nums.map(pad).join(' ')}>
                {layout.doneStack.nums.map(pad).join(' ')}
              </span>
            </button>
          ) : null}
          {layout.columns.length === 0 ? <p className="w-epic__empty">No tickets in this epic.</p> : null}
        </>
      )}
    </section>
  )
}

export default memo(EpicFrameNode)
