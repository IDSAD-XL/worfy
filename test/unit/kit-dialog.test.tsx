// The modal window of the kit (theme/kit/Dialog.tsx, worfy-ui-kit ticket 04, ADR-0106), from the
// outside: its role and name, where the focus is, which keys do what, what closes it and what does
// not. The windows of the app on it (Settings, Keyboard shortcuts, the Guide) have their own tests;
// here a probe window with a field, a Select and a button.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../src/renderer/theme/kit/Dialog'
import { KIT_POPUP_ATTRIBUTE } from '../../src/renderer/theme/open-layers'
import { Select } from '../../src/renderer/theme/Select'
import { ToastRegion } from '../../src/renderer/toast/ToastRegion'
import { resetToasts, showToast } from '../../src/renderer/toast/toasts'
import { pressTab } from './tab-key'

/** A pointer press as a browser sends it: pointerdown, mousedown, pointerup, mouseup, click. */
function pressPointer(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseDown(element, { button: 0 })
  fireEvent.pointerUp(element, { button: 0, pointerType: 'mouse' })
  fireEvent.mouseUp(element, { button: 0 })
  fireEvent.click(element, { button: 0 })
}

/** A key pressed on `target` as the browser sends it. */
function pressKey(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/** Lets Base UI's effects and frames run. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
] as const

/** A page with an opener and a probe window: a title, a field, a Select and Close. */
function Page({ closeOnBackdrop }: { closeOnBackdrop?: boolean }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<(typeof OPTIONS)[number]['value']>('alpha')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="probe-title"
        className="probe"
        backdropTestId="probe-backdrop"
        closeOnBackdrop={closeOnBackdrop}
        initialFocus={(window) => window.querySelector<HTMLElement>('input')}
        data-testid="probe"
      >
        <h2 id="probe-title">Probe window</h2>
        <input aria-label="Field" />
        <label>
          Choice <Select value={value} options={OPTIONS} onChange={setValue} />
        </label>
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </Dialog>
    </>
  )
}

const probe = () => screen.queryByRole('dialog', { name: 'Probe window' })

/** Renders the page, gives the opener the focus and opens the window from it. */
async function openFromOpener(props: { closeOnBackdrop?: boolean } = {}): Promise<{ opener: HTMLElement; window: HTMLElement }> {
  render(<Page {...props} />)
  const opener = screen.getByRole('button', { name: 'opener' })
  opener.focus()
  fireEvent.click(opener)
  await flush()
  return { opener, window: probe()! }
}

/** Whether the element or one of its ancestors is hidden from assistive tech. */
function hiddenFromScreenReader(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('inert')) return true
  }
  return false
}

beforeEach(() => resetToasts())

afterEach(async () => {
  cleanup()
  act(() => resetToasts())
  await flush()
})

