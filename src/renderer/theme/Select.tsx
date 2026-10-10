import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import './select.css'

/*
 * The shared Select of worfy: a styled list in place of the native select element, after the WAI-ARIA
 * "select-only combobox" pattern (choosing without typing text). The button keeps the focus the
 * whole time; the option under the keyboard cursor is named by aria-activedescendant.
 *
 * Keys. Closed: ↓, ↑, Enter, Space, Home, End and a letter open the list. Open: ↑ and ↓ move
 * without wrapping, Home and End go to the ends, Enter and Space choose and close, Tab chooses,
 * closes and lets the focus move on, typed letters go to the option that starts with them (the
 * typed text resets after 500 ms). Esc on an open list closes it without choosing and goes no
 * further: the dialog under the Select and the focus mode (which close on an Esc nobody took) do
 * not get it. Esc on a closed Select is left alone, so it still closes the dialog.
 *
 * The list is drawn into document.body with `position: fixed`, above every dialog and the focus
 * mode: a parent's overflow does not cut it. It opens under the button, or over it when there is
 * more room there. A press outside, a scroll outside, a resize and the window losing focus close it.
 */

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  /** Secondary text on the right of the option. */
  detail?: string
  disabled?: boolean
}

export interface SelectProps<V extends string = string> {
  value: V
  options: readonly SelectOption<V>[]
  /** Called when an option other than the current one is chosen, as the native change event. */
  onChange: (value: V) => void
  disabled?: boolean
  /** Set the value and the options in monospace (ids, models, profile values). */
  mono?: boolean
  /** Called on every opening, before the list shows (the composer refreshes its models here). */
  onOpen?: () => void
  /** A muted caption before the value inside the button ("Model", "Effort"). */
  prefix?: string
  /** The button's id, for a `<label htmlFor>`. */
  id?: string
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
  'data-testid'?: string
  title?: string
  className?: string
  /** Inline style of the button, for a form whose fields have their own look. */
  style?: CSSProperties
}

/** The gap between the button and the list. */
const LIST_GAP = 4
/** The list keeps this far from the window's edges. */
const WINDOW_MARGIN = 8
/** The tallest the list grows before it scrolls. */
const LIST_MAX_HEIGHT = 320
/** Typed letters are one search while they come closer than this. */
const TYPEAHEAD_RESET_MS = 500

const isPrintable = (event: KeyboardEvent): boolean => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey

/** The text of the button's `<label>`, without the button's own text when the label wraps it. */
function labelText(button: HTMLButtonElement | null): string | undefined {
  const label = button?.labels?.[0]
  if (button === null || label === undefined) return undefined
  const text = [...label.childNodes]
    .filter((node) => !node.contains(button))
    .map((node) => node.textContent ?? '')
    .join('')
    .trim()
  return text === '' ? undefined : text
}

