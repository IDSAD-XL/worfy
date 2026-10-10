import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingSwitch } from '../../src/renderer/settings/controls'
import { SettingsDialogView } from '../../src/renderer/settings/SettingsDialog'
import { collectSections } from '../../src/renderer/settings/sections'
import { closeSettings, openSettings, useSettingsWindow } from '../../src/renderer/settings/settings-window'

// The Settings window (worfy-ui ticket 2): a modal dialog with its sections on the left, found by
// file. Two stub sections stand in for the real files, their `order` against their file names.

const section = (text: string) =>
  function Section() {
    return <p>{text}</p>
  }

const sections = () =>
  collectSections({
    './AlphaSection.tsx': { default: section('Alpha body'), order: 20, title: 'Alpha' },
    './BetaSection.tsx': { default: section('Beta body'), order: 10, title: 'Beta' },
  })

const dialog = () => screen.getByRole('dialog', { name: 'Settings' })
const rows = () => within(screen.getByRole('navigation', { name: 'Settings sections' })).getAllByRole('button')
const shownTitle = () => within(dialog()).getByRole('heading', { level: 2 }).textContent

/** The page under the window: a button that had the focus before Settings opened. */
function renderWithOpener() {
  render(
    <>
      <button type="button">opener</button>
      <SettingsDialogView sections={sections()} />
    </>,
  )
  const opener = screen.getByRole('button', { name: 'opener' })
  opener.focus()
  return opener
}

beforeEach(() => {
  useSettingsWindow.setState({ open: false, section: null })
})

afterEach(() => {
  act(() => closeSettings())
})

describe('collectSections', () => {
  it('orders the section files by `order`; the id is the file name', () => {
    expect(sections().map(({ id, order, title }) => [id, order, title])).toEqual([
      ['BetaSection', 10, 'Beta'],
      ['AlphaSection', 20, 'Alpha'],
    ])
  })

  it('a file without a title, an order or a component is an error that names the file', () => {
    expect(() => collectSections({ './NoTitleSection.tsx': { default: section('x'), order: 1 } })).toThrow(/\.\/NoTitleSection\.tsx.*title/)
    expect(() => collectSections({ './EmptyTitleSection.tsx': { default: section('x'), order: 1, title: '  ' } })).toThrow(/\.\/EmptyTitleSection\.tsx.*title/)
    expect(() => collectSections({ './NoOrderSection.tsx': { default: section('x'), title: 'No order' } })).toThrow(/\.\/NoOrderSection\.tsx.*order/)
    expect(() => collectSections({ './NoComponentSection.tsx': { order: 1, title: 'No component' } })).toThrow(/\.\/NoComponentSection\.tsx.*component/)
  })
})

