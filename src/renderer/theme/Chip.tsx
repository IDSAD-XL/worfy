import type { HTMLAttributes, ReactNode } from 'react'
import './chip.css'

/*
 * The one chip of worfy (worfy-ui-kit ticket 16): a compact rectangle — 18 px, radius 4 px, 12 px text
 * (docs/design/F-SPEC.md) — in the variants of the status roles and a neutral one. A status colour is
 * never shown alone: every status variant has its label (an empty one falls back to the variant's word)
 * and draws its icon unless a place F-SPEC describes as label-only turns it off.
 */

/** `stopped`: ended from outside, not by a failure — neutral grey, as `done`, with a pause mark (a Subagent `interrupted`, ADR-0085). */
export type Status = 'ready' | 'working' | 'blocked' | 'done' | 'stopped'

/** The status variants, and `neutral`: no status colour (an open Ticket, "gate: no data", a name). */
export type ChipVariant = Status | 'neutral'

/** What a status chip says when its caller gave it no label. */
const WORD: Record<Status, string> = { ready: 'ready', working: 'working', blocked: 'blocked', done: 'done', stopped: 'stopped' }

/** The class of each variant; the neutral one keeps `w-chip--open`, the class its bare markup already writes. */
const VARIANT_CLASS: Record<ChipVariant, string> = {
  ready: 'w-chip--ready',
  working: 'w-chip--working',
  blocked: 'w-chip--blocked',
  done: 'w-chip--done',
  stopped: 'w-chip--stopped',
  neutral: 'w-chip--open',
}

/** The icon of each variant, in the text colour of the chip; hidden from assistive technology, the label says it. */
export function ChipIcon({ variant }: { variant: ChipVariant }) {
  switch (variant) {
    case 'ready':
      return <span className="w-chip__dot" aria-hidden="true" />
    case 'working':
      return (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" strokeOpacity="0.3" />
          <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" />
        </svg>
      )
    case 'blocked':
      return (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2.2l6 10.6H2z" />
          <path d="M8 6.5v3M8 11.2v.1" />
        </svg>
      )
    case 'stopped':
      return (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5.5 3.5v9M10.5 3.5v9" />
        </svg>
      )
    case 'done':
      return (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )
    case 'neutral':
      return (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="8" cy="8" r="5" />
        </svg>
      )
  }
}

interface CommonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /**
   * The glyph before the label; the variant's own icon when left out. `null`: no icon — only where F-SPEC
   * describes the chip as a word alone (the First run status chips) or the chip names a thing, not a state.
   */
  icon?: ReactNode
  /** A 1 px border: the variant's ring for `blocked`, the hairline otherwise (F-SPEC "Failed"). */
  bordered?: boolean
  /** The status text on surface raised with a 1 px border, not on the status ground (F-SPEC First run "Warning"). */
  quiet?: boolean
  /** Status text: the icon and the label in the variant's colour, no box (a Vendor's name, "Claude is driving"). */
  plain?: boolean
}

interface StatusChipProps extends CommonProps {
  variant: Status
  /** Visible text. A status colour is never shown without one: an empty label shows the variant's word. */
  label: ReactNode
}

interface NeutralChipProps extends CommonProps {
  variant: 'neutral'
  /** Visible text; a neutral chip without one is its icon alone, named by its `aria-label`. */
  label?: ReactNode
}

export type ChipProps = StatusChipProps | NeutralChipProps

const empty = (label: ReactNode): boolean => label === undefined || label === null || label === false || (typeof label === 'string' && label.trim() === '')

/** A status chip says its status in `data-status`; a neutral one only when its caller names a state (`data-status="open"`). */
export function Chip({ variant, label, icon, bordered = false, quiet = false, plain = false, className, ...rest }: ChipProps) {
  const text = variant !== 'neutral' && empty(label) ? WORD[variant] : label
  const classes = ['w-chip', VARIANT_CLASS[variant], bordered ? 'w-chip--bordered' : null, quiet ? 'w-chip--quiet' : null, plain ? 'w-chip--plain' : null, className]
    .filter(Boolean)
    .join(' ')
  return (
    <span data-status={variant === 'neutral' ? undefined : variant} {...rest} className={classes}>
      {icon === undefined ? <ChipIcon variant={variant} /> : icon}
      {text}
    </span>
  )
}
