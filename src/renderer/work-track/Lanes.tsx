// The lanes of Work track (worfy-work-track ticket 09; spec «What the owner sees», 4–6): a column of names on
// the left — ▸ unfolds the Subagents of a Session, the chips `hidden`, `archived` and the Vendor — and the
// track of each lane on the right: Runs and Waves as framed bars, the turns of a Session in its colour, the
// Subagents by their kind, an outcome `failed` or `rejected` underlined in the problem colour, the folded
// Subagents of a Session as a strip, «no data» hatched with its source and why in the tooltip, and the «now»
// line. Above them the axis: the hours of a Day, the days of a Week (a click opens the Day), the merged PRs
// as diamonds; the Month is cells of days instead (MonthGrid.tsx).
//
// The lanes are the model's (src/shared/work-track/lanes.ts) over main's answer; positions are percents of
// the period, so the track needs no measuring but for whether a label fits in its bar.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { intervalUnionLength } from '../../shared/flight-recorder/summary'
import { agentSubkind } from '../../shared/flight-recorder/spans'
import type { WorkTrackView } from '../../shared/ipc/work-track'
import { vendorLabel } from '../../shared/vendors/vendor'
import { WORK_SOURCE_LABELS, type WorkFact } from '../../shared/work-track/facts'
import { lanesByEpic, lanesBySession, offLaneSpans, periodBounds, periodDays, type Lane, type LaneGap, type WorkSpan } from '../../shared/work-track/lanes'
import { formatClock, formatDuration, formatLocal } from '../flight-recorder/store'
import { MonthAxis, MonthCells } from './MonthGrid'
import { dayName, hoursText, monthScale, openDay, startOfDay, toggleSession, type Density, type LaneMode } from './store'

/** The width of the column of names, as the prototype has it. */
const NAMES_WIDTH = 230
const HOUR = 3_600_000
/** At most this many bars side by side in a lane; more share the last line. */
const MAX_LINES = 4

/** The colour class of a span: `w-wt-bar--<colour>`. */
function colourOf(span: Pick<WorkSpan, 'kind' | 'title'>): string {
  switch (span.kind) {
    case 'run':
    case 'wave':
    case 'turn':
    case 'gate':
      return span.kind
    case 'subagent': {
      const kind = agentSubkind(span.title)
      return kind === 'other' ? 'agent' : kind
    }
    default:
      return 'agent'
  }
}

function laneColour(lane: Lane): string {
  switch (lane.kind) {
    case 'runs':
      return 'wave'
    case 'session':
      return 'turn'
    case 'subagent':
      return colourOf({ kind: 'subagent', title: lane.title })
    case 'epic':
      return 'epic'
    case 'gate':
      return 'gate'
  }
}

/** The tooltip of a span: its name, its time and duration as the sources have them, its Epic and Ticket. */
function spanTip(span: WorkSpan, fact: WorkFact | undefined): string {
  const start = fact === undefined ? span.start : Date.parse(fact.start)
  const end = fact?.end == null ? span.end : Date.parse(fact.end)
  const until = span.open ? 'now' : startOfDay(start) === startOfDay(end) ? formatClock(end) : formatLocal(end)
  const when = [`${formatLocal(start)} – ${until}`, formatDuration(end - start)]
  if (span.outcome !== null && span.outcome !== 'ok') when.push(span.outcome)
  if (span.open) when.push('going on')
  const lines = [span.title, when.join(' · ')]
  const where = [span.epic, span.ticket].filter((part) => part !== null && part !== undefined).join(' ')
  if (where !== '') lines.push(where)
  if (span.pr !== undefined && span.kind !== 'pr') lines.push(`PR #${span.pr}`)
  return lines.join('\n')
}

const gapTip = (gap: LaneGap): string => `No data · ${WORK_SOURCE_LABELS[gap.source]}\n${gap.why}`

/** Each span's line in its lane: the first line free at its start. */
function packLines(spans: readonly WorkSpan[]): { lines: Map<string, number>; count: number } {
  const ends: number[] = []
  const lines = new Map<string, number>()
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    let line = ends.findIndex((end) => end <= span.start)
    if (line === -1) line = ends.length < MAX_LINES ? ends.length : MAX_LINES - 1
    ends[line] = Math.max(ends[line] ?? 0, span.end)
    lines.set(span.id, line)
  }
  return { lines, count: Math.max(1, ends.length) }
}

/** The lanes on screen top to bottom: each lane, then the lanes unfolded under it. */
function flatten(lanes: readonly Lane[]): Lane[] {
  return lanes.flatMap((lane) => [lane, ...flatten(lane.children)])
}