describe('Settings window', () => {
  it('is closed until opened; then lists the sections by order and shows the first', () => {
    renderWithOpener()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => openSettings())
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(rows().map((row) => row.textContent)).toEqual(['Beta', 'Alpha'])
    expect(rows()[0]?.getAttribute('aria-current')).toBe('true')
    expect(shownTitle()).toBe('Beta')
    expect(screen.getByText('Beta body')).toBeTruthy()
    expect(screen.queryByText('Alpha body')).toBeNull()
  })

  it('a click on a section shows it', () => {
    renderWithOpener()
    act(() => openSettings())
    fireEvent.click(rows()[1]!)
    expect(shownTitle()).toBe('Alpha')
    expect(screen.getByText('Alpha body')).toBeTruthy()
    expect(rows()[1]?.getAttribute('aria-current')).toBe('true')
    expect(rows()[0]?.getAttribute('aria-current')).toBeNull()
  })

  it('↓ and ↑ move between the sections and take the focus along; they stop at the ends', () => {
    renderWithOpener()
    act(() => openSettings())
    // Opening puts the focus on the selected section, so the arrows work at once.
    expect(document.activeElement).toBe(rows()[0])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(shownTitle()).toBe('Alpha')
    expect(document.activeElement).toBe(rows()[1])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(shownTitle()).toBe('Alpha')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(shownTitle()).toBe('Beta')
    expect(document.activeElement).toBe(rows()[0])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(shownTitle()).toBe('Beta')
  })

  it('openSettings(id) opens that section; an unknown id opens the first', () => {
    renderWithOpener()
    act(() => openSettings('AlphaSection'))
    expect(shownTitle()).toBe('Alpha')
    expect(document.activeElement).toBe(rows()[1])
    act(() => closeSettings())
    act(() => openSettings('NoSuchSection'))
    expect(shownTitle()).toBe('Beta')
  })

  it('Esc closes it, returns the focus and keeps the Esc from the window below', () => {
    const opener = renderWithOpener()
    const below = vi.fn()
    window.addEventListener('keydown', below)
    try {
      act(() => openSettings())
      expect(document.activeElement).not.toBe(opener)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => {
        document.activeElement!.dispatchEvent(event)
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(useSettingsWindow.getState().open).toBe(false)
      expect(event.defaultPrevented).toBe(true)
      // Focus mode closes on an Esc that reaches the window: this one must not.
      expect(below).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(opener)
    } finally {
      window.removeEventListener('keydown', below)
    }
  })

  it('Close closes it and returns the focus', () => {
    const opener = renderWithOpener()
    act(() => openSettings())
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside the window', () => {
    renderWithOpener()
    act(() => openSettings())
    const close = within(dialog()).getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(rows()[0])
    fireEvent.keyDown(rows()[0]!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
  })
})

describe('Settings window: modal', () => {
  /** Listeners as the app behind the window has them: on `window` in both phases and on `document`. */
  function listenBehind() {
    const heard = { capture: vi.fn(), bubble: vi.fn(), document: vi.fn() }
    window.addEventListener('keydown', heard.capture, true)
    window.addEventListener('keydown', heard.bubble)
    document.addEventListener('keydown', heard.document)
    const stop = () => {
      window.removeEventListener('keydown', heard.capture, true)
      window.removeEventListener('keydown', heard.bubble)
      document.removeEventListener('keydown', heard.document)
    }
    return { heard, stop }
  }

  const press = (target: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  /** The focused element goes away, as when a popover behind closes: the focus falls to the page. */
  const loseFocus = () => {
    act(() => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)
  }

  /** A layer of the page right under `body`, as a portal of another dialog, with one button. */
  function layer(zIndex: number): HTMLButtonElement {
    const root = document.createElement('div')
    root.style.position = 'fixed'
    root.style.zIndex = String(zIndex)
    const button = document.createElement('button')
    root.append(button)
    document.body.append(root)
    return button
  }

  afterEach(() => {
    for (const each of [...document.body.querySelectorAll('[data-test-layer], .w-focus')]) each.remove()
  })

  it('focus outside the dialog: Tab returns into the dialog, Esc still closes, and nothing behind hears the keys', () => {
    const opener = renderWithOpener()
    const { heard, stop } = listenBehind()
    try {
      act(() => openSettings())
      loseFocus()
      expect(press(document.body, { key: 'Tab' }).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(rows()[0])
      loseFocus()
      press(document.body, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Close' }))
      loseFocus()
      // A plain key and a shortcut of the app, typed at the page: swallowed, the window stays.
      press(document.body, { key: 'Backspace' })
      press(document.body, { key: 'k', metaKey: true })
      // Esc with a modifier is not the window's Esc: swallowed like any other key.
      expect(press(document.body, { key: 'Escape', altKey: true }).defaultPrevented).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(press(document.body, { key: 'Escape' }).defaultPrevented).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
      expect(heard.capture).not.toHaveBeenCalled()
      expect(heard.bubble).not.toHaveBeenCalled()
      expect(heard.document).not.toHaveBeenCalled()
      // Closed: the page has its keys again.
      press(document.body, { key: 'k', metaKey: true })
      expect(heard.capture).toHaveBeenCalledTimes(1)
      expect(heard.bubble).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  it('a ⌘ or Ctrl shortcut pressed inside reaches no listener of the app, and the key keeps its own default', () => {
    renderWithOpener()
    const { heard, stop } = listenBehind()
    try {
      act(() => openSettings())
      for (const init of [{ key: 'k', metaKey: true }, { key: 'f', metaKey: true }, { key: 'Enter', metaKey: true }, { key: 'k', ctrlKey: true }]) {
        // Not prevented: copy, paste and undo in a field of a section still work.
        expect(press(rows()[0]!, init).defaultPrevented).toBe(false)
      }
      expect(heard.capture).not.toHaveBeenCalled()
      expect(heard.bubble).not.toHaveBeenCalled()
      expect(heard.document).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeNull()
    } finally {
      stop()
    }
  })

  it('a plain key pressed inside goes to the window and stops before the listeners on window', () => {
    renderWithOpener()
    const { heard, stop } = listenBehind()
    try {
      act(() => openSettings())
      press(rows()[0]!, { key: 'Backspace' })
      press(rows()[0]!, { key: 'ArrowDown' })
      // The window's own handler got it.
      expect(shownTitle()).toBe('Alpha')
      expect(heard.bubble).not.toHaveBeenCalled()
      expect(heard.document).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('an Esc that a control inside took (preventDefault) does not close the window', () => {
    function Taker() {
      return (
        <button type="button" onKeyDown={(event) => event.key === 'Escape' && event.preventDefault()}>
          takes Esc
        </button>
      )
    }
    render(<SettingsDialogView sections={collectSections({ './TakerSection.tsx': { default: Taker, order: 1, title: 'Taker' } })} />)
    act(() => openSettings())
    const taker = screen.getByRole('button', { name: 'takes Esc' })
    taker.focus()
    press(taker, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    // The same key on a control that does not take it closes the window.
    press(within(dialog()).getByRole('button', { name: 'Close' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a layer above the window keeps its focus and its keys; a layer under it cannot take the focus', () => {
    renderWithOpener()
    const { heard, stop } = listenBehind()
    try {
      act(() => openSettings())
      fireEvent.keyDown(rows()[0]!, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(rows()[1])

      // Under the window (First run is at 90): the focus comes back to where it was inside.
      const under = layer(90)
      under.parentElement!.dataset.testLayer = ''
      act(() => under.focus())
      expect(document.activeElement).toBe(rows()[1])

      // Above it (the list of a Select is at 3000): the focus stays, the keys go on to the page.
      const above = layer(3000)
      above.parentElement!.dataset.testLayer = ''
      act(() => above.focus())
      expect(document.activeElement).toBe(above)
      heard.capture.mockClear()
      press(above, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).not.toBeNull()
      expect(heard.capture).toHaveBeenCalledTimes(1)
      expect(heard.bubble).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  it('a second open while it is open keeps one window and the place the focus returns to', () => {
    const opener = renderWithOpener()
    act(() => openSettings())
    // The menu's "Settings…" again, then a command that asks for a section: the focus is inside by now.
    act(() => openSettings())
    expect(shownTitle()).toBe('Beta')
    act(() => openSettings('AlphaSection'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(shownTitle()).toBe('Alpha')
    press(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not open while focus mode is on screen: it would open unseen under it', () => {
    renderWithOpener()
    const focusMode = document.createElement('div')
    focusMode.className = 'w-focus'
    document.body.append(focusMode)
    act(() => openSettings())
    expect(useSettingsWindow.getState().open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    focusMode.remove()
    act(() => openSettings())
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

describe('SettingSwitch', () => {
  it('is a switch with aria-checked; a click calls onChange with the other value', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SettingSwitch label="Keep awake" checked={false} onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'Keep awake' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(onChange).toHaveBeenLastCalledWith(true)
    rerender(<SettingSwitch label="Keep awake" checked onChange={onChange} />)
    expect(control.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(control)
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('disabled does not call onChange', () => {
    const onChange = vi.fn()
    render(<SettingSwitch label="Keep awake" checked={false} disabled onChange={onChange} />)
    const control = screen.getByRole('switch', { name: 'Keep awake' })
    expect((control as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(control)
    expect(onChange).not.toHaveBeenCalled()
  })
})
