import type { CSSProperties } from 'react'
import type { LimitBar, LimitLevel } from '../../shared/agent/limits'

// One Limits window drawn as a bar in the toolbar (src/renderer/shell/toolbar/LimitsMeter.tsx).
// The Limits are shown only there: the Session view's rail no longer repeats them.

const FILL: Record<LimitLevel, string> = {
  normal: 'var(--text-secondary)',
  working: 'var(--working-dot)',
  blocked: 'var(--blocked-ring)',
}

const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

/** The share as a bar; an empty track when the source gave no share. */
function Meter({ bar, height }: { bar: LimitBar; height: number }) {
  const track: CSSProperties = { height, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }
  if (bar.percent === null) return <div style={track} aria-hidden="true" />
  return (
    <div role="meter" aria-label={`${bar.label} limit`} aria-valuenow={bar.percent} aria-valuemin={0} aria-valuemax={100} style={track}>
      <div style={{ width: `${Math.min(bar.percent, 100)}%`, height, background: FILL[bar.level] }} />
    </div>
  )
}

/** How a bar whose data is older than an hour is drawn: the same lines, dimmed. */
export const STALE_OPACITY = 0.55

/**
 * One window: label and share (or status in words) on the first line, the bar, then the reset
 * time. Data older than an hour adds no line: the bar is dimmed and its tooltip is the value and
 * "as of <time>" (`62% · as of 13:05`; the value stays readable when it is cut), so the toolbar
 * never grows. `testId` names the bar and, with a suffix, its value and reset line: `limit-<window>` by
 * default; the toolbar gives another Vendor's bars its id as well (`limit-codex-primary`).
 * `compact`: the narrower bar of a toolbar with several Vendor sections, whose reset line is the time
 * alone (`Fri 03:18`), with the whole line as its tooltip.
 *
 * In a narrow window (worfy-polish ticket 48, the rule in src/renderer/shell/shell.css) the toolbar
 * shows the value alone: the label and the reset line are hidden, so the value's tooltip names them
 * all (`5-hour: 62% · resets Thu 09:00`, and `· as of 13:05` for old data). The width of a bar is
 * set there too.
 */
export function LimitBarView({ bar, testId = `limit-${bar.window}`, compact = false }: { bar: LimitBar; testId?: string; compact?: boolean }) {
  const valueColor = bar.level === 'blocked' ? 'var(--blocked-text)' : 'var(--text)'
  const stale = bar.asOf !== null
  return (
    <div
      data-testid={testId}
      data-level={bar.level}
      data-stale={stale ? 'true' : undefined}
      title={stale ? `${bar.value} · ${bar.asOf}` : undefined}
      className={compact ? 'w-limit-bar w-limit-bar--compact' : 'w-limit-bar'}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, ...(stale ? { opacity: STALE_OPACITY } : {}) }}
    >
      {/* One line: a status in words ("limit reached") is set in the UI font, which is narrower
          than mono, and anything still wider ends with an ellipsis instead of wrapping. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 'var(--text-11)', lineHeight: '13px', whiteSpace: 'nowrap' }}>
        <span className="w-limit-bar__label" style={{ flex: 'none', color: 'var(--text-secondary)' }}>
          {bar.label}
        </span>
        <span
          title={valueTooltip(bar)}
          style={{ ...(bar.percent === null ? {} : mono), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: valueColor }}
          data-testid={`${testId}-value`}
        >
          {bar.value}
        </span>
      </div>
      <Meter bar={bar} height={4} />
      {bar.resets !== null && <ResetsLine text={bar.resets} testId={`${testId}-note`} compact={compact} />}
    </div>
  )
}

/** The whole of a bar in one line, for the tooltip of its value: its label, value, reset line and age. */
function valueTooltip(bar: LimitBar): string {
  return [`${bar.label}: ${bar.value}`, bar.resets, bar.asOf].filter((part) => part !== null).join(' · ')
}

const RESETS = 'resets '

/**
 * The reset line, `resets Thu 09:00`: the word in the UI font, the time in mono, as in the F
 * mockup; in a compact bar the time alone. A line wider than the bar ends with an ellipsis rather
 * than running into the next bar; the full line is its tooltip.
 */
function ResetsLine({ text, testId, compact }: { text: string; testId: string; compact: boolean }) {
  const line: CSSProperties = { fontSize: 'var(--text-11)', lineHeight: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  if (!text.startsWith(RESETS) || compact) {
    return (
      <div className="w-limit-bar__resets" style={{ ...line, ...mono }} title={text} data-testid={testId}>
        {compact && text.startsWith(RESETS) ? text.slice(RESETS.length) : text}
      </div>
    )
  }
  return (
    <div className="w-limit-bar__resets" style={line} title={text} data-testid={testId}>
      {RESETS}
      <span style={mono}>{text.slice(RESETS.length)}</span>
    </div>
  )
}
