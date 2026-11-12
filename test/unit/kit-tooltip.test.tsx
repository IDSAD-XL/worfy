// Tooltip kit (theme/kit/Tooltip.tsx, worfy-ui-kit ticket 13, ADR-0106): the tooltip shows when the
// pointer rests on its element and when the keyboard focuses it, a screen reader hears it as the
// description, and it is drawn on the top layer. Esc hides it: with the focus on the element the press
// stops there (an ancestor's own Esc waits for the next one); with the focus elsewhere it goes on,
// unmarked, so focus mode or the chat field still act on that same press.
// Two ways in: <Tooltip> around an element a place draws (the icon buttons), and the hint attributes
// that writeAction spreads (projects/read-only.ts), shown by HintTooltips mounted once for the window.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { KeyboardEvent, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeAction } from '../../src/renderer/projects/read-only'
import { HINT_ATTRIBUTE } from '../../src/renderer/theme/kit/hint'
import { HintTooltips, Tooltip, TOOLTIP_DELAY_MS } from '../../src/renderer/theme/kit/Tooltip'
import { KIT_POPUP_ATTRIBUTE, escapeBelongsToPopup } from '../../src/renderer/theme/open-layers'
import { LAYERS } from '../../src/renderer/theme/layers'

const HINT = 'Mini gives this Machine read-only access'

/** Lets Base UI's effects and timers run. */
const flush = (ms = 20) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

/** The keyboard moves the focus onto `element`: a Tab press, then the focus. */
async function tabTo(element: HTMLElement): Promise<void> {
  fireEvent.keyDown(document.body, { key: 'Tab' })
  act(() => element.focus())
  await flush()
}

/** The pointer comes onto `element` and rests there past the delay. */
async function hover(element: HTMLElement): Promise<void> {
  fireEvent.pointerEnter(element, { pointerType: 'mouse' })
  fireEvent.mouseEnter(element)
  fireEvent.mouseOver(element)
  fireEvent.pointerMove(element, { pointerType: 'mouse' })
  fireEvent.mouseMove(element)
  await flush(TOOLTIP_DELAY_MS + 100)
}

const tooltip = (): HTMLElement | null => screen.queryByRole('tooltip')

/** Esc pressed in `element`; whether the press reached the window and whether anybody marked it handled. */
function escapeIn(element: HTMLElement): { reachedWindow: boolean; defaultPrevented: boolean } {
  let reachedWindow = false
  const onWindow = () => {
    reachedWindow = true
  }
  window.addEventListener('keydown', onWindow)
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    element.dispatchEvent(event)
  })
  window.removeEventListener('keydown', onWindow)
  return { reachedWindow, defaultPrevented: event.defaultPrevented }
}

