import { memo, useEffect, useRef } from 'react'
import { writeAction } from '../../projects/read-only'
import { useReadOnly } from '../../projects/useProjects'
import { actions, type SlotSubject } from '../badges'
import type { NodeKindColour } from '../kind-colours'
import { KindBand, KindIcon } from '../kind-icons'
import { onDoneShelf, PROGRESS_SEGMENTS, TICKET_WIDTH, type EpicLayout, type Progress, type TicketColumn } from '../epic-layout'
import { setDoneStack, toggleFrame, type EpicFrameData } from '../sources/epics'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'
import '../actions/actions.css'
import '../epic-frame.css'

// The frame of one Epic: header with the progress bar, column labels with the "Ready wave · N"
// chip, and the done stack with its Expand / Collapse toggle in the Done column's label row
// (worfy-week ticket 15). Its Tickets are separate Nodes inside it (TicketNode.tsx), each
// ready one with its own "Ready" chip; both come from the node source sources/epics.ts, never from
// the Layout. The frame is dragged as a whole by its header; its Tickets are not dragged (ADR-0037).
export const kind = 'epic-frame'
export const defaultWidth = 520
export const defaultHeight = 56
/** Its kind colour on the band, the icon and the minimap (kind-colours.ts). */
export const kindColour: NodeKindColour = 'epic'

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

const CHEVRON_PATHS = { down: 'M4 6l4 4 4-4', right: 'M6 4l4 4-4 4', up: 'M4 10l4-4 4 4' } as const

const chevron = (direction: keyof typeof CHEVRON_PATHS) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={CHEVRON_PATHS[direction]} />
  </svg>
)

const columnClass = (column: TicketColumn) => `w-epic__column w-epic__column--${column.kind}`

/** Top of the column labels (`.w-epic__column`), relative to the frame. */
const COLUMN_LABEL_TOP = 64
/** How far the open stack's backdrop reaches past the column label and the done Tickets. */
const STACK_REGION_INSET = 6

/** The backdrop of the open done stack: from the Done column's label to the bottom of its last Ticket; null while folded. */
function openStackRegion(layout: EpicLayout): { left: number; top: number; width: number; height: number } | null {
  const done = layout.tickets.filter((ticket) => ticket.column.kind === 'done')
  if (layout.doneStack !== null || done.length === 0) return null
  const left = Math.min(...done.map((ticket) => ticket.x)) - STACK_REGION_INSET
  const top = COLUMN_LABEL_TOP - STACK_REGION_INSET
  const bottom = Math.max(...done.map((ticket) => ticket.y + ticket.height)) + STACK_REGION_INSET
  return { left, top, width: TICKET_WIDTH + 2 * STACK_REGION_INSET, height: bottom - top }
}

function EpicFrameNode({ data }: CanvasNodeProps) {
  const frame = data.node.data as EpicFrameData
  const { projectId, root, epic, tickets, layout, progress, collapsed, doneExpanded, saved } = frame
  const subject: SlotSubject = { kind: 'epic', projectId, root, epic, tickets }
  const ops = useLayoutOps()
  // Collapsing is saved in the Layout: inactive on a read-only screen (worfy-link ticket 25).
  const readOnly = useReadOnly()
  // A step of the ⌘Z history, with the record's order when the frame goes to the done shelf
  // (toggleFrame); the done stack below is not (it is not in the Layout, like the
  // viewport). A collapsed frame shows no stack, so its stack is folded with it.
  const toggleCollapsed = () => {
    if (!collapsed) setDoneStack(projectId, epic.epic, false)
    void toggleFrame(projectId, epic.epic, saved, !collapsed, onDoneShelf(tickets, true), ops)
  }

  // The card that opened the stack leaves the DOM with the focus on it: the focus goes to the
  // toggle, which now says Collapse in the same place as Expand.
  const toggle = useRef<HTMLButtonElement>(null)
  const focusToggle = useRef(false)
  useEffect(() => {
    if (!focusToggle.current || !doneExpanded) return
    focusToggle.current = false
    toggle.current?.focus()
  }, [doneExpanded])
  const region = doneExpanded ? openStackRegion(layout) : null

  return (
    <section
      className="w-epic"
      aria-label={`Epic ${epic.epic}`}
      data-testid="epic-frame"
      data-epic={epic.epic}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      {/* The pale ground of the Epic's kind under the header, across the frame, with the kind band on top (ADR-0077). */}
      <div className="w-epic__ground" aria-hidden="true">
        <KindBand kind="epic" />
      </div>
      <header className="w-epic__header">
        <div className="w-epic__drag">
          <span className="w-epic__tag">
            <KindIcon kind="epic" size={12} />
            Epic
          </span>
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
          {...writeAction(readOnly, toggleCollapsed)}
        >
          {chevron(collapsed ? 'right' : 'down')}
        </button>
      </header>

      {collapsed ? null : (
        <>
          {region ? <div className="w-epic__stack-region" aria-hidden="true" data-testid="done-stack-region" style={region} /> : null}
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
              {column.column.kind === 'done' ? (
                <button
                  ref={toggle}
                  type="button"
                  className="w-action w-epic__stack-toggle nodrag"
                  data-testid="done-stack-toggle"
                  aria-label={`${doneExpanded ? 'Collapse' : 'Expand'} done tickets of ${epic.epic}`}
                  aria-expanded={doneExpanded}
                  onClick={() => setDoneStack(projectId, epic.epic, !doneExpanded)}
                >
                  {chevron(doneExpanded ? 'up' : 'down')}
                  {doneExpanded ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
          ))}
          {layout.doneStack ? (
            <button
              type="button"
              className="w-epic__stack nodrag"
              data-testid="done-stack"
              aria-label={`${layout.doneStack.nums.length} done tickets of ${epic.epic}`}
              aria-expanded={false}
              style={{ left: layout.doneStack.x, top: layout.doneStack.y, width: layout.doneStack.width, height: layout.doneStack.height }}
              onClick={() => {
                focusToggle.current = true
                setDoneStack(projectId, epic.epic, true)
              }}
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

// Drawn again only for new data, not for a new place on each mouse move of a drag: the frame
// draws nothing from its place or its selection (React Flow's own wrapper draws the selection ring).
export default memo(EpicFrameNode, (before, after) => before.data === after.data)
