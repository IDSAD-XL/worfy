import type { ReactNode } from 'react'
import { Chip, type Status } from './Chip'
import './primitives.css'

/*
 * Building blocks shared by every screen of direction F (docs/design/F-SPEC.md). They take their
 * colours, sizes and radii only from the tokens in tokens.css, so both themes come for free.
 */

export type { Status } from './Chip'

export interface StatusChipProps {
  status: Status
  /** Visible text. A status colour is never shown without a label (F-SPEC). */
  label: string
}

/** The status chip: the Chip of its status (theme/Chip.tsx), with its icon and its label. */
export function StatusChip({ status, label }: StatusChipProps) {
  return <Chip variant={status} label={label} />
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

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  /** The segment cannot be pressed (it stays in the control, dimmed). */
  disabled?: boolean
  /** The tooltip, when it says more than the label (a disabled segment says why). */
  title?: string
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
          title={option.title ?? option.label}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span className="w-segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
