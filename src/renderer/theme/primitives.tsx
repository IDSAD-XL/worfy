import type { ReactNode } from 'react'
import { Chip, type Status } from './Chip'
import { ToggleGroup, ToggleGroupItem } from './kit/ToggleGroup'
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

/**
 * macOS-style segmented control: one pressed segment out of a few, on the ToggleGroup of the kit
 * (theme/kit/ToggleGroup.tsx, worfy-ui-kit ticket 14): Tab enters it in one step, the arrows move the
 * focus along it, Home and End go to its ends, Space or Enter presses. A press on the pressed segment
 * calls `onChange` with its value, as a press on any other does.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup aria-label={label} className="w-segmented" value={value} onValueChange={(next: T | null) => onChange(next ?? value)}>
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="w-segmented__item"
          // The name stays the label when a narrow place shows the icon alone (shell.css, the View switch).
          aria-label={option.label}
          title={option.title ?? option.label}
          disabled={option.disabled}
        >
          {option.icon}
          <span className="w-segmented__label">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