describe('the modal window of the kit', () => {
  it('is a dialog with aria-modal, named by its title; the page behind is hidden from a screen reader', async () => {
    const { opener, window } = await openFromOpener()
    expect(window.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByTestId('probe')).toBe(window)
    expect(hiddenFromScreenReader(window)).toBe(false)
    expect(hiddenFromScreenReader(opener)).toBe(true)
  })

  it('takes its name from `label` when no element names it', async () => {
    render(
      <Dialog open onClose={() => undefined} label="Named" className="probe">
        <button type="button">inside</button>
      </Dialog>,
    )
    await flush()
    expect(screen.getByRole('dialog', { name: 'Named' })).toBeTruthy()
  })

  it('takes the focus on opening, where `initialFocus` says', async () => {
    const { window } = await openFromOpener()
    expect(document.activeElement).toBe(within(window).getByRole('textbox', { name: 'Field' }))
  })

  it('Tab does not leave the window: from the last control to the first, Shift+Tab back', async () => {
    const { window } = await openFromOpener()
    const close = within(window).getByRole('button', { name: 'Close' })
    close.focus()
    await pressTab()
    expect(document.activeElement).toBe(within(window).getByRole('textbox', { name: 'Field' }))
    await pressTab(true)
    expect(document.activeElement).toBe(close)
  })

  it('gives the focus back to what opened it, on Esc and on Close', async () => {
    const { opener } = await openFromOpener()
    pressKey(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(probe()).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    await flush()
    fireEvent.click(within(probe()!).getByRole('button', { name: 'Close' }))
    await flush()
    expect(probe()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Esc closes only the top layer and is marked handled: the open list of a Select first, then the window', async () => {
    const { window } = await openFromOpener()
    const heard = vi.fn()
    globalThis.addEventListener('keydown', heard)
    try {
      const select = within(window).getByRole('combobox', { name: 'Choice' })
      select.focus()
      pressKey(select, { key: 'ArrowDown' })
      const list = screen.getByRole('listbox')
      // The list is drawn inside the window: part of it for the focus trap and for a screen reader.
      expect(window.contains(list)).toBe(true)
      expect(hiddenFromScreenReader(list)).toBe(false)

      pressKey(select, { key: 'Escape' })
      await flush()
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(probe()).not.toBeNull()

      const escape = pressKey(select, { key: 'Escape' })
      await flush()
      expect(escape.defaultPrevented).toBe(true)
      expect(probe()).toBeNull()
      expect(heard).not.toHaveBeenCalled()
    } finally {
      globalThis.removeEventListener('keydown', heard)
    }
  })

  it('an option of a Select chosen with the mouse keeps the window open', async () => {
    const { window } = await openFromOpener()
    const select = within(window).getByRole('combobox', { name: 'Choice' })
    pressPointer(select)
    await flush()
    pressPointer(within(screen.getByRole('listbox')).getByRole('option', { name: 'Gamma' }))
    await flush()
    expect(probe()).not.toBeNull()
    expect(select.textContent).toContain('Gamma')
  })

  it('an Esc a control inside took (preventDefault) leaves the window open', async () => {
    const { window } = await openFromOpener()
    const field = within(window).getByRole('textbox', { name: 'Field' })
    field.addEventListener('keydown', (event) => event.preventDefault())
    pressKey(field, { key: 'Escape' })
    await flush()
    expect(probe()).not.toBeNull()
  })

  it('a press on the backdrop closes it, unless closeOnBackdrop is false; a press inside does not', async () => {
    await openFromOpener()
    pressPointer(screen.getByTestId('probe'))
    await flush()
    expect(probe()).not.toBeNull()
    pressPointer(screen.getByTestId('probe-backdrop'))
    await flush()
    expect(probe()).toBeNull()
    cleanup()

    await openFromOpener({ closeOnBackdrop: false })
    pressPointer(screen.getByTestId('probe-backdrop'))
    await flush()
    expect(probe()).not.toBeNull()
  })

  it('a press on the toasts does not close it, and the toasts stay heard by a screen reader', async () => {
    render(<ToastRegion projectId={undefined} />)
    act(() => {
      showToast({ kind: 'error', text: 'Cannot read the Ticket' })
      showToast({ kind: 'action', text: 'Archived 3 sessions', actions: [{ label: 'Undo', run: () => undefined }] })
    })
    const { window } = await openFromOpener()
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(hiddenFromScreenReader(screen.getByText('Cannot read the Ticket'))).toBe(false)
    expect(hiddenFromScreenReader(screen.getByText('Archived 3 sessions'))).toBe(false)
    expect(within(region).getByRole('alert').textContent).toContain('Cannot read the Ticket')

    pressPointer(screen.getByText('Archived 3 sessions'))
    await flush()
    expect(probe()).toBe(window)
    pressPointer(within(region).getAllByRole('button', { name: 'Dismiss' })[0]!)
    await flush()
    expect(probe()).toBe(window)
  })

  it('a blur of the app window and a switch of the view do not close it', async () => {
    const view = document.createElement('div')
    view.className = 'w-shell__view'
    document.body.append(view)
    try {
      await openFromOpener()
      await act(async () => {
        globalThis.dispatchEvent(new Event('blur'))
      })
      act(() => view.setAttribute('hidden', ''))
      await flush()
      expect(probe()).not.toBeNull()
    } finally {
      view.remove()
    }
  })
})

describe('the keys of the app while a kit window is open', () => {
  /** Listeners as the app behind the window has them: on window in both phases and on document. */
  function listenBehind() {
    const heard = { capture: vi.fn(), bubble: vi.fn(), document: vi.fn() }
    globalThis.addEventListener('keydown', heard.capture, true)
    globalThis.addEventListener('keydown', heard.bubble)
    document.addEventListener('keydown', heard.document)
    const stop = () => {
      globalThis.removeEventListener('keydown', heard.capture, true)
      globalThis.removeEventListener('keydown', heard.bubble)
      document.removeEventListener('keydown', heard.document)
    }
    return { heard, stop }
  }

  /** A layer of the page right under <body>, as a dialog that is not on the kit yet, with one button. */
  function layer(zIndex: number): HTMLButtonElement {
    const root = document.createElement('div')
    root.style.position = 'fixed'
    root.style.zIndex = String(zIndex)
    const button = document.createElement('button')
    root.append(button)
    document.body.append(root)
    return button
  }

  it('a ⌘ or Ctrl key pressed in the window reaches no listener of the app and keeps its own default', async () => {
    const { window } = await openFromOpener()
    const { heard, stop } = listenBehind()
    try {
      const field = within(window).getByRole('textbox', { name: 'Field' })
      for (const init of [{ key: 'k', metaKey: true }, { key: 'Enter', metaKey: true }, { key: 'c', ctrlKey: true }]) {
        expect(pressKey(field, init).defaultPrevented).toBe(false)
      }
      pressKey(field, { key: 'a' })
      expect(heard.capture).toHaveBeenCalledTimes(1)
      expect(heard.bubble).not.toHaveBeenCalled()
      expect(heard.document).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('with the focus fallen to the page: nothing behind hears a key, Tab brings the focus in, Esc closes', async () => {
    const { opener, window } = await openFromOpener()
    const { heard, stop } = listenBehind()
    try {
      act(() => (document.activeElement as HTMLElement).blur())
      pressKey(document.body, { key: 'k', metaKey: true })
      expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(within(window).getByRole('textbox', { name: 'Field' }))
      act(() => (document.activeElement as HTMLElement).blur())
      expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(true)
      await flush()
      expect(probe()).toBeNull()
      expect(document.activeElement).toBe(opener)
      expect(heard.capture).not.toHaveBeenCalled()
      expect(heard.bubble).not.toHaveBeenCalled()
      expect(heard.document).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('a layer above the window keeps its keys, and an Esc it gets leaves the window open', async () => {
    await openFromOpener()
    const above = layer(120)
    const { heard, stop } = listenBehind()
    try {
      act(() => above.focus())
      pressKey(above, { key: 'Escape' })
      await flush()
      expect(probe()).not.toBeNull()
      expect(heard.capture).toHaveBeenCalledTimes(1)
      expect(heard.bubble).toHaveBeenCalledTimes(1)
    } finally {
      stop()
      above.parentElement!.remove()
    }
  })

  it('closed, the window keeps no key', async () => {
    await openFromOpener()
    pressKey(document.activeElement!, { key: 'Escape' })
    await flush()
    const { heard, stop } = listenBehind()
    try {
      pressKey(document.body, { key: 'k', metaKey: true })
      expect(heard.capture).toHaveBeenCalledTimes(1)
      expect(heard.bubble).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })
})

describe('the Tab stops of a kit window with a group of the kit inside', () => {
  /**
   * A window with a group as the kit draws it (ToggleGroup, RadioGroup: roving tabindex, only the
   * active button is a Tab stop) and the hidden inputs Base UI adds, with tabindex -1, at both ends.
   */
  function GroupWindow() {
    const [open, setOpen] = useState(true)
    return (
      <Dialog open={open} onClose={() => setOpen(false)} label="Group window" className="probe">
        <input type="checkbox" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0 }} />
        <div role="group" aria-label="Size">
          <button type="button" tabIndex={-1}>
            S
          </button>
          <button type="button" tabIndex={0} aria-pressed="true">
            M
          </button>
          <button type="button" tabIndex={-1}>
            L
          </button>
        </div>
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
        <input type="checkbox" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0 }} />
      </Dialog>
    )
  }

  async function openGroupWindow() {
    render(<GroupWindow />)
    await flush()
    const window = screen.getByRole('dialog', { name: 'Group window' })
    return {
      active: within(window).getByRole('button', { name: 'M' }),
      close: within(window).getByRole('button', { name: 'Close' }),
    }
  }

  it('Tab and Shift+Tab stop once in the group, on its active button, and skip what has tabindex -1', async () => {
    const { active, close } = await openGroupWindow()
    active.focus()
    await pressTab()
    expect(document.activeElement).toBe(close)
    await pressTab()
    expect(document.activeElement).toBe(active)
    await pressTab(true)
    expect(document.activeElement).toBe(close)
  })

  it('with the focus fallen to the page, Tab brings it to the active button of the group and Shift+Tab to the last stop', async () => {
    const { active, close } = await openGroupWindow()
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(active)
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
  })
})

describe('the layers a kit window yields to', () => {
  it('a popup of the kit that is not a window counts as a layer above, whatever its z-index: it keeps its keys and its Esc', async () => {
    const { window } = await openFromOpener()
    // A popup of the kit drawn on <body> with no z-index of its own: a popover, a menu.
    const popup = document.createElement('div')
    popup.setAttribute(KIT_POPUP_ATTRIBUTE, '')
    const item = document.createElement('button')
    popup.append(item)
    document.body.append(popup)
    const heard = vi.fn()
    globalThis.addEventListener('keydown', heard)
    try {
      expect(pressKey(item, { key: 'Escape' }).defaultPrevented).toBe(false)
      expect(heard).toHaveBeenCalledTimes(1)
      await flush()
      expect(window.isConnected).toBe(true)
      expect(probe()).not.toBeNull()
    } finally {
      globalThis.removeEventListener('keydown', heard)
      popup.remove()
    }
  })

  /** A window that opens a second window of the kit over itself, as a confirmation does. */
  function TwoWindows() {
    const [outer, setOuter] = useState(true)
    const [inner, setInner] = useState(false)
    return (
      <>
        <Dialog open={outer} onClose={() => setOuter(false)} label="Outer window" className="probe">
          <button type="button" onClick={() => setInner(true)}>
            Open inner
          </button>
        </Dialog>
        <Dialog open={inner} onClose={() => setInner(false)} label="Inner window" className="probe">
          <button type="button">Inner first</button>
          <button type="button">Inner last</button>
        </Dialog>
      </>
    )
  }

  it('with two windows open, the one opened last is on top: Tab of a fallen focus goes into it, Esc closes it alone', async () => {
    render(<TwoWindows />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }))
    await flush()
    const inner = screen.getByRole('dialog', { name: 'Inner window' })
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(within(inner).getByRole('button', { name: 'Inner first' }))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(within(inner).getByRole('button', { name: 'Inner last' }))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Escape' }).defaultPrevented).toBe(true)
    await flush()
    expect(screen.queryByRole('dialog', { name: 'Inner window' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Outer window' })).not.toBeNull()
  })
})
