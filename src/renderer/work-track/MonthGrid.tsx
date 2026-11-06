// The Month of Work track (worfy-work-track ticket 09; owner decision 8): the axis is the days of the Month,
// each with its merged PRs, and each lane is a row of day cells shaded by its hours of work that day (the
// Gate runs lane by its number of runs). A click on a day — on the axis or in a cell — opens its Day.
import type { CSSProperties } from 'react'
import type { WorkTrackView } from '../../shared/ipc/work-track'
import type { Lane } from '../../shared/work-track/lanes'
import { cellOf, dayName, hoursText, openDay } from './store'

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** The full-shade count of gate runs in a day. */
const GATE_SCALE = 20

const place = (index: number, count: number): CSSProperties => ({ left: `${(index / count) * 100}%`, width: `${100 / count}%` })

/** The axis of the Month: a button per day with its date, its weekday and its merged PRs. */
export function MonthAxis({ view, days }: { view: WorkTrackView; days: readonly number[] }) {
  const byDay = new Map(view.summary.days.map((each) => [each.start, each]))
  return (
    <>
      {days.map((day, index) => {
        const summary = byDay.get(day)
        const merged = summary?.prsMerged ?? 0
        const date = new Date(day)
        return (
          <button
            key={day}
            type="button"
            className="w-wt-month-day"
            data-testid="work-track-month-day"
            aria-label={`Open ${dayName(day)}`}
            title={`${dayName(day)}: ${hoursText(summary?.workMs ?? 0)} of work, ${merged} PR${merged === 1 ? '' : 's'} merged · click to open this day`}
            style={place(index, days.length)}
            onClick={() => void openDay(day)}
          >
            <b>{date.getDate()}</b>
            <i>
              {WEEKDAY_LETTERS[date.getDay()]} · {merged}
            </i>
          </button>
        )
      })}
    </>
  )
}

/** The cells of one lane over the Month, shaded by `scale`; the numbers written in when comfortable. */
export function MonthCells({ lane, days, scale, colour, comfortable }: { lane: Lane; days: readonly number[]; scale: number; colour: string; comfortable: boolean }) {
  return (
    <>
      {days.map((day, index) => {
        const cell = cellOf(lane, day)
        if (cell === null) return null
        const share = Math.min(1, cell.value / (lane.kind === 'gate' ? GATE_SCALE : scale))
        return (
          <button
            key={day}
            type="button"
            className={`w-wt-cell w-wt-colour--${colour}`}
            data-testid="work-track-day-cell"
            data-day={new Date(day).getDate()}
            title={`${dayName(day)}: ${cell.words} · click to open this day`}
            style={{ ...place(index, days.length), '--w-wt-shade': `${Math.round(18 + share * 62)}%` } as CSSProperties}
            onClick={() => void openDay(day)}
          >
            {comfortable ? cell.text : null}
          </button>
        )
      })}
    </>
  )
}
