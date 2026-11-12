/**
 * Tabs of the kit (worfy-ui-kit ticket 14, ADR-0106), on Base UI's Tabs. Base UI gives the roles
 * (`tablist`, `tab` with `aria-selected` and `aria-controls`, `tabpanel` with `aria-labelledby`) and
 * the roving focus: Tab enters the list in one step, on the selected tab, the arrows move the
 * selection with the focus (`activateOnFocus`), Home and End go to the ends. The panel of the
 * selected tab is the next Tab stop. Only the selected panel is in the DOM. The look is the caller's
 * classes; this file adds none.
 */
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode } from 'react'

export interface TabsProps<T extends string> extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'defaultValue' | 'children'> {
  value: T
  onValueChange: (value: T) => void
  /** The element of the root, when it is not a `<div>` (a `<section>`, say). */
  render?: ReactElement
  children: ReactNode
}

export function Tabs<T extends string>({ value, onValueChange, children, ...rest }: TabsProps<T>) {
  return (
    <BaseTabs.Root {...rest} value={value} onValueChange={(next: T) => onValueChange(next)}>
      {children}
    </BaseTabs.Root>
  )
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function TabList({ children, ...rest }: TabListProps) {
  return (
    <BaseTabs.List {...rest} activateOnFocus>
      {children}
    </BaseTabs.List>
  )
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'type'> {
  value: string
}

/** A tab: a native `<button type="button" role="tab">`. */
export function Tab({ value, ...rest }: TabProps) {
  return <BaseTabs.Tab {...rest} value={value} />
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  children: ReactNode
}

/** The panel of the tab with the same value, named by that tab (`aria-labelledby`). */
export function TabPanel({ value, children, ...rest }: TabPanelProps) {
  return (
    <BaseTabs.Panel {...rest} value={value}>
      {children}
    </BaseTabs.Panel>
  )
}
