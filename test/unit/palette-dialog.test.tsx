// The Command palette as a window of the kit (src/renderer/palette/CommandPalette.tsx on
// theme/kit/Dialog.tsx, worfy-ui-kit ticket 08): a dialog with a name and `aria-modal`, Tab kept inside
// it, the focus back where it was on closing, Esc closed and marked handled. Its layer sits under the
// windows of the kit: Settings opened over it (⌘, of the app menu) is on top and has the keys, and the
// palette gets the focus back when Settings closes. Over a fake preload bridge: no Project, no main.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { CommandPalette } from '../../src/renderer/palette/CommandPalette'
import { SettingsDialogView } from '../../src/renderer/settings/SettingsDialog'
import type { SettingsSection } from '../../src/renderer/settings/sections'
import { closeSettings, openSettings, useSettingsWindow } from '../../src/renderer/settings/settings-window'
import { ShortcutsOverlay } from '../../src/renderer/shortcuts/ShortcutsOverlay'
import { closeShortcuts, useShortcutsWindow } from '../../src/renderer/shortcuts/shortcuts-window'
import { LAYERS } from '../../src/renderer/theme/layers'
import { pressTab } from './tab-key'

const globals = globalThis as { worfy?: WorfyBridge }

/** A section of Settings with one field: the window's own content does not matter here. */
const SECTIONS: readonly SettingsSection[] = [{ id: 'ProbeSection', order: 1, title: 'Probe', Component: () => <input aria-label="Probe field" /> }]