export function Select<V extends string = string>(props: SelectProps<V>): ReactElement {
  const { value, options, onChange, disabled = false, mono = false, onOpen, prefix, title, className, style } = props
  const base = useId()
  const buttonId = props.id ?? `${base}-button`
  const listId = `${base}-list`
  const optionId = (index: number): string => `${base}-option-${index}`

  const [open, setOpen] = useState(false)
  /** The option under the keyboard cursor, by value: the options may be replaced while the list is open. */
  const [activeValue, setActiveValue] = useState<V | null>(null)
  /** The list's accessible name, read from the button's label on opening. */
  const [listName, setListName] = useState<string | undefined>(undefined)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const typed = useRef('')
  const typedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shown = open && !disabled
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const activeIndex = activeValue === null ? -1 : options.findIndex((option) => option.value === activeValue)

  const enabled = (index: number): boolean => options[index] !== undefined && options[index].disabled !== true
  const firstEnabled = (): number => options.findIndex((option) => option.disabled !== true)
  const lastEnabled = (): number => {
    for (let index = options.length - 1; index >= 0; index -= 1) if (enabled(index)) return index
    return -1
  }
  /** The next enabled option from `from` in `step` direction; `from` itself at the end of the list. */
  const step = (from: number, direction: 1 | -1): number => {
    for (let index = from + direction; index >= 0 && index < options.length; index += direction) if (enabled(index)) return index
    return from
  }

  const resetTyped = (): void => {
    typed.current = ''
    if (typedTimer.current !== null) clearTimeout(typedTimer.current)
    typedTimer.current = null
  }
  useEffect(() => resetTyped, [])

  const moveTo = (index: number): void => {
    const option = options[index]
    if (option !== undefined) setActiveValue(option.value)
  }

  const openAt = (index: number): void => {
    if (disabled) return
    setListName(props['aria-label'] ?? labelText(buttonRef.current))
    moveTo(index)
    setOpen(true)
    // Without scrolling: a scroll under an open list closes it.
    buttonRef.current?.focus({ preventScroll: true })
    onOpen?.()
  }

  const close = useCallback((): void => {
    setOpen(false)
    resetTyped()
  }, [])

  const choose = (index: number): void => {
    const option = options[index]
    if (option === undefined || option.disabled === true) return
    close()
    buttonRef.current?.focus({ preventScroll: true })
    if (option.value !== value) onChange(option.value)
  }

  /** The option the typed letters lead to, or -1. One letter searches from the option after the cursor. */
  const search = (letter: string, from: number): number => {
    typed.current += letter.toLowerCase()
    if (typedTimer.current !== null) clearTimeout(typedTimer.current)
    typedTimer.current = setTimeout(resetTyped, TYPEAHEAD_RESET_MS)
    const text = typed.current
    const start = text.length === 1 ? from + 1 : Math.max(from, 0)
    const order = options.map((_, offset) => (start + offset) % options.length)
    const starts = (index: number, prefixText: string): boolean => enabled(index) && (options[index]?.label.toLowerCase().startsWith(prefixText) ?? false)
    const match = order.find((index) => starts(index, text))
    if (match !== undefined) return match
    // The same letter pressed again goes through the options that start with it.
    const repeated = [...text].every((char) => char === text[0])
    if (repeated) {
      const next = options.map((_, offset) => (from + 1 + offset) % options.length).find((index) => starts(index, text[0] ?? ''))
      if (next !== undefined) return next
    }
    return -1
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    const typing = isPrintable(event) && (event.key !== ' ' || typed.current !== '')
    if (!shown) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled())
      } else if (event.key === 'Home') {
        event.preventDefault()
        openAt(firstEnabled())
      } else if (event.key === 'End') {
        event.preventDefault()
        openAt(lastEnabled())
      } else if (typing) {
        event.preventDefault()
        const from = selectedIndex >= 0 ? selectedIndex : -1
        const match = search(event.key, from)
        openAt(match >= 0 ? match : selectedIndex >= 0 ? selectedIndex : firstEnabled())
      }
      // Esc and everything else go on: a closed Select does not take them.
      return
    }
    switch (event.key) {
      case 'Escape':
        // The press that closes the list does nothing else.
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      case 'ArrowDown':
        event.preventDefault()
        moveTo(activeIndex < 0 ? firstEnabled() : step(activeIndex, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        if (event.altKey) {
          choose(activeIndex)
          return
        }
        moveTo(activeIndex < 0 ? firstEnabled() : step(activeIndex, -1))
        return
      case 'Home':
        event.preventDefault()
        moveTo(firstEnabled())
        return
      case 'End':
        event.preventDefault()
        moveTo(lastEnabled())
        return
      case 'Enter':
        event.preventDefault()
        if (activeIndex >= 0) choose(activeIndex)
        else close()
        return
      case 'Tab':
        // Chooses and lets the focus move on: no preventDefault.
        if (activeIndex >= 0 && enabled(activeIndex)) {
          const option = options[activeIndex]
          close()
          if (option !== undefined && option.value !== value) onChange(option.value)
        } else close()
        return
      default:
        if (event.key === ' ' && !typing) {
          event.preventDefault()
          if (activeIndex >= 0) choose(activeIndex)
          else close()
          return
        }
        if (typing) {
          event.preventDefault()
          const match = search(event.key, activeIndex)
          if (match >= 0) moveTo(match)
        }
    }
  }

  // Place the list before it paints: under the button, or over it when there is more room there.
  useLayoutEffect(() => {
    const button = buttonRef.current
    const list = listRef.current
    if (!shown || button === null || list === null) return
    const rect = button.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - LIST_GAP - WINDOW_MARGIN
    const above = rect.top - LIST_GAP - WINDOW_MARGIN
    const natural = Math.min(list.scrollHeight, LIST_MAX_HEIGHT)
    const down = natural <= below || below >= above
    const room = Math.max(0, Math.min(LIST_MAX_HEIGHT, down ? below : above))
    const height = Math.min(natural, room)
    list.style.maxHeight = `${room}px`
    list.style.minWidth = `${Math.round(rect.width)}px`
    list.style.top = `${Math.round(down ? rect.bottom + LIST_GAP : rect.top - LIST_GAP - height)}px`
    const left = Math.min(rect.left, window.innerWidth - WINDOW_MARGIN - list.offsetWidth)
    list.style.left = `${Math.round(Math.max(WINDOW_MARGIN, left))}px`
    list.dataset['placement'] = down ? 'below' : 'above'
  }, [shown])

  // The option under the cursor stays in sight in a long list.
  useEffect(() => {
    if (!shown || activeIndex < 0) return
    const element = document.getElementById(`${base}-option-${activeIndex}`)
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
  }, [shown, activeIndex, base])

  useEffect(() => {
    if (!shown) return
    const inside = (target: EventTarget | null): boolean => target instanceof Node && (listRef.current?.contains(target) === true || buttonRef.current?.contains(target) === true)
    const onPress = (event: Event) => {
      if (!inside(event.target)) close()
    }
    // A scroll of the list itself keeps it; a scroll of anything under it would leave it behind.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && listRef.current?.contains(event.target) === true)) close()
    }
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onPress, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [shown, close])

  const classes = ['w-select', mono ? 'w-select--mono' : null, className ?? null].filter((name) => name !== null).join(' ')
  const list = shown
    ? createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listName}
          className={mono ? 'w-select-list w-select-list--mono' : 'w-select-list'}
          data-testid={props['data-testid'] === undefined ? undefined : `${props['data-testid']}-list`}
          // The press inside the list keeps the focus on the button.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled === true ? true : undefined}
                data-value={option.value}
                data-active={index === activeIndex ? 'true' : undefined}
                className="w-select-option"
                onMouseMove={() => {
                  if (option.disabled !== true && index !== activeIndex) setActiveValue(option.value)
                }}
                onClick={() => choose(index)}
              >
                <span className="w-select-option__check" aria-hidden="true">
                  {isSelected ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  ) : null}
                </span>
                <span className="w-select-option__label">{option.label}</span>
                {option.detail === undefined ? null : <span className="w-select-option__detail">{option.detail}</span>}
              </div>
            )
          })}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={buttonId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={props['aria-label']}
        aria-invalid={props['aria-invalid']}
        aria-describedby={props['aria-describedby']}
        data-testid={props['data-testid']}
        data-value={value}
        disabled={disabled}
        title={title}
        className={classes}
        style={style}
        onClick={() => {
          if (shown) close()
          else openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled())
        }}
        onKeyDown={onKeyDown}
        // Space activates a button on key up; the key down already did the work.
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault()
        }}
      >
        {prefix === undefined ? null : <span className="w-select__prefix">{prefix}</span>}
        <span className="w-select__value">{selected?.label ?? value}</span>
        <svg className="w-select__chevron" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {list}
    </>
  )
}
