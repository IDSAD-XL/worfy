// Ctrl in place of ⌘ on Windows (worfy-windows ticket 11), on the components that read the system
// from <html data-platform> (src/renderer/platform.ts): the command palette and the hints of the
// composer. The keys of the Canvas (⌘F, ⌘Z, ⌘ held in a drag) are in test/unit/canvas.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import { currentPlatform, markPlatform, type Platform } from '../../src/renderer/platform'
import { CommandPalette } from '../../src/renderer/palette/CommandPalette'
import { composerHint, slashHint } from '../../src/renderer/session/hints'

const globals = globalThis as { worfy?: WorfyBridge }

beforeEach(() => {
  // No Project: the palette opens with the commands that need none.
  globals.worfy = { invoke: () => Promise.resolve({ ok: false, error: 'not in this test' }), on: () => 1, off: () => undefined } as unknown as WorfyBridge
  // jsdom has no scrollIntoView; the palette calls it for the active row.
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(() => {
  delete globals.worfy
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  vi.restoreAllMocks()
})

const on = (platform: Platform): void => {
  document.documentElement.dataset.platform = platform
}

/** An element inside a Terminal Node, as xterm builds it: the textarea that has the focus. */
function terminalField(): HTMLElement {
  const terminal = document.createElement('div')
  terminal.className = 'xterm'
  const field = document.createElement('textarea')
  terminal.append(field)
  document.body.append(terminal)
  return field
}

describe('the system of the window', () => {
  it('is what <html data-platform> says, and the user agent when it says nothing or nonsense', () => {
    const agent = vi.spyOn(window.navigator, 'userAgent', 'get')
    agent.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38.0.0')
    on('mac')
    expect(currentPlatform()).toBe('mac')
    delete document.documentElement.dataset.platform
    expect(currentPlatform()).toBe('windows')
    document.documentElement.dataset.platform = 'amiga'
    expect(currentPlatform()).toBe('windows')
    agent.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/38.0.0')
    expect(currentPlatform()).toBe('mac')
  })

  it('markPlatform writes the system of the user agent on <html>', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38.0.0')
    markPlatform()
    expect(document.documentElement.dataset.platform).toBe('windows')
    markPlatform('linux')
    expect(document.documentElement.dataset.platform).toBe('linux')
  })
})

describe('the command palette', () => {
  const opened = (): boolean => screen.queryByTestId('command-palette') !== null

  it('on Windows opens on Ctrl+K and shows Ctrl+K on its button; ⌘K does nothing', () => {
    on('windows')
    render(<CommandPalette />)
    expect(screen.getByTestId('palette-trigger').querySelector('kbd')?.textContent).toBe('Ctrl+K')
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(opened()).toBe(false)
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, altKey: true })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, metaKey: true })
    expect(opened()).toBe(false)
    fireEvent.keyDown(document.body, { key: 'K', ctrlKey: true })
    expect(opened()).toBe(true)
  })

  // Review round 1 of PR #215: with a Russian layout the K key gives key 'л' and code 'KeyK'.
  it('on Windows opens on Ctrl+K with a Russian layout: by the place of the key, not its letter', () => {
    on('windows')
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: 'д', code: 'KeyL', ctrlKey: true })
    expect(opened()).toBe(false)
    // A key the input method is handling says Process, and names no letter.
    fireEvent.keyDown(document.body, { key: 'Process', code: 'KeyK', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'л', code: 'KeyK', ctrlKey: true, isComposing: true })
    expect(opened()).toBe(false)
    fireEvent.keyDown(document.body, { key: 'л', code: 'KeyK', ctrlKey: true })
    expect(opened()).toBe(true)
  })

  it('on Windows Ctrl+K with a Latin letter opens the palette also while the input method composes', () => {
    on('windows')
    render(<CommandPalette />)
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true })
    expect(opened()).toBe(true)
  })

  it('on Windows leaves Ctrl+K pressed inside a Terminal Node to the shell', () => {
    on('windows')
    render(<CommandPalette />)
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    terminalField().dispatchEvent(event)
    expect(opened()).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('on macOS opens on ⌘K, also from a Terminal Node, and shows ⌘K; Ctrl+K does nothing', () => {
    on('mac')
    render(<CommandPalette />)
    expect(screen.getByTestId('palette-trigger').querySelector('kbd')?.textContent).toBe('⌘K')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, metaKey: true })
    expect(opened()).toBe(false)
    fireEvent.keyDown(terminalField(), { key: 'k', metaKey: true })
    expect(opened()).toBe(true)
  })
})

describe('the hints of the composer', () => {
  it('name the Enter key by the system', () => {
    on('windows')
    expect(slashHint()).toBe('↑↓ navigate · Enter select · esc')
    expect(composerHint()).toBe('/ commands · Shift+Enter new line · ↑↓ history')
    on('mac')
    expect(slashHint()).toBe('↑↓ navigate · ⏎ select · esc')
    expect(composerHint()).toBe('/ commands · ⇧⏎ new line · ↑↓ history')
  })
})
