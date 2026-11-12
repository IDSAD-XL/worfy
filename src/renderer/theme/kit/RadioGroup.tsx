/**
 * RadioGroup of the kit (worfy-ui-kit ticket 14, ADR-0106): one choice out of a few, on Base UI's
 * RadioGroup. Base UI gives the roles (`radiogroup`, `radio` with `aria-checked`) and the roving focus:
 * Tab enters the group in one step, on the checked radio (the first one while none is checked), and
 * the arrows move the choice with the focus. Base UI 1.9.0 leaves Home and End out of a radio group;
 * the kit adds them: Home chooses the first radio that can be chosen, End the last. Each radio is a
 * native `<button type="button">`, so the control rules of tokens.css and the callers' `button`
 * styles keep applying. Base UI draws a hidden `<input type="radio">` (`aria-hidden`, `tabindex=-1`)
 * next to each radio; a focus trap that lists focusable elements skips elements with `tabindex=-1`.
 * The look is the caller's classes; this file adds none.
 */
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { useCallback, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ComponentPropsWithRef, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react'

/** A radio that Home or End may choose: neither disabled nor marked inactive. */
const CHOOSABLE = '[role="radio"]:not(:disabled, [aria-disabled="true"])'

export interface RadioGroupProps<T extends string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue' | 'children'> {
  /** The checked radio's value; null while none is checked. */
  value: T | null
  onValueChange: (value: T) => void
  /** Nothing in the group can be chosen; the radios still take the focus. */
  readOnly?: boolean
  children: ReactNode
}

export function RadioGroup<T extends string>({ value, onValueChange, onKeyDown, children, ...rest }: RadioGroupProps<T>) {
  const homeAndEnd = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented || (event.key !== 'Home' && event.key !== 'End')) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'radio') return
    const radios = [...event.currentTarget.querySelectorAll<HTMLElement>(CHOOSABLE)]
    const to = event.key === 'Home' ? radios[0] : radios.at(-1)
    if (to === undefined) return
    event.preventDefault()
    to.focus()
    // The press goes through Base UI's own path, as a click: a read-only group keeps its choice.
    to.click()
  }
  return (
    <BaseRadioGroup {...rest} value={value} onValueChange={(next) => onValueChange(next as T)} onKeyDown={homeAndEnd}>
      {children}
    </BaseRadioGroup>
  )
}

export interface RadioProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'type'> {
  value: string
  ref?: Ref<HTMLButtonElement>
}

/** A radio of a RadioGroup: a native `<button type="button" role="radio">`. */
export function Radio({ value, ...rest }: RadioProps) {
  // Base UI types the props for its default `<span>`; with `nativeButton` they land on the button.
  const props = rest as Omit<BaseRadio.Root.Props, 'value'>
  return <BaseRadio.Root {...props} value={value} nativeButton render={(own) => <RadioButton {...own} />} />
}

/**
 * The button of a radio. Base UI 1.9.0 learns a radio's place in the group in the render after the
 * radio's first one; a radio focused before that (a caller that focuses it as soon as it appears,
 * session/QuestionCard.tsx) makes the unknown place the group's Tab stop, and no radio is a Tab stop
 * then. Once the place is known, the focused radio tells the group again that it has the focus.
 */
function RadioButton({ ref, ...props }: ComponentPropsWithRef<'button'>) {
  const own = useRef<HTMLButtonElement | null>(null)
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      own.current = node
      if (typeof ref === 'function') return ref(node)
      if (ref) ref.current = node
      return undefined
    },
    [ref],
  )
  useLayoutEffect(() => {
    const radio = own.current
    if (radio === null || document.activeElement !== radio || radio.tabIndex >= 0) return
    if (radio.closest('[role="radiogroup"]')?.querySelector('[role="radio"]:not([tabindex="-1"])') != null) return
    radio.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
  return <button {...props} type="button" ref={setRef} />
}
