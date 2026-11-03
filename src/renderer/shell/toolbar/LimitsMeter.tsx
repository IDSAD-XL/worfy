import { limitSections, type LimitSection, type LimitsView } from '../../../shared/agent/limits'
import { LimitBarView } from '../../limits/LimitBar'
import { useLimits, useNow } from '../../limits/useLimits'

// The Limits in the toolbar: a section per Vendor, each with its name and its windows' bars — Claude's
// 5-hour and 7-day, then each other Vendor signed in to (Codex) with the windows its plan reports,
// shortest first, or "No limits reported" (worfy-multi-vendor ticket 26). A Vendor signed out has no
// section. Main keeps the Limits (src/main/agent/limits.ts); the bars are drawn with
// src/renderer/limits/LimitBar.tsx and the Limits read through src/renderer/limits/useLimits.ts.
// This is the only place worfy shows the Limits; the Session view's rail does not repeat them.
//
// With more than one section the panel is compact, so that it, the Harness column and the search field
// stay whole in a 1280 px window (test/e2e/limits-vendors.spec.ts): no "Limits" heading (the group keeps
// it as its name), smaller gaps, and narrower bars whose reset line is the time alone, the whole line
// as its tooltip. With Claude's section alone it looks as before.

// Before the Harness item (500), which carries the app version.
export const order = 100

const GAP = 12
const COMPACT_GAP = 8

const muted = { fontSize: 'var(--text-11)', color: 'var(--text-muted)' } as const

/**
 * One Vendor's section. Claude's bars keep their test ids (`limit-five_hour`); another Vendor's carry
 * its id (`limit-codex-primary`), since its window ids are its own.
 */
function SectionView({ section, first, compact }: { section: LimitSection; first: boolean; compact: boolean }) {
  const prefix = first ? 'limit' : `limit-${section.vendor}`
  return (
    <div role="group" aria-label={`${section.name} limits`} data-testid={`limits-${section.vendor}`} style={{ display: 'flex', alignItems: 'center', gap: compact ? COMPACT_GAP : GAP, flex: 'none' }}>
      <span style={{ ...muted, whiteSpace: 'nowrap' }} data-testid={`limits-${section.vendor}-name`}>
        {section.name}
      </span>
      {section.empty !== null ? (
        <span style={{ ...muted, whiteSpace: 'nowrap' }} data-testid={`limits-${section.vendor}-empty`}>
          {section.empty}
        </span>
      ) : (
        section.bars.map((bar) => <LimitBarView key={bar.window} bar={bar} testId={`${prefix}-${bar.window}`} compact={compact} />)
      )}
    </div>
  )
}

/** The sections of `state` at `now`, or "no data yet"; exported for tests, which pass their own state. */
export function LimitsMeterView({ state, now, timeZone }: { state: LimitsView; now: number; timeZone?: string }) {
  const sections = limitSections(state, now, timeZone === undefined ? {} : { timeZone })
  const compact = sections !== null && sections.length > 1
  return (
    <div role="group" aria-label="Limits" data-testid="limits-meter" data-compact={compact ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: compact ? COMPACT_GAP : GAP, flex: 'none' }}>
      {!compact && <span style={{ ...muted, fontWeight: 600 }}>Limits</span>}
      {sections === null ? (
        <span style={muted} data-testid="limits-empty">
          no data yet
        </span>
      ) : (
        sections.map((section, index) => <SectionView key={section.vendor} section={section} first={index === 0} compact={compact} />)
      )}
    </div>
  )
}

export default function LimitsMeter() {
  return <LimitsMeterView state={useLimits()} now={useNow()} />
}
