// Tab as a browser does it, for jsdom (worfy-ui-kit ticket 04). jsdom dispatches a key but never moves
// the focus on Tab; a browser moves it to the next tabbable element of the page, unless a handler
// prevented the key. The focus trap of a kit window (theme/kit/Dialog.tsx, Base UI) works that way:
// its focus guards — tabbable spans around the window — take the focus Tab moves to them and send it
// to the other end of the window a frame later.
import { act } from '@testing-library/react'

/** Whether `element` is a stop of Tab: tabbable, enabled, not hidden, not inert. */
function tabbable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.tabIndex < 0) return false
  if ('disabled' in element && element.disabled === true) return false
  return element.closest('[hidden], [inert]') === null
}

/** Presses Tab (Shift+Tab with `shift`) where the focus is, then lets the focus trap act. */
export async function pressTab(shift = false): Promise<KeyboardEvent> {
  const from = document.activeElement ?? document.body
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
  await act(async () => {
    from.dispatchEvent(event)
    if (!event.defaultPrevented) {
      const stops = [...document.querySelectorAll('*')].filter(tabbable)
      const at = stops.indexOf(from as HTMLElement)
      const next = shift ? (at === -1 ? stops.at(-1) : stops[at - 1]) : stops[at + 1]
      ;(next ?? (shift ? stops.at(-1) : stops[0]))?.focus()
    }
    // Base UI moves the focus from a guard in the next frame.
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  })
  return event
}
