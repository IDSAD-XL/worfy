// The Keyboard shortcuts window (src/renderer/shortcuts/ShortcutsOverlay.tsx, worfy-ui ticket 11):
// what opens it — "?" outside a text field and a Terminal Node, Help ▸ Keyboard Shortcuts of the app
// menu (`menu.command`), Ctrl+/ caught by the renderer on Windows, the palette's "Keyboard
// shortcuts" —, the groups it shows, Esc that closes it and goes no further, the modal guard, and
// Settings → Shortcuts with the same rows. Over a fake preload bridge; no main.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { SHORTCUT_GROUPS, SHORTCUT_LIST } from '../../src/shared/shortcuts'
import { CommandPalette } from '../../src/renderer/palette/CommandPalette'
import type { Platform } from '../../src/renderer/platform'
import { SettingsDialogView } from '../../src/renderer/settings/SettingsDialog'
import { settingsSections } from '../../src/renderer/settings/sections'
import { closeSettings, openSettings, useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { label } from '../../src/renderer/shortcuts/match'
import { ShortcutsOverlay } from '../../src/renderer/shortcuts/ShortcutsOverlay'
import { closeShortcuts, openShortcuts, useShortcutsWindow } from '../../src/renderer/shortcuts/shortcuts-window'

const globals = globalThis as { worfy?: WorfyBridge }

/** The preload bridge of a window with no main behind it: what subscribes can be told an event. */
function fakeBridge() {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const bridge = {
    invoke: () => Promise.resolve({ ok: false, error: 'not in this test' }),
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(next, { channel, handler })
      return next++
    },
    off: (id: number) => handlers.delete(id),
  }
  globals.worfy = bridge as unknown as WorfyBridge
  return {
    emit: (channel: string, payload: unknown) => {
      for (const each of [...handlers.values()]) if (each.channel === channel) each.handler(payload)
    },
  }
}

let main: ReturnType<typeof fakeBridge>

beforeEach(() => {
  main = fakeBridge()
  useSettingsWindow.setState({ open: false, section: null })
  useShortcutsWindow.setState({ open: false })
  // jsdom has no scrollIntoView; the palette calls it for the active row.
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(() => {
  act(() => {
    closeShortcuts()
    closeSettings()
  })
  delete globals.worfy
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const on = (platform: Platform): void => {
  document.documentElement.dataset.platform = platform
}

const shortcutsWindow = () => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })

/** The page under the window: the Canvas's plane (focusable, as React Flow's pane), a field, a Terminal Node. */
function renderPage(platform: Platform = 'mac') {
  on(platform)
  render(
    <>
      <div className="react-flow__pane" tabIndex={-1} data-testid="plane" />
      <textarea aria-label="Note text" />
      <div className="w-node-surface w-terminal" data-testid="terminal-node">
        <div className="w-terminal__header" tabIndex={-1} data-testid="terminal-header" />
        <div className="xterm">
          <textarea aria-label="Terminal input" />
        </div>
      </div>
      <ShortcutsOverlay />
    </>,
  )
  return {
    plane: screen.getByTestId('plane'),
    note: screen.getByRole('textbox', { name: 'Note text' }),
    terminalHeader: screen.getByTestId('terminal-header'),
    terminal: screen.getByRole('textbox', { name: 'Terminal input' }),
  }
}

/** Presses a key on `target`; returns the event, to see whether it was cancelled. */
function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/** The rows of a list: entry id → [title, keys]. */
const rowsOf = (container: HTMLElement): [string, string, string][] =>
  [...container.querySelectorAll<HTMLElement>('[data-shortcut]')].map((row) => [
    row.dataset.shortcut!,
    row.querySelector('.w-shortcut-list__title')!.textContent!,
    row.querySelector('kbd')!.textContent!,
  ])

describe('what opens the window', () => {
  it('"?" on the Canvas opens it; "?" in a text area and in a Terminal Node does not', () => {
    const { plane, note, terminal, terminalHeader } = renderPage()
    plane.focus()
    press(note, { key: '?', shiftKey: true })
    press(terminal, { key: '?', shiftKey: true })
    press(terminalHeader, { key: '?', shiftKey: true })
    expect(shortcutsWindow()).toBeNull()
    const event = press(plane, { key: '?', shiftKey: true })
    expect(shortcutsWindow()).not.toBeNull()
    expect(event.defaultPrevented).toBe(true)
  })

  it('"?" with the primary modifier or after another listener took it does not open it', () => {
    const { plane } = renderPage()
    press(plane, { key: '?', shiftKey: true, metaKey: true })
    expect(shortcutsWindow()).toBeNull()
    const taken = (event: KeyboardEvent) => event.preventDefault()
    plane.addEventListener('keydown', taken)
    press(plane, { key: '?', shiftKey: true })
    plane.removeEventListener('keydown', taken)
    expect(shortcutsWindow()).toBeNull()
  })

  it('Help ▸ Keyboard Shortcuts of the app menu (`menu.command`) opens it; another command does not', () => {
    renderPage()
    act(() => main.emit('menu.command', 'toggleSidebar'))
    expect(shortcutsWindow()).toBeNull()
    act(() => main.emit('menu.command', 'shortcuts'))
    expect(shortcutsWindow()).not.toBeNull()
  })

  it('on Windows the renderer catches Ctrl+/, outside a Terminal Node only; on macOS ⌘/ is the menu’s', () => {
    const { plane, note, terminal } = renderPage('windows')
    press(terminal, { key: '/', ctrlKey: true })
    expect(shortcutsWindow()).toBeNull()
    // In a text field too: Ctrl+/ types nothing there.
    press(note, { key: '/', ctrlKey: true })
    expect(shortcutsWindow()).not.toBeNull()
    act(() => closeShortcuts())
    press(plane, { key: '/', ctrlKey: true })
    expect(shortcutsWindow()).not.toBeNull()
    act(() => closeShortcuts())
    on('mac')
    press(plane, { key: '/', metaKey: true })
    expect(shortcutsWindow()).toBeNull()
  })

  it('the palette’s "Keyboard shortcuts" opens it', () => {
    renderPage()
    render(<CommandPalette />)
    fireEvent.click(screen.getByTestId('palette-trigger'))
    const input = screen.getByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'keyboard shortcuts' } })
    const option = screen.getAllByTestId('palette-option')[0]!
    expect(option.getAttribute('data-command')).toBe('shortcuts')
    expect(option.textContent).toContain('⌘/')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(shortcutsWindow()).not.toBeNull()
  })
})

