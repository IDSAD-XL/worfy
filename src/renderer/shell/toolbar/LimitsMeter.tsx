import { limitBars, type LimitsState } from '../../../shared/agent/limits'
import { LimitBarView } from '../../limits/LimitBar'
import { useLimits, useNow } from '../../limits/useLimits'

// The Limits in the toolbar: a bar for the 5-hour and one for the 7-day window, with the used share
// and the reset time (main keeps them, src/main/agent/limits.ts). The bars are drawn with
// src/renderer/limits/LimitBar.tsx and the Limits read through src/renderer/limits/useLimits.ts.
// This is the only place worfy shows the Limits; the Session view's rail does not repeat them.

// Before the app version (1000), which stays last.
export const order = 100

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
        bars.map((bar) => <LimitBarView key={bar.window} bar={bar} />)
      )}
    </div>
  )
}

export default function LimitsMeter() {
  return <LimitsMeterView state={useLimits()} now={useNow()} />
}
