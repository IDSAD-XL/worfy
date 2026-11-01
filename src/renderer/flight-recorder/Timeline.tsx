// The timeline of a Run (worfy-flight-recorder ticket 18; decision 05, the prototype Card card-57714d55):
// the controls over the tree, the time axis with a mini-map of the whole Run, the Wait and Orchestrator
// lanes, then the tree on the left and the bars on one time axis on the right.
//
// Zoom: drag along the axis (within the stretch on screen) or along the mini-map (within the whole Run),
// Ctrl/Cmd + wheel around the pointer; Shift + wheel moves the stretch; «Fit» shows the whole Run again and
// follows a live Run's end. A collapsed row shows its children as thin bars under its own; a label never
// crosses a bar of its row (label-layout.ts) and with no room stays in the bar's tooltip.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { BlockMark, OrchestratorMark, Span } from '../../shared/flight-recorder/spans'
import type { RunView } from '../../shared/ipc/runs'
import { filterSpans, highlightsOf, NO_FILTER, rowsAbove, type Highlights, type SpanFilter } from './filter'
import { layoutLabels, type LabelItem, type LabelPlace } from './label-layout'
import { displayName, lostWord, outcomeWord, spanDuration, tokenOf } from './span-words'
import {
  buildRows,
  collapseAll,
  expandableIds,
  expandAll,
  formatClock,
  formatDuration,
  formatLocal,
  selectSpan,
  setTimeWindow,
  toggleRow,
  useRunHistory,
  type Row,
  type TimeWindow,
} from './store'

/** The narrowest stretch the axis zooms to, ms. */
const MIN_WINDOW = 60_000
/** Width of the bars area before it is measured (and in a test without layout), px. */
const DEFAULT_WIDTH = 900
const MARK_HALF = 7
const LABEL_FONT = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'

/** Kinds drawn as a tint with a band outline, their labels in the text colour; the rest fill with the band. */
const TINTED = new Set(['run', 'wave', 'stage', 'wait'])

const retryPrefix = (span: Span): string => (span.attempt > 1 ? `#${span.attempt} ` : '')

function tooltipOf(span: Span): string {
  const lines = [`${displayName(span)}${span.attempt > 1 ? ` #${span.attempt}` : ''}`, `${formatLocal(span.start)} – ${formatClock(span.until)} · ${formatDuration(spanDuration(span))}`]
  if (span.outcome !== null) lines.push(`Outcome: ${span.outcome}`)
  if (span.reason !== null) lines.push(`Reason: ${span.reason}`)
  const lost = lostWord(span)
  if (lost !== null) lines.push(lost)
  if (span.note !== null) lines.push(span.note)
  return lines.join('\n')
}

let measurer: { measureText(text: string): { width: number }; font: string } | null | undefined

/**
 * The width of a label's text, px, in the label's font (`bold`: a block's label, 600); an estimate where
 * the page cannot measure (a test without layout).
 */
function textWidth(text: string, bold = false): number {
  if (measurer === undefined) measurer = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  if (measurer === null) return Math.ceil(text.length * (bold ? 6.6 : 6.2)) + 1
  measurer.font = bold ? `600 ${LABEL_FONT}` : LABEL_FONT
  // A pixel more than measured: the text is drawn in a box of this width and never past it.
  return Math.ceil(measurer.measureText(text).width) + 1
}

/** The padding and border of a block's chip (flight-recorder.css, .w-fr-label--block), both sides. */
const CHIP_EXTRA = 8
/** The width of the selected bar's outline, px (flight-recorder.css, .w-fr-bar.is-selected). */
const SELECTED_OUTLINE = 2

function useWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry?.contentRect.width ?? 0)
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}

/** The whole Run on the axis: its start to its end, or to now while it goes on. */
function runDomain(view: RunView): TimeWindow {
  const run = view.timeline.spans.find((span) => span.kind === 'run')
  const from = run?.start ?? view.timeline.now
  const to = Math.max(run?.until ?? view.timeline.now, from + MIN_WINDOW)
  return { from, to }
}

