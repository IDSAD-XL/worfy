import type { CSSProperties } from 'react'
import { limitBars, type LimitBar, type LimitLevel, type LimitsState } from '../../../shared/agent/limits'
import { useLimits, useNow } from '../../limits/useLimits'

// The Limits in the toolbar: a bar for the 5-hour and one for the 7-day window, with the used share
// and the reset time (main keeps them, src/main/agent/limits.ts). The Session rail draws the same
// bars smaller (src/renderer/session/rail/LimitsRail.tsx) with LimitBarView from here; both read
// the Limits through src/renderer/limits/useLimits.ts.

// Before the app version (1000), which stays last.
export const order = 100

const FILL: Record<LimitLevel, string> = {
  normal: 'var(--text-secondary)',
  working: 'var(--working-dot)',
  blocked: 'var(--blocked-ring)',
}

const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

export type LimitBarVariant = 'toolbar' | 'rail'

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

/** One window: label, share (or status in words), bar, reset time and, when old, "as of". */
export function LimitBarView({ bar, variant }: { bar: LimitBar; variant: LimitBarVariant }) {
  const valueColor = bar.level === 'blocked' ? 'var(--blocked-text)' : 'var(--text)'
  const note = [bar.resets, bar.asOf].filter((part) => part !== null).join(' · ')
  const common = { 'data-testid': `limit-${bar.window}`, 'data-level': bar.level }

  if (variant === 'rail') {
    return (
      <div {...common}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--text-12)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{bar.label}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...mono, fontWeight: 600, color: valueColor }} data-testid={`limit-${bar.window}-value`}>
            {bar.value}
          </span>
          {note && (
            <span style={{ ...mono, fontSize: 'var(--text-11)', color: 'var(--text-muted)' }} data-testid={`limit-${bar.window}-note`}>
              · {note}
            </span>
          )}
        </div>
        <div style={{ marginTop: 6 }}>
          <Meter bar={bar} height={6} />
        </div>
      </div>
    )
  }

  return (
    <div {...common} style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 104 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-11)', lineHeight: '13px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{bar.label}</span>
        <span style={{ ...mono, fontWeight: 600, color: valueColor }} data-testid={`limit-${bar.window}-value`}>
          {bar.value}
        </span>
      </div>
      <Meter bar={bar} height={4} />
      {note && (
        <div style={{ ...mono, fontSize: 'var(--text-11)', lineHeight: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }} data-testid={`limit-${bar.window}-note`}>
          {note}
        </div>
      )}
    </div>
  )
}

/** The bars of `state` at `now`, or "no data yet"; exported for tests, which pass their own state. */
export function LimitsMeterView({ state, now, timeZone }: { state: LimitsState; now: number; timeZone?: string }) {
  const bars = limitBars(state, now, timeZone === undefined ? {} : { timeZone })
  return (
    <div role="group" aria-label="Limits" data-testid="limits-meter" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
      <span style={{ fontSize: 'var(--text-11)', fontWeight: 600, color: 'var(--text-muted)' }}>Limits</span>
      {bars === null ? (
        <span style={{ fontSize: 'var(--text-11)', color: 'var(--text-muted)' }} data-testid="limits-empty">
          no data yet
        </span>
      ) : (
        bars.map((bar) => <LimitBarView key={bar.window} bar={bar} variant="toolbar" />)
      )}
    </div>
  )
}

export default function LimitsMeter() {
  return <LimitsMeterView state={useLimits()} now={useNow()} />
}
