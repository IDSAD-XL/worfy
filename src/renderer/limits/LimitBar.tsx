import type { CSSProperties } from 'react'
import type { LimitBar, LimitLevel } from '../../shared/agent/limits'
import { AnimatedNumber } from '../theme/AnimatedNumber'

// One Limits window drawn as a bar in the toolbar (src/renderer/shell/toolbar/LimitsMeter.tsx).
// The Limits are shown only there: the Session view's rail no longer repeats them.

const FILL: Record<LimitLevel, string> = {
  normal: 'var(--text-secondary)',
  working: 'var(--working-dot)',
  blocked: 'var(--blocked-ring)',
}

// Figures in the UI font with tabular digits rather than mono (worfy-polish ticket 93): as wide for
// every share and time, and narrower than mono, so a Vendor's line takes less of the toolbar.
const digits: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** The height of the bar under a window's line. */
const METER_HEIGHT = 2

/** The share as a bar; an empty track when the source gave no share. */
function Meter({ bar }: { bar: LimitBar }) {
  const track: CSSProperties = { height: METER_HEIGHT, borderRadius: 1, background: 'var(--border)', overflow: 'hidden' }
  if (bar.percent === null) return <div className="w-limit-bar__meter" style={track} aria-hidden="true" />
  return (
    <div className="w-limit-bar__meter" role="meter" aria-label={`${bar.label} limit`} aria-valuenow={bar.percent} aria-valuemin={0} aria-valuemax={100} style={track}>
      <div style={{ width: `${Math.min(bar.percent, 100)}%`, height: METER_HEIGHT, background: FILL[bar.level] }} />
    </div>
  )
}

/**
 * The short label a window shows in the toolbar (owner, 2026-11-10, worfy-polish ticket 93): `5h` and `7d`
 * whichever Vendor names the window, so a Vendor's line takes less width. Only the visible label: the
 * meter's accessible name and the value's tooltip keep the window's own label (`5-hour: 62% · …`), and so
 * do the labels in src/shared/agent/limits.ts and src/main/vendors/codex/limits.ts, which other places
 * (Auto-continue, Autopilot) use. A label without an obvious short form (`monthly`, `annual`, `usage`)
 * stays as it is.
 */
const SHORT_LABELS: Readonly<Record<string, string>> = { '5-hour': '5h', '7-day': '7d', daily: '1d', weekly: '7d' }

/** The label a window shows in the toolbar: its short form, or its own label. */
function shortLabel(label: string): string {
  return Object.hasOwn(SHORT_LABELS, label) ? SHORT_LABELS[label]! : label
}

/** How a bar whose data is older than an hour is drawn: the same lines, dimmed. */
export const STALE_OPACITY = 0.55

/**
 * One window in one line (worfy-polish ticket 93): its short label (`5h`, `7d`), its share (or status in words) and its
 * reset time, with a thin bar under them. The windows of one Vendor stand one above the other in a grid
 * (`w-limits-stack`, src/renderer/shell/shell.css), whose columns line the labels, shares and times up;
 * a window is a row of that grid (CSS subgrid). The reset line is the time alone (`Mon 09:00`), with the
 * whole line as its tooltip (`resets Mon 09:00`).
 *
 * Data older than an hour adds no line: the bar is dimmed and its tooltip is the value and "as of
 * <time>" (`62% · as of 13:05`), so the toolbar never grows. `testId` names the bar and, with a suffix,
 * its value and reset line: `limit-<window>` by default; the toolbar gives another Vendor's bars its id
 * as well (`limit-codex-primary`).
 *
 * In a narrow window (worfy-polish ticket 48, the rule in src/renderer/shell/shell.css) the toolbar
 * shows the value alone: the label and the reset line are hidden, so the value's tooltip names them
 * all (`5-hour: 62% · resets Thu 09:00`, and `· as of 13:05` for old data).
 */
export function LimitBarView({ bar, testId = `limit-${bar.window}` }: { bar: LimitBar; testId?: string }) {
  const valueColor = bar.level === 'blocked' ? 'var(--blocked-text)' : 'var(--text)'
  const stale = bar.asOf !== null
  return (
    <div
      data-testid={testId}
      data-level={bar.level}
      data-stale={stale ? 'true' : undefined}
      title={stale ? `${bar.value} · ${bar.asOf}` : undefined}
      className="w-limit-bar"
      style={stale ? { opacity: STALE_OPACITY } : undefined}
    >
      <span className="w-limit-bar__label">{shortLabel(bar.label)}</span>
      {/* A status in words ("limit reached") takes the reset time's column too when there is no reset time. */}
      <span
        className={bar.resets === null ? 'w-limit-bar__value w-limit-bar__value--wide' : 'w-limit-bar__value'}
        title={valueTooltip(bar)}
        style={{ ...(bar.percent === null ? {} : digits), color: valueColor }}
        data-testid={`${testId}-value`}
      >
        {/* A share rolls to its new value; a status in words is plain text. `value` is `${percent}%` when there is a share (src/shared/agent/limits.ts). */}
        {bar.percent === null ? bar.value : <AnimatedNumber value={bar.percent} suffix="%" />}
      </span>
      {bar.resets !== null && <ResetsLine text={bar.resets} testId={`${testId}-note`} />}
      <Meter bar={bar} />
    </div>
  )
}

/** The whole of a bar in one line, for the tooltip of its value: its label, value, reset line and age. */
function valueTooltip(bar: LimitBar): string {
  return [`${bar.label}: ${bar.value}`, bar.resets, bar.asOf].filter((part) => part !== null).join(' · ')
}

const RESETS = 'resets '

/** The reset time alone, in tabular digits (`Thu 09:00`); the whole line, `resets Thu 09:00`, is its tooltip. */
function ResetsLine({ text, testId }: { text: string; testId: string }) {
  return (
    <span className="w-limit-bar__resets" style={digits} title={text} data-testid={testId}>
      {text.startsWith(RESETS) ? text.slice(RESETS.length) : text}
    </span>
  )
}
