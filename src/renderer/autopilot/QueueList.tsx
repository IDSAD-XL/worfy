// The queue of Epics in the Start Autopilot window (worfy-autopilot-queue ticket 16; prototype Card
// card-918c77d9, view "Queue"; the owner's decision 16 of the spec): one row per Epic with a tick, its
// place among the ticked, the Epic, its Waves left and the day the owner accepted it. Before the start
// the queue is the person's to change: untick to drop an Epic, drag a row with the mouse, or ⌥↑/⌥↓ on
// its grip to move it a place (the focus stays on that grip). The window (StartAutopilotModal.tsx) keeps
// the rows and starts with the ticked Epics in their order.
//
// `locked` (an agent's ask with a list of Epics, ticket 15): the rows are shown without ticks, grips or
// dragging — the window's answer to main carries only the Run mode, so the queue stays the one the
// Session asked for.
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { KIND } from '../canvas/kind-colours'
import { isMac } from '../platform'

/** One Epic of the queue, ticked or not. */
export interface QueueRow {
  epic: string
  on: boolean
}

/** What main said of an Epic (`autopilot.prepare`): its Waves left and the day its spec was accepted. */
export interface QueueFacts {
  waves: number
  accepted: string | null
}

/** `rows` with the row at `from` moved to `to`; the same order when either is out of range. */
function moveRow<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows]
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return next
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row as T)
  return next
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A YYYY-MM-DD date as the prototype writes it ("Nov 4"); any other text as it is. */
function acceptedText(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(date)
  const month = match === null ? undefined : MONTHS[Number(match[1]) - 1]
  return match === null || month === undefined ? date : `${month} ${Number(match[2])}`
}

const wavesText = (waves: number): string => `${waves} ${waves === 1 ? 'Wave' : 'Waves'}`

export function QueueList({
  rows,
  facts,
  onChange,
  locked,
  off,
}: {
  rows: readonly QueueRow[]
  /** By Epic; an Epic main has not answered for yet shows `…` for its Waves. */
  facts: Readonly<Record<string, QueueFacts>>
  onChange(rows: QueueRow[]): void
  locked: boolean
  /** The window starts or its time is up: nothing changes any more. */
  off: boolean
}) {
  const list = useRef<HTMLUListElement>(null)
  const dragged = useRef<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  // The grip a key moved: it keeps the focus after the rows are drawn again.
  const focusEpic = useRef<string | null>(null)
  const fixed = locked || off

  useLayoutEffect(() => {
    const epic = focusEpic.current
    if (epic === null) return
    focusEpic.current = null
    const grip = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-grip]') ?? [])].find((each) => each.dataset['grip'] === epic)
    if (grip !== undefined && document.activeElement !== grip) grip.focus()
  }, [rows])

  const toggle = (index: number): void => onChange(rows.map((row, at) => (at === index ? { ...row, on: !row.on } : row)))
  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= rows.length) return
    focusEpic.current = rows[index]?.epic ?? null
    onChange(moveRow(rows, index, to))
  }
  const drop = (event: DragEvent<HTMLLIElement>, index: number): void => {
    event.preventDefault()
    setOver(null)
    const from = dragged.current
    dragged.current = null
    if (from !== null && !fixed) onChange(moveRow(rows, from, index))
  }

  const ticked = rows.filter((row) => row.on)
  return (
    <ul ref={list} className="w-apstart__queue" data-testid="start-autopilot-queue">
      {rows.map((row, index) => {
        const fact = facts[row.epic]
        const classes = ['w-apstart__queue-row', ...(row.on ? [] : ['w-apstart__queue-row--off']), ...(over === index ? ['w-apstart__queue-row--over'] : [])]
        return (
          <li
            key={row.epic}
            className={classes.join(' ')}
            data-testid="start-autopilot-queue-row"
            data-epic={row.epic}
            data-on={String(row.on)}
            draggable={!fixed}
            onDragStart={(event) => {
              if (fixed) return
              dragged.current = index
              event.dataTransfer?.setData('text/plain', row.epic)
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              dragged.current = null
              setOver(null)
            }}
            onDragOver={(event) => {
              if (dragged.current === null) return
              event.preventDefault()
              setOver(index)
            }}
            onDragLeave={() => setOver((now) => (now === index ? null : now))}
            onDrop={(event) => drop(event, index)}
          >
            {locked ? null : (
              <>
                <button
                  type="button"
                  className="w-apstart__grip"
                  title={`Drag to reorder (or ${isMac() ? '⌥' : 'Alt+'}↑/↓)`}
                  aria-label={`Reorder ${row.epic}`}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  data-grip={row.epic}
                  disabled={off}
                  onKeyDown={(event) => onGripKey(event, index)}
                >
                  ⋮⋮
                </button>
                <input type="checkbox" checked={row.on} aria-label={`Include ${row.epic}`} disabled={off} onChange={() => toggle(index)} />
              </>
            )}
            <span className="w-apstart__queue-n w-mono">{row.on ? ticked.indexOf(row) + 1 : '–'}</span>
            <span className="w-apstart__queue-epic" style={{ background: KIND.epic.band }} aria-hidden="true" />
            <span className="w-apstart__queue-name w-mono">{row.epic}</span>
            <span className="w-apstart__queue-waves w-apstart__muted">{fact === undefined ? '…' : wavesText(fact.waves)}</span>
            {fact === undefined || fact.accepted === null ? null : (
              <span className="w-apstart__muted" title={`The owner accepted the spec on ${fact.accepted}`}>
                accepted {acceptedText(fact.accepted)}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
