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
 * time. Data older than an hour adds no line: the bar is dimmed and "as of <time>" is its tooltip,
 * so the toolbar never grows.
 */
export function LimitBarView({ bar }: { bar: LimitBar }) {
  const valueColor = bar.level === 'blocked' ? 'var(--blocked-text)' : 'var(--text)'
  const stale = bar.asOf !== null
  return (
    <div
      data-testid={`limit-${bar.window}`}
      data-level={bar.level}
      data-stale={stale ? 'true' : undefined}
      title={bar.asOf ?? undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 104, ...(stale ? { opacity: STALE_OPACITY } : {}) }}
    >
      {/* One line: a status in words ("limit reached") is set in the UI font, which is narrower
          than mono, and anything still wider ends with an ellipsis instead of wrapping. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 'var(--text-11)', lineHeight: '13px', whiteSpace: 'nowrap' }}>
        <span style={{ flex: 'none', color: 'var(--text-secondary)' }}>{bar.label}</span>
        <span
          title={stale ? undefined : bar.value}
          style={{ ...(bar.percent === null ? {} : mono), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: valueColor }}
          data-testid={`limit-${bar.window}-value`}
        >
          {bar.value}
        </span>
      </div>
      <Meter bar={bar} height={4} />
      {bar.resets !== null && <ResetsLine text={bar.resets} testId={`limit-${bar.window}-note`} />}
    </div>
  )
}

const RESETS = 'resets '

/**
 * The reset line, `resets Thu 09:00`: the word in the UI font, the time in mono, as in the F
 * mockup. A line wider than the bar ends with an ellipsis rather than running into the next bar.
 */
function ResetsLine({ text, testId }: { text: string; testId: string }) {
  const line: CSSProperties = { fontSize: 'var(--text-11)', lineHeight: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  if (!text.startsWith(RESETS)) {
    return (
      <div style={{ ...line, ...mono }} data-testid={testId}>
        {text}
      </div>
    )
  }
  return (
    <div style={line} data-testid={testId}>
      {RESETS}
      <span style={mono}>{text.slice(RESETS.length)}</span>
    </div>
  )
}
