import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import './button.css'

/*
 * The one button of worfy (worfy-ui-kit ticket 15): a native <button type="button"> in five variants.
 * Each variant takes its height from the scale of button.css; the focus ring, the pointer and the hover
 * veil stay the shared rules of tokens.css.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link' | 'icon'

interface CommonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  ref?: Ref<HTMLButtonElement>
  /** A glyph before the label (the label alone of the icon variant). Hidden from assistive technology. */
  icon?: ReactNode
}

interface TextButtonProps extends CommonProps {
  /** primary — the one main action of a place; secondary (the default) — the others; danger — one that destroys. */
  variant?: Exclude<ButtonVariant, 'icon'>
}

interface IconButtonProps extends CommonProps {
  variant: 'icon'
  /** An icon-only button has no visible text: the label is its name. */
  'aria-label': string
}

export type ButtonProps = TextButtonProps | IconButtonProps

const isAriaDisabled = (value: ButtonHTMLAttributes<HTMLButtonElement>['aria-disabled']): boolean => value === true || value === 'true'

/**
 * `disabled` stays the native attribute. `aria-disabled="true"` is the inactive button that still says
 * why: it keeps its tooltip and the keyboard focus, and the click does nothing.
 */
export function Button({ variant = 'secondary', icon, children, className, onClick, ...rest }: ButtonProps) {
  const inactive = isAriaDisabled(rest['aria-disabled'])
  const classes = ['w-button', `w-button--${variant}`, className].filter(Boolean).join(' ')
  const click = inactive ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick
  return (
    <button {...rest} type="button" className={classes} onClick={click}>
      {icon !== undefined ? (
        <span className="w-button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  )
}
