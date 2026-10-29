import type { ReactNode } from 'react'
import './primitives.css'

/*
 * Building blocks shared by every screen of direction F (docs/design/F-SPEC.md). They take their
 * colours, sizes and radii only from the tokens in tokens.css, so both themes come for free.
 */

/** `stopped`: ended from outside, not by a failure — neutral grey, as `done`, with a pause mark (a Subagent `interrupted`, ADR-0085). */
export type Status = 'ready' | 'working' | 'blocked' | 'done' | 'stopped'

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
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
  }
}

export interface StatusChipProps {
  status: Status
  /** Visible text. A status colour is never shown without a label (F-SPEC). */
  label: string
}

/** Compact rectangular status chip: radius 4 px, colour always paired with an icon and a label. */
export function StatusChip({ status, label }: StatusChipProps) {
  return (
    <span className={`w-chip w-chip--${status}`} data-status={status}>
      <StatusIcon status={status} />
      {label}
    </span>
  )
}

export interface ListRowProps {
  label: ReactNode
  icon?: ReactNode
  /** Right-aligned meta: a count, a branch, a chip. */
  trailing?: ReactNode
  selected?: boolean
  onSelect?: () => void
  /** Set the label in monospace (ids, paths, branches). */
  mono?: boolean
}

/** A 28 px row of a list or the sidebar. */
export function ListRow({ label, icon, trailing, selected = false, onSelect, mono = false }: ListRowProps) {
  return (
    <button type="button" className="w-row" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      {icon ? (
        <span className="w-row__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={mono ? 'w-row__label w-mono' : 'w-row__label'}>{label}</span>
      {trailing ? <span className="w-row__trailing">{trailing}</span> : null}
    </button>
  )
}

export interface PrimaryButtonProps {
  children: ReactNode
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
}

/** The one main action of a place (Run wave, Ship ticket, Allow). */
export function PrimaryButton({ children, icon, onClick, disabled = false }: PrimaryButtonProps) {
  return (
    <button type="button" className="w-primary" onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group, e.g. "View". */
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** macOS-style segmented control: one pressed segment out of a few. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="w-segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="w-segmented__item"
          aria-pressed={option.value === value}
          // The name stays the label when a narrow place shows the icon alone (shell.css, the View switch).
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span className="w-segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