/** A stretch moved and cut to lie inside the whole Run, at least MIN_WINDOW long; null when it is the whole Run. */
function clampWindow(next: TimeWindow, domain: TimeWindow): TimeWindow | null {
  let width = Math.min(Math.max(next.to - next.from, MIN_WINDOW), domain.to - domain.from)
  let from = Math.max(domain.from, Math.min(next.from, domain.to - width))
  if (width >= domain.to - domain.from) {
    from = domain.from
    width = domain.to - domain.from
  }
  return from === domain.from && width === domain.to - domain.from ? null : { from, to: from + width }
}

const TICK_STEPS = [60_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000]

function ticksOf(window: TimeWindow): number[] {
  const step = TICK_STEPS.find((each) => (window.to - window.from) / each <= 10) ?? (TICK_STEPS.at(-1) as number)
  const ticks: number[] = []
  for (let at = Math.ceil(window.from / step) * step; at <= window.to; at += step) ticks.push(at)
  return ticks
}

interface Drag {
  x0: number
  x1: number
  onMap: boolean
  width: number
}

function Axis({ view, window, domain, width }: { view: RunView; window: TimeWindow; domain: TimeWindow; width: number }) {
  // The drag in a ref, read by the window's listeners; the state only draws the brush.
  const drag = useRef<Drag | null>(null)
  const [brush, setBrush] = useState<Drag | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const x = (at: number) => ((at - window.from) / (window.to - window.from)) * width
  const map = (at: number) => ((at - domain.from) / (domain.to - domain.from)) * 100
  const latest = useRef({ window, domain })
  useLayoutEffect(() => {
    latest.current = { window, domain }
  })

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const current = drag.current
      const rect = area.current?.getBoundingClientRect()
      if (current === null || rect === undefined) return
      drag.current = { ...current, x1: Math.max(0, Math.min(rect.width, event.clientX - rect.left)) }
      setBrush(drag.current)
    }
    const up = () => {
      const current = drag.current
      drag.current = null
      setBrush(null)
      if (current === null || Math.abs(current.x1 - current.x0) <= 4 || current.width <= 0) return
      const { window: shown, domain: whole } = latest.current
      const base = current.onMap ? whole : shown
      const at = (px: number) => base.from + ((base.to - base.from) * px) / current.width
      setTimeWindow(clampWindow({ from: at(Math.min(current.x0, current.x1)), to: at(Math.max(current.x0, current.x1)) }, whole))
    }
    globalThis.addEventListener('mousemove', move)
    globalThis.addEventListener('mouseup', up)
    return () => {
      globalThis.removeEventListener('mousemove', move)
      globalThis.removeEventListener('mouseup', up)
    }
  }, [])

  const start = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x0 = event.clientX - rect.left
    drag.current = { x0, x1: x0, onMap: event.clientY - rect.top < 16, width: rect.width }
  }

  const minimapSpans = view.timeline.spans.filter((span) => span.kind === 'ticket' || span.kind === 'wait')
  return (
    <div ref={area} className="w-fr-axis" data-testid="run-history-axis" onMouseDown={start}>
      <div className="w-fr-minimap" data-testid="run-history-minimap">
        {minimapSpans.map((span) => (
          <div key={span.id} className={`w-fr-minimap__bar w-fr-minimap__bar--${tokenOf(span)}`} style={{ left: `${map(span.start)}%`, width: `${Math.max(0.3, map(span.until) - map(span.start))}%` }} />
        ))}
        <div className="w-fr-minimap__window" style={{ left: `${map(window.from)}%`, width: `${map(window.to) - map(window.from)}%` }} />
      </div>
      {ticksOf(window).map((at) => (
        <div key={at} className="w-fr-tick" style={{ left: x(at) }}>
          {formatClock(at)}
        </div>
      ))}
      {brush !== null && Math.abs(brush.x1 - brush.x0) > 4 ? (
        <div className={`w-fr-brush${brush.onMap ? ' w-fr-brush--map' : ''}`} style={{ left: Math.min(brush.x0, brush.x1), width: Math.abs(brush.x1 - brush.x0) }} />
      ) : null}
    </div>
  )
}

interface DrawnBar {
  key: string
  span: Span
  left: number
  right: number
  thin: boolean
  label: string
  short: string
  inside: boolean
}

interface DrawnMark {
  key: string
  kind: 'block' | 'info'
  at: number
  label: string
  /** The bars of the row its label may lie on. */
  over?: string[]
}