/** Lets Base UI's effects and frames run. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

/** A key pressed on `target` as the browser sends it; returns the event, to see whether it was cancelled. */
function pressKey(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

// By test id: with Settings over it, the palette is hidden from a screen reader, as the page is.
const palette = () => screen.queryByTestId('command-palette')
const settings = () => screen.queryByRole('dialog', { name: 'Settings' })
const field = () => within(palette()!).getByTestId('palette-input')

/** The z-index of the layer `element` is drawn in: of its ancestor right under <body>. */
function layerOf(element: Element): number {
  let layer = element
  while (layer.parentElement !== document.body) layer = layer.parentElement!
  return Number.parseInt(getComputedStyle(layer).zIndex, 10)
}

/** The page: the Canvas's plane (focusable, as React Flow's pane), the palette, Settings, Keyboard shortcuts. */
function renderPage() {
  render(
    <>
      <div className="react-flow__pane" tabIndex={-1} data-testid="plane" />
      <CommandPalette />
      <SettingsDialogView sections={SECTIONS} />
      <ShortcutsOverlay />
    </>,
  )
  return { plane: screen.getByTestId('plane'), trigger: screen.getByTestId('palette-trigger') }
}

/** ⌘K on the plane: the palette opens over the Canvas. */
async function openFromPlane(): Promise<HTMLElement> {
  const { plane } = renderPage()
  plane.focus()
  pressKey(plane, { key: 'k', metaKey: true })
  await flush()
  expect(palette()).not.toBeNull()
  return plane
}

beforeEach(() => {
  document.documentElement.dataset.platform = 'mac'
  globals.worfy = {
    invoke: () => Promise.resolve({ ok: false, error: 'not in this test' }),
    on: () => 0,
    off: () => undefined,
  } as unknown as WorfyBridge
  useSettingsWindow.setState({ open: false, section: null })
  useShortcutsWindow.setState({ open: false })
  // jsdom has no scrollIntoView; the palette calls it for the active row.
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(async () => {
  act(() => {
    closeSettings()
    closeShortcuts()
  })
  cleanup()
  await flush()
  delete globals.worfy
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  vi.restoreAllMocks()
})

describe('the Command palette is a window of the kit', () => {
  it('is a dialog named "Command palette" with aria-modal, the focus in its field; the page behind is hidden from a screen reader', async () => {
    const plane = await openFromPlane()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(palette()).toBe(dialog)
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: 'Search or run' }))
    const hidden = (element: Element | null): boolean => element !== null && (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('inert') || hidden(element.parentElement))
    expect(hidden(plane)).toBe(true)
    expect(hidden(dialog)).toBe(false)
  })

  it('Tab and Shift+Tab do not take the focus out of the palette', async () => {
    await openFromPlane()
    await pressTab()
    expect(palette()!.contains(document.activeElement)).toBe(true)
    await pressTab(true)
    expect(palette()!.contains(document.activeElement)).toBe(true)
    await pressTab()
    await pressTab()
    expect(palette()!.contains(document.activeElement)).toBe(true)
  })

  it('Esc closes it, marked handled, heard by no listener of the window; the focus goes back to the plane it was on', async () => {
    const plane = await openFromPlane()
    const heard = vi.fn()
    globalThis.addEventListener('keydown', heard)
    try {
      const event = pressKey(field(), { key: 'Escape' })
      expect(event.defaultPrevented).toBe(true)
      expect(heard).not.toHaveBeenCalled()
    } finally {
      globalThis.removeEventListener('keydown', heard)
    }
    await flush()
    expect(palette()).toBeNull()
    expect(document.activeElement).toBe(plane)
  })

  it('opened from the toolbar, it gives the focus back to the trigger; a press on the backdrop closes it', async () => {
    const { trigger } = renderPage()
    trigger.focus()
    fireEvent.click(trigger)
    await flush()
    expect(document.activeElement).toBe(field())
    const backdrop = palette()!.parentElement!
    fireEvent.mouseDown(backdrop)
    await flush()
    expect(palette()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('lies on the palette layer of the scale, under the windows of the kit', async () => {
    await openFromPlane()
    expect(layerOf(palette()!)).toBe(LAYERS.palette)
    expect(LAYERS.palette).toBeLessThan(LAYERS.dialog)
  })
})

describe('⌘K, then ⌘, (Settings over the open palette)', () => {
  it('Settings is on top and has the keys; its Esc closes it alone, and the palette gets the focus back', async () => {
    const plane = await openFromPlane()
    fireEvent.change(field(), { target: { value: 'sett' } })
    const pickedBefore = field().getAttribute('aria-activedescendant')
    // What the app menu's "Settings…" (⌘,) does in the renderer (settings-window.ts).
    act(() => openSettings())
    await flush()
    const window = settings()!
    expect(palette()).not.toBeNull()
    expect(layerOf(window)).toBeGreaterThan(layerOf(palette()!))
    expect(window.contains(document.activeElement)).toBe(true)
    // The palette is under Settings for a screen reader too.
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()

    // A fallen focus goes into Settings with Tab, not into the palette.
    act(() => (document.activeElement as HTMLElement).blur())
    expect(pressKey(document.body, { key: 'Tab' }).defaultPrevented).toBe(true)
    expect(window.contains(document.activeElement)).toBe(true)
    // ↓ in Settings does not walk the palette's rows.
    pressKey(document.activeElement!, { key: 'ArrowDown' })
    expect(field().getAttribute('aria-activedescendant')).toBe(pickedBefore)

    // Esc closes Settings alone; the focus goes back to the palette's field, with its query.
    pressKey(document.activeElement!, { key: 'Escape' })
    await flush()
    expect(settings()).toBeNull()
    expect(palette()).not.toBeNull()
    expect(document.activeElement).toBe(field())
    expect(field()).toHaveProperty('value', 'sett')

    // The next Esc closes the palette, and the focus goes back to the plane.
    pressKey(field(), { key: 'Escape' })
    await flush()
    expect(palette()).toBeNull()
    expect(document.activeElement).toBe(plane)
  })
})

describe('a command that opens a window of the kit', () => {
  it.each([
    ['shortcuts', 'keyboard shortcuts', 'Keyboard shortcuts'],
    ['settings', 'settings', 'Settings'],
  ])('"%s" closes the palette and leaves the focus in the window it opened', async (command, query, name) => {
    await openFromPlane()
    fireEvent.change(field(), { target: { value: query } })
    expect(within(palette()!).getAllByTestId('palette-option')[0]!.getAttribute('data-command')).toBe(command)
    fireEvent.keyDown(field(), { key: 'Enter' })
    await flush()
    expect(palette()).toBeNull()
    const window = screen.getByRole('dialog', { name })
    expect(window.contains(document.activeElement)).toBe(true)
  })
})
