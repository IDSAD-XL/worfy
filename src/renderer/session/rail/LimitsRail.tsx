import { limitBars, type LimitsState } from '../../../shared/agent/limits'
import { LimitBarView } from '../../limits/LimitBar'
import { useLimits, useNow } from '../../limits/useLimits'

// The Limits in the Session rail: the toolbar's two bars, in a card under a heading. The Limits are
// the same for every Session, so the block ignores which Session the view shows.

// After the Binding and the Subagent tree.
export const order = 90

/** The block for `state` at `now`; exported for tests, which pass their own state. */
export function LimitsRailView({ state, now, timeZone }: { state: LimitsState; now: number; timeZone?: string }) {
  const bars = limitBars(state, now, timeZone === undefined ? {} : { timeZone })
  return (
    <div data-testid="limits-rail">
      <h2 style={{ margin: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' }}>Limits</h2>
      <div
        style={{
          marginTop: 6,
          padding: 10,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-node)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {bars === null ? (
          <span style={{ fontSize: 'var(--text-12)', color: 'var(--text-muted)' }}>No data yet</span>
        ) : (
          bars.map((bar) => <LimitBarView key={bar.window} bar={bar} variant="rail" />)
        )}
      </div>
    </div>
  )
}

export default function LimitsRail() {
  return <LimitsRailView state={useLimits()} now={useNow()} />
}