/** The bars and marks of a row, and where their labels go. */
function drawRow(row: Row, view: RunView, x: (at: number) => number, width: number, selected: string | null, cause: string | null): { bars: DrawnBar[]; marks: DrawnMark[]; hatches: { key: string; left: number; right: number }[]; places: Map<string, LabelPlace> } {
  const bars: DrawnBar[] = []
  const visible = (left: number, right: number) => right >= 0 && left <= width
  const barsOf = (span: Span, thin: boolean) => {
    const parts = span.segments.length > 0 ? span.segments : [{ start: span.start, end: span.until }]
    // The label goes on the longest part: a Ticket of two Waves is one row with one name.
    const longest = parts.reduce((best, part, index) => (part.end - part.start > parts[best]!.end - parts[best]!.start ? index : best), 0)
    parts.forEach((part, index) => {
      const left = Math.max(0, x(part.start))
      // At least 2 px: a span of no length (a cut-off one) is still seen.
      const right = Math.min(width, Math.max(x(part.end), x(part.start) + 2))
      if (!visible(left, right)) return
      const lost = lostWord(span)
      const named = index === longest && !thin
      bars.push({
        key: `${span.id}@${index}`,
        span,
        left,
        right,
        thin,
        label: named ? (lost ?? `${retryPrefix(span)}${displayName(span)} · ${formatDuration(spanDuration(span))}`) : '',
        short: named ? (lost ?? `${retryPrefix(span)}${formatDuration(spanDuration(span))}`) : '',
        // A hatched bar keeps its label beside it, on the ground of the row.
        inside: lost === null,
      })
    })
  }
  if (row.span === null) {
    if (!row.open) for (const child of row.children) barsOf(child, false)
  } else {
    barsOf(row.span, false)
    if (!row.open) for (const child of row.children) barsOf(child, true)
  }

  const marks: DrawnMark[] = []
  const hatches: { key: string; left: number; right: number }[] = []
  if (row.span?.kind === 'ticket') {
    view.timeline.blocks
      .filter((block: BlockMark) => block.ticket === row.span?.links.ticket)
      .forEach((block, index) => {
        hatches.push({ key: `hatch-${index}`, left: Math.max(0, x(block.at)), right: Math.min(width, x(block.until)) })
        marks.push({ key: `block-${index}`, kind: 'block', at: block.at, label: `${block.reason}${block.waits === null ? '' : ` · Waits: ${block.waits}`}` })
      })
  }
  if (row.lane === 'orchestrator') {
    view.timeline.orchestratorMarks.forEach((mark: OrchestratorMark, index) => marks.push({ key: `info-${index}`, kind: 'info', at: mark.at, label: mark.text }))
  }

  // A block's label is a chip over its own Ticket's bar, never over another one.
  const own = bars.filter((bar) => !bar.thin && bar.span === row.span).map((bar) => bar.key)
  const overOf = (mark: DrawnMark): string[] => (mark.kind === 'block' ? own : [])
  for (const mark of marks) mark.over = overOf(mark)

  // Labels: the full text first; a bar left without a place tries its short one; the rest stay in the tooltip.
  const main = bars.filter((bar) => !bar.thin)
  const items = (short: ReadonlySet<string>): LabelItem[] => [
    ...main.map((bar) => ({
      id: bar.key,
      left: bar.left,
      right: bar.right,
      label: (short.has(bar.key) ? bar.short : bar.label) === '' ? 0 : textWidth(short.has(bar.key) ? bar.short : bar.label),
      inside: bar.inside,
      // The outline of the selected bar and of the cause of a selected retry (flight-recorder.css,
      // .w-fr-bar.is-selected, .is-cause) is part of it here.
      outline: bar.span.id === selected || bar.span.id === cause ? SELECTED_OUTLINE : 0,
    })),
    ...marks.map((mark) => ({ id: mark.key, left: x(mark.at) - MARK_HALF, right: x(mark.at) + MARK_HALF, label: mark.kind === 'block' ? textWidth(mark.label, true) + CHIP_EXTRA : textWidth(mark.label), inside: false, over: mark.over })),
  ]
  const first = layoutLabels(items(new Set()), width)
  const retry = new Set(first.filter((place) => place.placement === 'none' && main.some((bar) => bar.key === place.id && bar.short !== bar.label)).map((place) => place.id))
  const final = retry.size === 0 ? first : layoutLabels(items(retry), width)
  const places = new Map(final.map((place) => [place.id, place]))
  for (const bar of main) if (retry.has(bar.key)) bar.label = bar.short
  return { bars, marks, hatches, places }
}

