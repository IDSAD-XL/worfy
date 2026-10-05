import type { CSSProperties } from 'react'
import type { LimitBar, LimitLevel } from '../../shared/agent/limits'

// One Limits window drawn as a bar: the toolbar (src/renderer/shell/toolbar/LimitsMeter.tsx) and
// the Session rail (src/renderer/session/rail/LimitsRail.tsx) both use it, so it lives here and
// neither extension depends on the other.

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