/** An ancestor with an Esc of its own, as the rail panel of session/ProductSessionPanel.tsx. */
function Panel({ onEscape, children }: { onEscape: () => void; children: ReactNode }) {
  return (
    <div
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape') onEscape()
      }}
    >
      {children}
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe('<Tooltip> around an icon button', () => {
  const button = () => screen.getByRole('button', { name: 'Hide sidebar' })

  it('shows on the keyboard focus, and Esc hides it without reaching the ancestor; the button keeps its own keys', async () => {
    const onEscape = vi.fn()
    const ownKeys: string[] = []
    render(
      <Panel onEscape={onEscape}>
        <Tooltip label="Hide sidebar (⌘B)">
          <button type="button" aria-label="Hide sidebar" onKeyDown={(event) => ownKeys.push(event.key)} />
        </Tooltip>
      </Panel>,
    )
    expect(tooltip()).toBeNull()
    await tabTo(button())
    expect(tooltip()?.textContent).toBe('Hide sidebar (⌘B)')
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    expect(ownKeys).toEqual(['ArrowDown'])
    fireEvent.keyDown(button(), { key: 'Escape' })
    await flush()
    expect(tooltip()).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
    // With the tooltip hidden, Esc on the button is the ancestor's again.
    fireEvent.keyDown(button(), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('shows when the pointer rests on the button, and hides when it leaves', async () => {
    render(
      <Tooltip label="Hide sidebar (⌘B)">
        <button type="button" aria-label="Hide sidebar" />
      </Tooltip>,
    )
    await hover(button())
    expect(tooltip()?.textContent).toBe('Hide sidebar (⌘B)')
    fireEvent.pointerLeave(button(), { pointerType: 'mouse' })
    fireEvent.mouseLeave(button())
    await flush()
    expect(tooltip()).toBeNull()
  })

  it('Esc with the focus elsewhere hides it, and the press goes on unmarked to the window', async () => {
    render(
      <>
        <Tooltip label="Hide sidebar (⌘B)">
          <button type="button" aria-label="Hide sidebar" />
        </Tooltip>
        <input aria-label="Message" />
      </>,
    )
    await hover(button())
    expect(tooltip()).not.toBeNull()
    const field = screen.getByRole('textbox', { name: 'Message' })
    // The chat field would not hold its Esc back for a tooltip (theme/open-layers.ts).
    expect(escapeBelongsToPopup(field)).toBe(false)
    expect(escapeIn(field)).toEqual({ reachedWindow: true, defaultPrevented: false })
    await flush()
    expect(tooltip()).toBeNull()
  })

  it('the button keeps its name and no title; the label is its description unless it only repeats the name', () => {
    render(
      <>
        <Tooltip label="Hide sidebar (⌘B)">
          <button type="button" aria-label="Hide sidebar" />
        </Tooltip>
        <Tooltip label="Retry">
          <button type="button" aria-label="Retry" />
        </Tooltip>
        <Tooltip label="Runs — 2 new">
          <button type="button" aria-label="Runs" aria-description="2 new" />
        </Tooltip>
      </>,
    )
    expect(button().hasAttribute('title')).toBe(false)
    expect(button().getAttribute('aria-description')).toBe('Hide sidebar (⌘B)')
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('aria-description')).toBe(false)
    expect(screen.getByRole('button', { name: 'Runs' }).getAttribute('aria-description')).toBe('2 new')
  })

  it('is drawn on the top layer, with neither the kit popup mark nor the toast keep-out mark', async () => {
    render(
      <Tooltip label="Hide sidebar (⌘B)">
        <button type="button" aria-label="Hide sidebar" />
      </Tooltip>,
    )
    await tabTo(button())
    const popup = tooltip()
    expect(popup).not.toBeNull()
    expect(popup?.hasAttribute(KIT_POPUP_ATTRIBUTE)).toBe(false)
    expect(popup?.hasAttribute('data-toast-keep-out')).toBe(false)
    expect(popup?.classList.contains('w-tooltip')).toBe(true)
    const portal = popup?.closest<HTMLElement>('[style*="z-index"]')
    expect(portal?.style.zIndex).toBe(String(LAYERS.top))
    expect(portal?.style.position).toBe('relative')
  })

  it('a blur of the window hides it', async () => {
    render(
      <Tooltip label="Hide sidebar (⌘B)">
        <button type="button" aria-label="Hide sidebar" />
      </Tooltip>,
    )
    await tabTo(button())
    expect(tooltip()).not.toBeNull()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(tooltip()).toBeNull()
  })
})

describe('the hint of an aria-disabled write action (writeAction, HintTooltips)', () => {
  function Probe({ onClick = () => undefined, onEscape = () => undefined }: { onClick?: () => void; onEscape?: () => void }) {
    return (
      <>
        <HintTooltips />
        <Panel onEscape={onEscape}>
          <button type="button" {...writeAction(HINT, onClick, 'Start a Session')}>
            New session
          </button>
          <input aria-label="Message" />
        </Panel>
      </>
    )
  }
  const action = () => screen.getByRole('button', { name: 'New session' })

  it('the inactive action carries the hint for the kit and as its description, and no native title', () => {
    render(<Probe />)
    expect(action().getAttribute('aria-disabled')).toBe('true')
    expect(action().getAttribute(HINT_ATTRIBUTE)).toBe(HINT)
    expect(action().getAttribute('aria-description')).toBe(HINT)
    expect(action().hasAttribute('title')).toBe(false)
  })

  it('an active action keeps its title and gets no hint', () => {
    render(
      <button type="button" {...writeAction(null, () => undefined, 'Start a Session')}>
        New session
      </button>,
    )
    expect(action().getAttribute('title')).toBe('Start a Session')
    expect(action().hasAttribute(HINT_ATTRIBUTE)).toBe(false)
    expect(action().hasAttribute('aria-description')).toBe(false)
  })

  it('shows on the keyboard focus; Esc hides it and does not reach the ancestor', async () => {
    const onEscape = vi.fn()
    render(<Probe onEscape={onEscape} />)
    await tabTo(action())
    expect(tooltip()?.textContent).toBe(HINT)
    fireEvent.keyDown(action(), { key: 'Escape' })
    await flush()
    expect(tooltip()).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
    fireEvent.keyDown(action(), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('hides when the focus leaves the action', async () => {
    render(<Probe />)
    await tabTo(action())
    expect(tooltip()).not.toBeNull()
    await tabTo(screen.getByRole('textbox', { name: 'Message' }))
    expect(tooltip()).toBeNull()
  })

  it('shows when the pointer rests on the action past the delay, not before; a press hides it and does nothing', async () => {
    const onClick = vi.fn()
    render(<Probe onClick={onClick} />)
    fireEvent.mouseOver(action())
    await flush(TOOLTIP_DELAY_MS / 2)
    expect(tooltip()).toBeNull()
    await flush(TOOLTIP_DELAY_MS)
    expect(tooltip()?.textContent).toBe(HINT)
    fireEvent.pointerDown(action())
    fireEvent.mouseDown(action())
    fireEvent.click(action())
    await flush()
    expect(tooltip()).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('hides when the pointer moves onto an element without a hint', async () => {
    render(<Probe />)
    fireEvent.mouseOver(action())
    await flush(TOOLTIP_DELAY_MS + 100)
    expect(tooltip()).not.toBeNull()
    fireEvent.mouseOver(screen.getByRole('textbox', { name: 'Message' }))
    await flush()
    expect(tooltip()).toBeNull()
  })

  it('a focus that a press gave shows nothing', async () => {
    render(<Probe />)
    fireEvent.pointerDown(action())
    act(() => action().focus())
    await flush()
    expect(tooltip()).toBeNull()
  })

  it('Esc with the focus elsewhere hides a tooltip the pointer showed, and the press goes on unmarked', async () => {
    const onEscape = vi.fn()
    render(<Probe onEscape={onEscape} />)
    fireEvent.mouseOver(action())
    await flush(TOOLTIP_DELAY_MS + 100)
    expect(tooltip()).not.toBeNull()
    const field = screen.getByRole('textbox', { name: 'Message' })
    expect(escapeBelongsToPopup(field)).toBe(false)
    expect(escapeIn(field)).toEqual({ reachedWindow: true, defaultPrevented: false })
    expect(onEscape).toHaveBeenCalledTimes(1)
    await flush()
    expect(tooltip()).toBeNull()
  })

  it('is drawn on the top layer, as the tooltip around an element', async () => {
    render(<Probe />)
    await tabTo(action())
    const portal = tooltip()?.closest<HTMLElement>('[style*="z-index"]')
    expect(portal?.style.zIndex).toBe(String(LAYERS.top))
  })
})