/** The width of the tracks in pixels, for whether a label fits; 0 until measured (and in a test DOM). */
function useTrackWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(Math.max(0, element.clientWidth - NAMES_WIDTH)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

interface Scale {
  start: number
  end: number
}

const percent = (time: number, scale: Scale): number => ((Math.min(Math.max(time, scale.start), scale.end) - scale.start) / (scale.end - scale.start)) * 100
const stretch = (from: number, to: number, scale: Scale): CSSProperties => {
  const left = percent(from, scale)
  return { left: `${left}%`, width: `${percent(to, scale) - left}%` }
}

function Gaps({ gaps, scale, width }: { gaps: readonly LaneGap[]; scale: Scale; width: number }) {
  return (
    <>
      {gaps.map((gap) => {
        const wide = ((percent(gap.end, scale) - percent(gap.start, scale)) / 100) * width > 110
        return (
          <div key={`${gap.source}-${gap.start}`} className="w-wt-gap" data-testid="work-track-gap" title={gapTip(gap)} style={stretch(gap.start, gap.end, scale)}>
            {wide ? <span className="w-wt-gap__label">no data · {WORK_SOURCE_LABELS[gap.source]}</span> : null}
          </div>
        )
      })}
    </>
  )
}

interface BarsProps {
  lane: Lane
  scale: Scale
  width: number
  facts: ReadonlyMap<string, WorkFact>
  comfortable: boolean
  lines: { lines: Map<string, number>; count: number } | null
}

function Bars({ lane, scale, width, facts, comfortable, lines }: BarsProps) {
  return (
    <>
      {lane.spans.map((span) => {
        const box = stretch(span.start, span.end, scale)
        const pixels = ((percent(span.end, scale) - percent(span.start, scale)) / 100) * width
        const label = (comfortable || span.kind === 'wave') && span.kind !== 'run' && pixels > span.title.length * 6 + 10 ? span.title : null
        const line = lines?.lines.get(span.id)
        const style: CSSProperties = line === undefined || lines === null ? box : { ...box, top: `calc(var(--w-wt-pad) + ${line} * var(--w-wt-bar))`, height: 'calc(var(--w-wt-bar) - 1px)', bottom: 'auto' }
        const problem = span.outcome === 'failed' || span.outcome === 'rejected'
        return (
          <div
            key={span.id}
            className={`w-wt-bar w-wt-bar--${colourOf(span)}${problem ? ' w-wt-bar--problem' : ''}`}
            data-testid="work-track-span"
            data-span-id={span.id}
            title={spanTip(span, facts.get(span.id))}
            style={style}
          >
            {label}
          </div>
        )
      })}
      {lane.strip.map((span) => (
        <div key={span.id} className={`w-wt-strip w-wt-bar--${colourOf(span)}`} data-testid="work-track-strip" style={stretch(span.start, span.end, scale)} />
      ))}
    </>
  )
}

/** The left cell of a lane: ▸, its colour, its name and marks. */
function LaneName({ lane }: { lane: Lane }) {
  const session = lane.session
  let note: ReactNode = null
  if (lane.kind === 'runs') note = '· Run journals'
  else if (lane.kind === 'gate') note = '· gate logs'
  else if (lane.kind === 'epic') note = hoursText(intervalUnionLength(lane.spans.map((span) => [span.start, span.end] as const)))
  else if (lane.subagents > 0) note = `· ${lane.subagents} Subagent${lane.subagents === 1 ? '' : 's'}`
  const toggle =
    lane.kind === 'session' && lane.subagents > 0 && session !== undefined ? (
      <button
        type="button"
        className="w-wt-toggle"
        aria-expanded={lane.expanded}
        aria-label={`${lane.expanded ? 'Hide' : 'Show'} the Subagents of ${lane.title}`}
        onClick={() => toggleSession(session.id)}
      >
        {lane.expanded ? '▾' : '▸'}
      </button>
    ) : (
      <span className="w-wt-toggle" aria-hidden="true" />
    )
  return (
    <div className="w-wt-name" style={{ paddingLeft: `${4 + lane.depth * 14}px` }}>
      {toggle}
      <i className={`w-wt-name__kind w-wt-colour--${laneColour(lane)}`} aria-hidden="true" />
      <span className="w-wt-name__text" title={lane.title}>
        {lane.title}
      </span>
      {session?.hidden ? <span className="w-wt-chip">hidden</span> : null}
      {session?.archived ? <span className="w-wt-chip">archived</span> : null}
      {session !== undefined && session.vendor !== 'claude' ? <span className="w-wt-chip">{vendorLabel(session.vendor, 'short')}</span> : null}
      {note !== null ? <span className="w-wt-name__note">{note}</span> : null}
    </div>
  )
}

/** The axis of a Day (every two hours) or a Week (a button per day), with the merged PRs as diamonds. */
function Axis({ view, scale, prs, width }: { view: WorkTrackView; scale: Scale; prs: readonly WorkSpan[]; width: number }) {
  const days = periodDays(view.period)
  const ticks: ReactNode[] =
    view.period.kind === 'week'
      ? days.map((day) => (
          <button key={day} type="button" className="w-wt-tick w-wt-tick--day" data-testid="work-track-day" aria-label={`Open ${dayName(day)}`} title={`Open ${dayName(day)}`} style={{ left: `${percent(day, scale)}%` }} onClick={() => void openDay(day)}>
            {dayName(day)}
          </button>
        ))
      : Array.from({ length: 12 }, (_, index) => {
          const date = new Date(scale.start)
          const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), index * 2).getTime()
          return (
            <span key={at} className="w-wt-tick" style={{ left: `${percent(at, scale)}%` }}>
              {formatClock(at)}
            </span>
          )
        })
  // The PR numbers fit beside their diamonds only when a Day spreads them out.
  const numbered = view.period.kind === 'day' && prs.length * 48 < width
  return (
    <>
      {ticks}
      {prs.map((span) => (
        <span
          key={span.id}
          className="w-wt-pr"
          data-testid="work-track-pr"
          title={[`PR #${span.pr ?? '?'} merged`, formatLocal(span.end), [span.epic, span.ticket].filter((part) => part !== null && part !== undefined).join(' ')].filter((line) => line !== '').join('\n')}
          style={{ left: `${percent(span.end, scale)}%` }}
        >
          {numbered && span.pr !== undefined ? <span className="w-wt-pr__number">#{span.pr}</span> : null}
        </span>
      ))}
    </>
  )
}