describe('the window', () => {
  it('shows the groups under headings, in order, each row with its title and the keys of macOS', () => {
    renderPage('mac')
    act(() => openShortcuts())
    const dialog = shortcutsWindow()!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([...SHORTCUT_GROUPS])
    for (const group of SHORTCUT_GROUPS) expect(within(dialog).getByRole('region', { name: group })).toBeTruthy()
    const rows = rowsOf(dialog)
    expect(rows).toHaveLength(SHORTCUT_LIST.length)
    expect(rows).toContainEqual(['palette', 'Search or run a command', '⌘K'])
    expect(rows).toContainEqual(['session.new-line', 'New line', '⇧⏎'])
    expect(rows).toContainEqual(['scale.bigger', 'Bigger interface', '⌥⌘='])
    expect(rows).toContainEqual(['terminal.request', 'Command request (zsh with Terminal AI)', '⌘I'])
    // Every key is in <kbd>, as the label of the registry writes it.
    for (const [id, , keys] of rows) expect(keys).toBe(label(SHORTCUT_LIST.find((shortcut) => shortcut.id === id)!, 'mac'))
  })

  it('on Windows writes Ctrl and leaves out the entry of macOS alone, and its empty group', () => {
    renderPage('windows')
    act(() => openShortcuts())
    const dialog = shortcutsWindow()!
    const rows = rowsOf(dialog)
    expect(rows).toContainEqual(['palette', 'Search or run a command', 'Ctrl+K'])
    expect(rows).toContainEqual(['session.new-line', 'New line', 'Shift+Enter'])
    expect(rows).toContainEqual(['scale.bigger', 'Bigger interface', 'Ctrl+Alt+='])
    expect(rows.map(([id]) => id)).not.toContain('terminal.request')
    expect(within(dialog).queryByRole('heading', { name: 'Terminal' })).toBeNull()
    expect(rows.every(([, , keys]) => !/[⌘⇧⌥⏎]/.test(keys))).toBe(true)
  })

  it('Esc closes it and reaches no listener of the window, capture phase included; the focus goes back', () => {
    const { plane } = renderPage()
    plane.focus()
    press(plane, { key: '?', shiftKey: true })
    expect(shortcutsWindow()).not.toBeNull()
    expect(document.activeElement?.closest('[role="dialog"]')).toBe(shortcutsWindow())
    // Focus mode listens for Esc on window in the capture phase (FocusMode.tsx), added after this file loaded.
    const reached: string[] = []
    const capture = (event: KeyboardEvent) => reached.push(`capture ${event.key}`)
    const bubble = (event: KeyboardEvent) => reached.push(`bubble ${event.key}`)
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', bubble)
    try {
      const event = press(document.activeElement!, { key: 'Escape' })
      expect(event.defaultPrevented).toBe(true)
      expect(shortcutsWindow()).toBeNull()
      expect(reached).toEqual([])
      expect(document.activeElement).toBe(plane)
      // Closed, the window keeps nothing: the next Esc is the app's again.
      press(plane, { key: 'Escape' })
      expect(reached).toEqual(['capture Escape', 'bubble Escape'])
    } finally {
      window.removeEventListener('keydown', capture, true)
      window.removeEventListener('keydown', bubble)
    }
  })

  it('while it is open the shortcuts of the app reach nobody, and Tab goes round the list and Close', () => {
    renderPage()
    act(() => openShortcuts())
    const dialog = shortcutsWindow()!
    const reached: string[] = []
    const listener = (event: KeyboardEvent) => reached.push(event.key)
    window.addEventListener('keydown', listener)
    try {
      press(document.body, { key: 'k', metaKey: true })
      press(document.activeElement!, { key: 'Enter', metaKey: true })
      press(document.activeElement!, { key: '?', shiftKey: true })
      expect(reached).toEqual([])
      const list = dialog.querySelector('.w-shortcuts__body')
      const close = within(dialog).getByRole('button', { name: 'Close' })
      expect(document.activeElement).toBe(list)
      press(document.activeElement!, { key: 'Tab' })
      expect(document.activeElement).toBe(close)
      press(document.activeElement!, { key: 'Tab' })
      expect(document.activeElement).toBe(list)
      press(document.activeElement!, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(close)
      fireEvent.click(close)
      expect(shortcutsWindow()).toBeNull()
    } finally {
      window.removeEventListener('keydown', listener)
    }
  })

  it('a press on the backdrop closes it; a press inside does not', () => {
    renderPage()
    act(() => openShortcuts())
    fireEvent.mouseDown(shortcutsWindow()!)
    expect(shortcutsWindow()).not.toBeNull()
    fireEvent.mouseDown(screen.getByTestId('shortcuts-backdrop'))
    expect(shortcutsWindow()).toBeNull()
  })

  it('is drawn in the layer of the Settings window, a child of <body>', () => {
    renderPage()
    act(() => openShortcuts())
    const backdrop = screen.getByTestId('shortcuts-backdrop')
    expect(backdrop.parentElement).toBe(document.body)
    expect(backdrop.style.zIndex).toBe('110')
  })
})

describe('Settings → Shortcuts', () => {
  it('is a section of the Settings window, after Health and before Machines, with the same rows as the window', () => {
    on('mac')
    const sections = settingsSections.map((section) => [section.id, section.order, section.title])
    expect(sections).toContainEqual(['ShortcutsSection', 30, 'Shortcuts'])
    render(
      <>
        <SettingsDialogView sections={settingsSections} />
        <ShortcutsOverlay />
      </>,
    )
    act(() => openSettings('ShortcutsSection'))
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(settings).getByRole('heading', { level: 2 }).textContent).toBe('Shortcuts')
    const inSettings = rowsOf(settings)
    act(() => closeSettings())
    act(() => openShortcuts())
    expect(inSettings).toEqual(rowsOf(shortcutsWindow()!))
    expect(inSettings.length).toBeGreaterThan(0)
  })

  it('with Settings open, "open the shortcuts" shows its Shortcuts section; Settings opening over the window closes it', () => {
    render(
      <>
        <SettingsDialogView sections={settingsSections} />
        <ShortcutsOverlay />
      </>,
    )
    act(() => openSettings())
    act(() => main.emit('menu.command', 'shortcuts'))
    expect(shortcutsWindow()).toBeNull()
    expect(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('heading', { level: 2 }).textContent).toBe('Shortcuts')
    act(() => closeSettings())
    act(() => openShortcuts())
    expect(shortcutsWindow()).not.toBeNull()
    act(() => openSettings())
    expect(shortcutsWindow()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })
})