function RowView({ row, view, x, width, highlights, onToggle }: { row: Row; view: RunView; x: (at: number) => number; width: number; highlights: Highlights; onToggle: (id: string) => void }) {
  const selected = useRunHistory((state) => state.selected)
  const { bars, marks, hatches, places } = drawRow(row, view, x, width, selected, highlights.cause)
  const span = row.span
  const isSelected = span !== null && span.id === selected
  const isCause = span !== null && span.id === highlights.cause
  const isRelated = span !== null && highlights.tickets.has(span.id)
  const name = span === null ? (row.lane === 'wait' ? 'Waits' : 'Orchestrator') : displayName(span)
  const word = span === null ? null : outcomeWord(span, view.timeline.live)
  const kindClass = span === null ? (row.lane === 'wait' ? 'wait' : 'orchestrator') : tokenOf(span)
  const toggle = (event: ReactMouseEvent) => {
    event.stopPropagation()
    onToggle(row.id)
  }
  return (
    <div
      className={`w-fr-row${isSelected ? ' is-selected' : ''}${isCause ? ' is-cause' : ''}${isRelated ? ' is-related' : ''}${span === null ? ' w-fr-row--lane' : ''}`}
      data-testid="run-history-row"
      data-cause={isCause ? 'true' : undefined}
      data-related={isRelated ? 'true' : undefined}
      data-row-id={row.id}
      data-kind={span?.kind ?? `lane-${row.lane ?? ''}`}
      data-open={row.children.length > 0 ? String(row.open) : undefined}
      onClick={() => {
        if (span !== null) selectSpan(span.id)
      }}
    >
      <div className="w-fr-row__tree" style={{ paddingLeft: 6 + row.depth * 14 }} title={span === null ? undefined : tooltipOf(span)}>
        {row.children.length > 0 ? (
          <button type="button" className="w-fr-twisty" aria-label={row.open ? `Collapse ${name}` : `Expand ${name}`} aria-expanded={row.open} onClick={toggle}>
            {row.open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-fr-twisty" />
        )}
        <span className={`w-fr-dot w-fr-dot--${kindClass}`} />
        <span className={`w-fr-name${span === null || span.kind === 'run' || span.kind === 'wave' || span.kind === 'ticket' ? ' w-fr-name--strong' : ''}`}>{name}</span>
        {span !== null && span.attempt > 1 ? (
          <span className="w-fr-badge" data-testid="run-history-retry">
            #{span.attempt}
          </span>
        ) : null}
        {word !== null ? <span className={`w-fr-outcome w-fr-outcome--${word}`}>{word.toUpperCase()}</span> : null}
        {span !== null && span.lost !== null ? <span className="w-fr-lost-word">{lostWord(span)}</span> : null}
        {span === null ? (
          <span className="w-fr-muted">({row.children.length})</span>
        ) : span.kind === 'stage' || span.kind === 'ticket' ? (
          <span className="w-fr-muted">{formatDuration(spanDuration(span))}</span>
        ) : null}
      </div>
      <div className="w-fr-row__bars">
        {hatches.map((hatch) => (
          <div key={hatch.key} className="w-fr-hatch" style={{ left: hatch.left, width: Math.max(0, hatch.right - hatch.left) }} />
        ))}
        {bars.map((bar) => {
          const { span: of } = bar
          const token = tokenOf(of)
          const classes = ['w-fr-bar', `w-fr-bar--${token}`, TINTED.has(of.kind) ? 'w-fr-bar--tinted' : 'w-fr-bar--solid']
          if (bar.thin) classes.push('w-fr-bar--thin')
          if (of.lost !== null) classes.push('w-fr-bar--lost')
          if (of.outcome !== null) classes.push(`is-${of.outcome}`)
          if (of.id === selected) classes.push('is-selected')
          if (of.id === highlights.cause) classes.push('is-cause')
          return (
            <div
              key={bar.key}
              className={classes.join(' ')}
              data-testid="run-history-bar"
              data-bar-key={bar.key}
              data-span-id={of.id}
              title={tooltipOf(of)}
              style={{ left: bar.left, width: bar.right - bar.left }}
              onClick={(event) => {
                event.stopPropagation()
                selectSpan(of.id)
              }}
            />
          )
        })}
        {marks.map((mark) => (
          <div key={mark.key} className={`w-fr-mark w-fr-mark--${mark.kind}`} data-testid={mark.kind === 'block' ? 'run-history-block' : 'run-history-note'} title={mark.label} style={{ left: x(mark.at) - MARK_HALF }}>
            {mark.kind === 'block' ? '!' : 'i'}
          </div>
        ))}
        {[...bars.map((bar) => ({ key: bar.key, text: bar.label, onBand: !TINTED.has(bar.span.kind) && bar.span.lost === null })), ...marks.map((mark) => ({ key: mark.key, text: mark.label, onBand: false }))].map(({ key, text, onBand }) => {
          const place = places.get(key)
          if (place === undefined || place.placement === 'none') return null
          const style: CSSProperties = { left: place.x, width: place.width }
          const mark = marks.find((each) => each.key === key)
          const tone = mark !== undefined ? ` w-fr-label--${mark.kind}` : place.placement === 'inside' && onBand ? ' w-fr-label--on-band' : ''
          return (
            <div key={`label-${key}`} className={`w-fr-label${tone}`} data-testid="run-history-label" data-label-for={key} data-over={mark?.over?.join(' ') || undefined} data-placement={place.placement} style={style}>
              {text}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The rows that stay open under «Collapse»: the Run and its Waves. */
const OPEN_ON_COLLAPSE = new Set(['run', 'wave'])

/**
 * The controls over the tree, the axis and the rows of a Run. Under a filter (filter.ts) the tree shows the
 * spans it keeps with every row open, except those the user closes meanwhile; a new filter opens them again.
 */
export function Timeline({ view }: { view: RunView }) {
  const expanded = useRunHistory((state) => state.expanded)
  const chosen = useRunHistory((state) => state.window)
  const selected = useRunHistory((state) => state.selected)
  const [filter, setFilter] = useState<SpanFilter>(NO_FILTER)
  // The rows closed under the current filter.
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set())
  const [measure, width] = useWidth()
  const domain = runDomain(view)
  const window = chosen ?? domain
  const x = (at: number) => ((at - window.from) / (window.to - window.from)) * width
  const kept = useMemo(() => filterSpans(view.timeline, filter), [view, filter])
  const rows = useMemo(() => (kept === null ? buildRows(view.timeline.spans, expanded) : buildRows(kept, new Set(expandableIds(kept).filter((id) => !shut.has(id))))), [view, expanded, kept, shut])
  const highlights = useMemo(
    () =>
      highlightsOf(
        view.timeline.spans.find((span) => span.id === selected),
        view.timeline.spans,
      ),
    [view, selected],
  )
  const changeFilter = (next: SpanFilter) => {
    setFilter(next)
    setShut(new Set())
  }
  // A span selected from outside the tree (a card of the summary, a link of the panel) shows under the
  // filter: the rows above it closed under the filter open again, and a filter that hides it is cleared.
  // Only a new selection does so: a filter set while a span is selected may hide it. The state is
  // adjusted while rendering, as React advises for state that follows a prop, not in an effect.
  const [seen, setSeen] = useState(selected)
  if (seen !== selected) {
    setSeen(selected)
    if (selected !== null && kept !== null) {
      if (!kept.some((span) => span.id === selected)) changeFilter(NO_FILTER)
      else {
        const above = rowsAbove(selected, view.timeline.spans)
        if (above.some((id) => shut.has(id))) setShut(new Set([...shut].filter((id) => !above.includes(id))))
      }
    }
  }
  const onToggle = (id: string) => {
    if (kept === null) {
      toggleRow(id)
      return
    }
    setShut((before) => {
      const next = new Set(before)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const root = useRef<HTMLDivElement>(null)

  // Ctrl/Cmd + wheel zooms around the pointer, Shift + wheel moves; a plain wheel scrolls the rows.
  const latest = useRef({ window, domain, width })
  useLayoutEffect(() => {
    latest.current = { window, domain, width }
  })
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return
      event.preventDefault()
      const { window: current, domain: whole, width: barsWidth } = latest.current
      const bars = element.querySelector('.w-fr-axis')?.getBoundingClientRect()
      const fraction = bars === undefined || bars.width === 0 ? 0.5 : Math.max(0, Math.min(1, (event.clientX - bars.left) / bars.width))
      const span = current.to - current.from
      if (event.shiftKey && !(event.ctrlKey || event.metaKey)) {
        const delta = event.deltaY === 0 ? event.deltaX : event.deltaY
        const shift = (span * delta) / (barsWidth || DEFAULT_WIDTH)
        setTimeWindow(clampWindow({ from: current.from + shift, to: current.to + shift }, whole))
        return
      }
      const next = Math.max(MIN_WINDOW, Math.min(whole.to - whole.from, span * (event.deltaY > 0 ? 1.25 : 0.8)))
      const center = current.from + span * fraction
      setTimeWindow(clampWindow({ from: center - next * fraction, to: center + next * (1 - fraction) }, whole))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const zoomOut = () => {
    const span = (window.to - window.from) * 2
    const center = (window.from + window.to) / 2
    setTimeWindow(clampWindow({ from: center - span / 2, to: center + span / 2 }, domain))
  }
  const now = view.timeline.live ? x(view.timeline.now) : null

  return (
    <div ref={root} className="w-fr-timeline" data-testid="run-history-timeline" data-from={window.from} data-to={window.to} data-fit={chosen === null ? 'true' : 'false'}>
      <div className="w-fr-timeline__head">
        <div className="w-fr-row__tree w-fr-controls">
          <button type="button" className="w-fr-button" onClick={() => setTimeWindow(null)}>
            Fit
          </button>
          <button type="button" className="w-fr-button" onClick={zoomOut}>
            Zoom out
          </button>
          <button
            type="button"
            className="w-fr-button"
            onClick={() => {
              setShut(new Set())
              expandAll(expandableIds(view.timeline.spans))
            }}
          >
            Expand all
          </button>
          <button
            type="button"
            className="w-fr-button"
            onClick={() => {
              if (kept !== null) setShut(new Set(expandableIds(kept).filter((id) => !OPEN_ON_COLLAPSE.has(kept.find((span) => span.id === id)?.kind ?? ''))))
              collapseAll()
            }}
          >
            Collapse
          </button>
          <input
            type="search"
            className="w-fr-filter"
            aria-label="Filter: Ticket, agent, PR, cause"
            placeholder="Filter: Ticket, agent, PR, cause…"
            data-testid="run-history-filter"
            value={filter.text}
            onChange={(event) => changeFilter({ ...filter, text: event.target.value })}
          />
          <button
            type="button"
            className={`w-fr-button${filter.problemsOnly ? ' is-on' : ''}`}
            aria-pressed={filter.problemsOnly}
            title="Show only the failures, retries, blocks, cut-off spans and Waits"
            data-testid="run-history-problems"
            onClick={() => changeFilter({ ...filter, problemsOnly: !filter.problemsOnly })}
          >
            Problems only
          </button>
        </div>
        <div ref={measure} className="w-fr-timeline__axis">
          <Axis view={view} window={window} domain={domain} width={width} />
        </div>
      </div>
      <div className="w-fr-rows" data-testid="run-history-rows">
        {rows.map((row) => (
          <RowView key={row.id} row={row} view={view} x={x} width={width} highlights={highlights} onToggle={onToggle} />
        ))}
        {kept !== null && kept.length === 0 ? (
          <p className="w-fr-empty" data-testid="run-history-filter-empty">
            No span of this Run matches the filter.
          </p>
        ) : null}
        {now !== null && now >= 0 && now <= width ? <div className="w-fr-now" data-testid="run-history-now" data-at={view.timeline.now} style={{ left: `calc(var(--w-fr-tree) + ${now}px)` }} title={`now ${formatClock(view.timeline.now)}`} /> : null}
      </div>
    </div>
  )
}