/** The lines of the grid: the days of a Week, every two hours of a Day, every day of a Month. */
function gridTimes(view: WorkTrackView, scale: Scale): number[] {
  if (view.period.kind !== 'day') return periodDays(view.period).slice(1)
  return Array.from({ length: 11 }, (_, index) => {
    const date = new Date(scale.start)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), (index + 1) * 2).getTime()
  })
}

export interface LanesProps {
  view: WorkTrackView
  mode: LaneMode
  expanded: ReadonlySet<string>
  density: Density
}

export function Lanes({ view, mode, expanded, density }: LanesProps) {
  const [ref, width] = useTrackWidth()
  const lanes = useMemo(() => flatten(mode === 'session' ? lanesBySession(view, { expanded }) : lanesByEpic(view)), [view, mode, expanded])
  const facts = useMemo(() => new Map(view.facts.map((fact) => [fact.id, fact])), [view])
  const scale = periodBounds(view.period)
  const month = view.period.kind === 'month'
  const days = useMemo(() => periodDays(view.period), [view])
  const prs = useMemo(() => offLaneSpans(view).filter((span) => span.kind === 'pr' && !span.open && !span.clippedEnd), [view])
  const shade = useMemo(() => (month ? monthScale(lanes, days) : HOUR), [month, lanes, days])
  const now = Date.parse(view.now)
  const comfortable = density === 'comfortable'

  return (
    <div className="w-wt-main" ref={ref} data-testid="work-track-lanes" style={{ '--w-wt-names': `${NAMES_WIDTH}px` } as CSSProperties}>
      <div className="w-wt-axisrow">
        <div className="w-wt-name w-wt-name--axis">{month ? 'Day · PRs merged — click a day to open it' : 'Time (local) · ◆ PR merged'}</div>
        <div className="w-wt-axis" data-testid="work-track-axis">
          {month ? <MonthAxis view={view} days={days} /> : <Axis view={view} scale={scale} prs={prs} width={width} />}
        </div>
      </div>
      <div className="w-wt-rows">
        <div className="w-wt-rows__inner">
          <div className="w-wt-grid" aria-hidden="true">
            {gridTimes(view, scale).map((time) => (
              <span key={time} className="w-wt-grid__line" style={{ left: `${percent(time, scale)}%` }} />
            ))}
            {!month && now >= scale.start && now < scale.end ? <span className="w-wt-now" data-testid="work-track-now" style={{ left: `${percent(now, scale)}%` }} /> : null}
          </div>
          {lanes.map((lane) => {
            const lines = month || lane.kind === 'runs' ? null : packLines(lane.spans)
            const style = { '--w-wt-lines': lines?.count ?? 1 } as CSSProperties
            return (
              <div key={lane.id} className={`w-wt-lane w-wt-lane--${lane.kind}`} data-testid="work-track-lane" data-lane-id={lane.id} data-lane-title={lane.title} style={style}>
                <LaneName lane={lane} />
                <div className="w-wt-track">
                  <Gaps gaps={lane.gaps} scale={scale} width={width} />
                  {month ? (
                    <MonthCells lane={lane} days={days} scale={shade} colour={laneColour(lane)} comfortable={comfortable} />
                  ) : (
                    <Bars lane={lane} scale={scale} width={width} facts={facts} comfortable={comfortable} lines={lines} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
