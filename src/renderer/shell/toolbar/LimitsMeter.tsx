import { Fragment } from 'react'
import { limitSections, type LimitBar, type LimitSection, type LimitsView } from '../../../shared/agent/limits'
import { LimitBarView } from '../../limits/LimitBar'
import { useLimits, useNow } from '../../limits/useLimits'
import { VendorBadge } from '../../session/VendorBadge'

// The Limits in the toolbar: a section per Vendor with its windows' bars — Claude's 5-hour and 7-day,
// then each other Vendor signed in to (Codex) with the windows its plan reports, shortest first, or
// "No limits reported" (worfy-multi-vendor ticket 26). A Vendor signed out has no section. Main keeps the
// Limits (src/main/agent/limits.ts); the bars are drawn with src/renderer/limits/LimitBar.tsx and the
// Limits read through src/renderer/limits/useLimits.ts. This is the only place worfy shows the Limits;
// the Session view's rail does not repeat them.
//
// Every section, Claude's too, starts with its Vendor's logo and no visible name (owner, 2026-11-03), so
// it is seen which bars are whose without spending the toolbar's width on words: visible names left the
// Project title of a 1280 px window its first letter or none (worfy-multi-vendor tickets 26 and 24,
// test/e2e/limits-vendors.spec.ts). The Vendor's whole name is the section's tooltip, and its accessible
// name is `<Vendor> limits`. A section without bars shows its logo beside its line (`no data yet`,
// `No limits reported`).
//
// With more than one section the panel is compact, so that it, the Project title with its branch line,
// the Harness column and the search field stay whole in a 1280 px window (test/e2e/limits-vendors.spec.ts):
// no "Limits" heading (the group keeps it as its name), a thin line between the sections and smaller gaps.
// With Claude's section alone the heading stays.
//
// A Vendor's windows stand one above the other, one line each (worfy-polish ticket 93): its label, share
// and reset time over a thin bar, in a grid whose columns line them up (`w-limits-stack`,
// src/renderer/shell/shell.css). So a section is as wide as its widest line, not as two bars side by
// side. Two lines fill the toolbar's height: a Vendor with more windows gets a stack of two per column.
//
// In a narrow window (worfy-polish ticket 48) the toolbar hides the heading, the bars' labels and their
// reset times (src/renderer/shell/shell.css): each bar shows its value, whose tooltip names the rest
// (src/renderer/limits/LimitBar.tsx).

// Before the Harness item (500), which carries the app version.
export const order = 100

const GAP = 12
const COMPACT_GAP = 8
/** Between a section's logo and its windows, and between its stacks. */
const SECTION_GAP = 6
/** How many windows stand one above the other. */
const STACK = 2

const muted = { fontSize: 'var(--text-11)', color: 'var(--text-muted)' } as const

/**
 * One Vendor's section. Claude's bars keep their test ids (`limit-five_hour`); another Vendor's carry
 * its id (`limit-codex-primary`), since its window ids are its own. It starts with its Vendor's logo; the
 * Vendor's name is its tooltip.
 */
function SectionView({ section, first }: { section: LimitSection; first: boolean }) {
  const prefix = first ? 'limit' : `limit-${section.vendor}`
  return (
    <div
      role="group"
      aria-label={`${section.name} limits`}
      title={section.name}
      data-testid={`limits-${section.vendor}`}
      style={{ display: 'flex', alignItems: 'center', gap: SECTION_GAP, flex: 'none' }}
    >
      <VendorBadge vendor={section.vendor} form="icon" muted testId={`limits-${section.vendor}-logo`} />
      {section.empty !== null ? (
        <span style={{ ...muted, whiteSpace: 'nowrap' }} data-testid={`limits-${section.vendor}-empty`}>
          {section.empty}
        </span>
      ) : (
        stacks(section.bars).map((stack) => (
          <div key={stack[0]?.window} className="w-limits-stack" data-testid={`limits-${section.vendor}-stack`}>
            {stack.map((bar) => (
              <LimitBarView key={bar.window} bar={bar} testId={`${prefix}-${bar.window}`} />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

/** The windows of a section two by two, one stack per column; the toolbar has room for two lines. */
function stacks(bars: readonly LimitBar[]): LimitBar[][] {
  const result: LimitBar[][] = []
  for (let index = 0; index < bars.length; index += STACK) result.push(bars.slice(index, index + STACK))
  return result
}

/** The thin line between two sections of a compact panel. */
function Divider() {
  return <span aria-hidden="true" data-testid="limits-divider" style={{ width: 1, height: 24, flex: 'none', background: 'var(--border)' }} />
}

/** The sections of `state` at `now`, or "no data yet"; exported for tests, which pass their own state. */
export function LimitsMeterView({ state, now, timeZone }: { state: LimitsView; now: number; timeZone?: string }) {
  const sections = limitSections(state, now, timeZone === undefined ? {} : { timeZone })
  const compact = sections !== null && sections.length > 1
  return (
    <div role="group" aria-label="Limits" data-testid="limits-meter" data-compact={compact ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: compact ? COMPACT_GAP : GAP, flex: 'none' }}>
      {!compact && (
        <span className="w-limits__heading" style={{ ...muted, fontWeight: 600 }}>
          Limits
        </span>
      )}
      {sections === null ? (
        <span style={muted} data-testid="limits-empty">
          no data yet
        </span>
      ) : (
        sections.map((section, index) => (
          <Fragment key={section.vendor}>
            {index > 0 && <Divider />}
            <SectionView section={section} first={index === 0} />
          </Fragment>
        ))
      )}
    </div>
  )
}

export default function LimitsMeter() {
  return <LimitsMeterView state={useLimits()} now={useNow()} />
}
