import NumberFlow, { useIsSupported, type Format } from '@number-flow/react'
import { useState, useSyncExternalStore, type CSSProperties } from 'react'

/*
 * A number whose digits roll to a new value (worfy-ui-kit ticket 17): the one wrapper over NumberFlow
 * (`@number-flow/react`, ADR-0106). It shows the shares of the Limits, the fill of the context meter
 * and the cost.
 *
 * - The first show draws the value at once; only a change of the value rolls the digits.
 * - Under Reduce motion (`prefers-reduced-motion: reduce`) a new value replaces the old one at once.
 * - The text of the number is the final value, in the light DOM, for a screen reader and for
 *   `textContent`: NumberFlow draws its digits in a shadow root as columns of every digit, which is
 *   hidden from assistive technology here. A test reads the value from the text, never from the
 *   digits (test/e2e/helpers.ts, `animatedText`).
 *
 * The digits inherit the font of the place, so a place in monospace or tabular digits keeps them.
 */

const REDUCE = '(prefers-reduced-motion: reduce)'

/** Whether the system asks for less motion; false where there is no matchMedia. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCE).matches === true
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  const query = matchMedia(REDUCE)
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}

/** Seen by a screen reader, not on screen. */
const visuallyHidden: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }

/** The digits as the app writes them: English, no grouping (`1234.50`, as `toFixed` does). */
const LOCALE = 'en-US'

export interface AnimatedNumberProps {
  value: number
  /** How the digits are written; grouping is off unless asked for. */
  format?: Format
  /** Text before the digits (`$`). */
  prefix?: string
  /** Text after the digits (`%`). */
  suffix?: string
}

/**
 * NumberFlow draws its digits with padding above and below, the room of its fade mask
 * (`--number-flow-mask-height`, 0.25em by default, half of it on each side, rounded to a pixel). This
 * margin takes that room back, so a line with rolling digits is as tall as one with text: a Limits line
 * stays 12 px when `99%` turns into `limit reached`. The mask still fades the rolling digits.
 */
const maskRoomBack: CSSProperties = { marginBlock: 'calc(-1 * round(nearest, calc(var(--number-flow-mask-height, 0.25em) / 2), 1px))' }

/** One formatter per format, as Intl advises: the text is formatted on every render. */
const formatters = new Map<string, Intl.NumberFormat>()

function formatterOf(format: Format | undefined): Intl.NumberFormat {
  const key = JSON.stringify(format ?? {})
  let formatter = formatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(LOCALE, { useGrouping: false, ...format })
    formatters.set(key, formatter)
  }
  return formatter
}

/** The final text of the number, as the screen reader and `textContent` get it: `62%`, `$0.0125`. */
function animatedNumberText({ value, format, prefix = '', suffix = '' }: AnimatedNumberProps): string {
  return `${prefix}${formatterOf(format).format(value)}${suffix}`
}

export function AnimatedNumber({ value, format, prefix, suffix }: AnimatedNumberProps) {
  // NumberFlow needs `linear()` easing and CSS `mod()` (Chromium has both). Where they are missing —
  // jsdom in the unit tests, where NumberFlow would also write its server markup into the light DOM —
  // the text alone is shown.
  const supported = useIsSupported()
  const reduced = useSyncExternalStore(subscribeReducedMotion, reducedMotion, () => false)
  // Rolls only after the value has changed once since the first show, and from then on always, a
  // return to the first value too.
  const [firstValue] = useState(value)
  const [changed, setChanged] = useState(false)
  if (!changed && value !== firstValue) setChanged(true)
  const text = animatedNumberText({ value, format, prefix, suffix })
  if (!supported) {
    return (
      <span className="w-animated-number">
        <span className="w-animated-number__text">{text}</span>
      </span>
    )
  }
  return (
    <span className="w-animated-number">
      <span className="w-animated-number__text" style={visuallyHidden}>
        {text}
      </span>
      <NumberFlow value={value} locales={LOCALE} format={{ useGrouping: false, ...format }} prefix={prefix} suffix={suffix} animated={changed && !reduced} aria-hidden="true" style={maskRoomBack} />
    </span>
  )
}
