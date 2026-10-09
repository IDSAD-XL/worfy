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
