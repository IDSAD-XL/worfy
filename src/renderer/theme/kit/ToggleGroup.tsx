/**
 * ToggleGroup of the kit (worfy-ui-kit ticket 14, ADR-0106): a row of toggle buttons with at most one
 * pressed, on Base UI's ToggleGroup. Base UI gives the roles (`group`, buttons with `aria-pressed`) and
 * the roving focus: Tab enters the group in one step (Base UI 1.9.0 starts it on the first button that
 * can take the focus, then on the last one focused, not on the pressed one), the arrows move the
 * focus along it, round its ends, Home and End go to its ends, and Space or Enter presses the focused
 * button. The arrows move the focus, not the press: a switch such as the View of the toolbar
 * changes the screen only when the user presses a button, as with the mouse. The look is the caller's
 * classes; this file adds none.
 */
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react'

export interface ToggleGroupProps<T extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue' | 'children'> {
  /** The pressed button's value; null when none is pressed. */
  value: T | null
  /**
   * A press: the value of the button pressed, or null when the pressed button was pressed again.
   * The caller decides what that second press means (keep it pressed, or press none).
   */
  onValueChange: (value: T | null) => void
  children: ReactNode
}

export function ToggleGroup<T extends string>({ value, onValueChange, children, ...rest }: ToggleGroupProps<T>) {
  return (
    <BaseToggleGroup {...rest} value={value === null ? [] : [value]} onValueChange={(next) => onValueChange((next[0] as T | undefined) ?? null)}>
      {children}
    </BaseToggleGroup>
  )
}

export interface ToggleGroupItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'type'> {
  value: string
  ref?: Ref<HTMLButtonElement>
}

/** A button of a ToggleGroup: a native `<button type="button">` with `aria-pressed`. */
export function ToggleGroupItem({ value, ...rest }: ToggleGroupItemProps) {
  return <Toggle {...rest} value={value} />
}
