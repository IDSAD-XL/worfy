// The registry of keyboard shortcuts (src/shared/shortcuts.ts) and how the renderer reads it
// (src/renderer/shortcuts/match.ts): every entry has its own id, no two entries of one place share a
// key, each system gets its own label, and a key press matches an entry the way the handlers of
// worfy-windows ticket 11 matched it, the Terminal Node rule included. jsdom: the Terminal rule
// asks the DOM where the press happened, and the real xterm.js shows which keys of the app menu it
// keeps from the menu on Windows.
import { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { accelerator, menuKeys, SHORTCUT_GROUPS, SHORTCUT_LIST, SHORTCUTS, shortcutPlatformOf, type Shortcut } from '../../src/shared/shortcuts'
import { ariaKeys, availableOn, held, isTextTarget, label, matches, type ShortcutEvent } from '../../src/renderer/shortcuts/match'
import type { Platform } from '../../src/renderer/platform'

const PLATFORMS: readonly Platform[] = ['mac', 'windows', 'linux']

/** A key press as the handlers get it; `target` is <body> unless given. */
function press(init: Partial<ShortcutEvent> & { key: string }): ShortcutEvent {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: document.body, ...init }
}

/** The same press with the primary modifier of `platform`: ⌘ on macOS, Ctrl elsewhere. */
const primary = (platform: Platform, init: Partial<ShortcutEvent> & { key: string }): ShortcutEvent => press({ ...init, ...(platform === 'mac' ? { metaKey: true } : { ctrlKey: true }) })

/** An element inside the screen of a Terminal Node, as TerminalNode.tsx draws it. */
function insideTerminal(): HTMLElement {
  const node = document.createElement('div')
  node.className = 'w-node-surface w-terminal'
  const xterm = document.createElement('div')
  xterm.className = 'xterm'
  const textarea = document.createElement('textarea')
  xterm.append(textarea)
  node.append(xterm)
  document.body.append(node)
  return textarea
}

/** The keys of an entry as a set of strings, one per key it answers to. */
const keyStrings = (shortcut: Shortcut): string[] => {
  const { primary: p, shift, alt, key, also } = shortcut.keys
  return [key, ...(also ?? [])].map((each) => `${p === true}|${shift === true}|${alt === true}|${shortcut.pointer ?? ''}|${each.toLowerCase()}`)
}

describe('the registry', () => {
  it('gives every entry its own id, the id it is filed under, and a group of the window', () => {
    const ids = SHORTCUT_LIST.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [name, shortcut] of Object.entries(SHORTCUTS)) {
      expect(SHORTCUT_LIST).toContain(shortcut)
      expect(SHORTCUT_GROUPS, name).toContain(shortcut.group)
      expect(shortcut.title.trim(), name).not.toBe('')
    }
    expect(SHORTCUT_GROUPS).toEqual(['Window', 'Canvas', 'Focus mode', 'Find', 'Session', 'Terminal'])
  })

  it('has no two entries with the same keys in one place, and no entry of a place with the keys of an app-wide one', () => {
    for (const platform of PLATFORMS) {
      const shown = SHORTCUT_LIST.filter((shortcut) => availableOn(shortcut, platform))
      const seen = new Map<string, string>()
      for (const shortcut of shown) {
        for (const keys of keyStrings(shortcut)) {
          const here = `${shortcut.scope}|${keys}`
          expect(seen.get(here), `${shortcut.id} and ${seen.get(here)} on ${platform}`).toBeUndefined()
          seen.set(here, shortcut.id)
        }
      }
      for (const shortcut of shown.filter((each) => each.scope !== 'app')) {
        for (const keys of keyStrings(shortcut)) expect(seen.get(`app|${keys}`), `${shortcut.id} on ${platform}`).toBeUndefined()
      }
    }
  })

  it('writes the accelerators of the app menu with CmdOrCtrl', () => {
    expect(accelerator(SHORTCUTS.settings)).toBe('CmdOrCtrl+,')
    expect(accelerator(SHORTCUTS.toggleSidebar)).toBe('CmdOrCtrl+B')
    expect(accelerator(SHORTCUTS.shortcuts)).toBe('CmdOrCtrl+/')
    expect(accelerator(SHORTCUTS.scaleBigger)).toBe('CmdOrCtrl+Alt+=')
    expect(accelerator(SHORTCUTS.scaleSmaller)).toBe('CmdOrCtrl+Alt+-')
    expect(accelerator(SHORTCUTS.scaleActual)).toBe('CmdOrCtrl+Alt+0')
    expect(accelerator({ ...SHORTCUTS.undo, keys: { primary: true, shift: true, key: 'Z' } })).toBe('CmdOrCtrl+Shift+Z')
  })

  it('lets the menu take Cmd/Ctrl+/ on macOS only, and Cmd/Ctrl+B everywhere', () => {
    expect(shortcutPlatformOf('darwin')).toBe('mac')
    expect(shortcutPlatformOf('win32')).toBe('windows')
    expect(shortcutPlatformOf('linux')).toBe('linux')
    expect(menuKeys(SHORTCUTS.shortcuts, 'darwin')).toEqual({ accelerator: 'CmdOrCtrl+/' })
    expect(menuKeys(SHORTCUTS.shortcuts, 'win32')).toEqual({ accelerator: 'CmdOrCtrl+/', registerAccelerator: false })
    expect(menuKeys(SHORTCUTS.shortcuts, 'linux')).toEqual({ accelerator: 'CmdOrCtrl+/', registerAccelerator: false })
    for (const platform of ['darwin', 'win32', 'linux'] as const) expect(menuKeys(SHORTCUTS.toggleSidebar, platform)).toEqual({ accelerator: 'CmdOrCtrl+B' })
  })
})

describe('label', () => {
  it('writes the palette as ⌘K on macOS and Ctrl+K on Windows', () => {
    expect(label(SHORTCUTS.palette, 'windows')).toBe('Ctrl+K')
    expect(label(SHORTCUTS.palette, 'mac')).toBe('⌘K')
  })

  it('writes a new line as ⇧⏎ and Shift+Enter, the interface scale as ⌥⌘= and Ctrl+Alt+=', () => {
    expect(label(SHORTCUTS.newLine, 'mac')).toBe('⇧⏎')
    expect(label(SHORTCUTS.newLine, 'windows')).toBe('Shift+Enter')
    expect(label(SHORTCUTS.scaleBigger, 'mac')).toBe('⌥⌘=')
    expect(label(SHORTCUTS.scaleBigger, 'windows')).toBe('Ctrl+Alt+=')
  })

  it('keeps the labels the handlers showed before the registry', () => {
    expect(label(SHORTCUTS.focusEnter, 'mac')).toBe('⌘↩')
    expect(label(SHORTCUTS.focusEnter, 'windows')).toBe('Ctrl+Enter')
    expect(label(SHORTCUTS.find, 'mac')).toBe('⌘F')
    expect(label(SHORTCUTS.findPrevious, 'mac')).toBe('⇧Enter')
    expect(label(SHORTCUTS.findPrevious, 'windows')).toBe('Shift+Enter')
    expect(label(SHORTCUTS.findNext, 'mac')).toBe('Enter')
    expect(label(SHORTCUTS.slashSelect, 'mac')).toBe('⏎')
    expect(label(SHORTCUTS.slashSelect, 'windows')).toBe('Enter')
    expect(label(SHORTCUTS.toggleSidebar, 'windows')).toBe('Ctrl+B')
    expect(label(SHORTCUTS.focusExit, 'mac')).toBe('Esc')
    expect(label(SHORTCUTS.shortcutsKey, 'windows')).toBe('?')
    expect(label(SHORTCUTS.shortcuts, 'mac')).toBe('⌘/')
    expect(label(SHORTCUTS.dragFree, 'mac')).toBe('⌘ + drag')
    expect(label(SHORTCUTS.dragFree, 'windows')).toBe('Ctrl + drag')
    expect(label(SHORTCUTS.terminalRequest, 'mac')).toBe('⌘I')
    expect(label(SHORTCUTS.back, 'mac')).toBe('⌘[')
    expect(label(SHORTCUTS.back, 'windows')).toBe('Ctrl+[')
    expect(label(SHORTCUTS.back, 'linux')).toBe('Ctrl+[')
    expect(ariaKeys(SHORTCUTS.back, 'mac')).toBe('Meta+[')
    expect(ariaKeys(SHORTCUTS.back, 'windows')).toBe('Control+[')
  })

  it('takes the system from <html> when none is given', () => {
    document.documentElement.dataset.platform = 'windows'
    expect(label(SHORTCUTS.palette)).toBe('Ctrl+K')
    expect(ariaKeys(SHORTCUTS.focusEnter)).toBe('Control+Enter')
    document.documentElement.dataset.platform = 'mac'
    expect(label(SHORTCUTS.palette)).toBe('⌘K')
    expect(ariaKeys(SHORTCUTS.focusEnter)).toBe('Meta+Enter')
  })

  it('an entry of macOS alone has no label on Windows and is not offered there', () => {
    expect(SHORTCUTS.terminalRequest.platforms).toEqual(['mac'])
    expect(availableOn(SHORTCUTS.terminalRequest, 'mac')).toBe(true)
    expect(availableOn(SHORTCUTS.terminalRequest, 'windows')).toBe(false)
    expect(label(SHORTCUTS.terminalRequest, 'windows')).toBe('')
  })
})

describe('matches', () => {
  it.each(PLATFORMS)('on %s takes the primary modifier of the system and nothing else held', (platform) => {
    expect(matches(primary(platform, { key: 'k' }), SHORTCUTS.palette, platform)).toBe(true)
    expect(matches(primary(platform, { key: 'K', shiftKey: true }), SHORTCUTS.palette, platform)).toBe(false)
    expect(matches(primary(platform, { key: 'k', altKey: true }), SHORTCUTS.palette, platform)).toBe(false)
    expect(matches(press({ key: 'k' }), SHORTCUTS.palette, platform)).toBe(false)
    // The other modifier (Ctrl on macOS, the Windows key elsewhere) makes it another combination.
    const other = platform === 'mac' ? { ctrlKey: true } : { metaKey: true }
    expect(matches(press({ key: 'k', ...other }), SHORTCUTS.palette, platform)).toBe(false)
    expect(matches(primary(platform, { key: 'k', ...other }), SHORTCUTS.palette, platform)).toBe(false)
  })

  it('on macOS Ctrl+K is not the palette, on Windows ⌘K (the Windows key) is not', () => {
    expect(matches(press({ key: 'k', ctrlKey: true }), SHORTCUTS.palette, 'mac')).toBe(false)
    expect(matches(press({ key: 'k', metaKey: true }), SHORTCUTS.palette, 'windows')).toBe(false)
  })

  it('reads a letter by the place of its key in a layout that is not Latin', () => {
    expect(matches(primary('windows', { key: 'л', code: 'KeyK' }), SHORTCUTS.palette, 'windows')).toBe(true)
    expect(matches(primary('mac', { key: 'ш', code: 'KeyI' }), SHORTCUTS.terminalRequest, 'mac')).toBe(true)
  })

  it('takes ⌘[ / Ctrl+[ for Back by the character and, on a layout with a letter there, by the place of the key', () => {
    for (const platform of PLATFORMS) {
      expect(matches(primary(platform, { key: '[', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(true)
      // The Russian layout has the Cyrillic kha on the key of [.
      expect(matches(primary(platform, { key: 'х', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(true)
      expect(matches(primary(platform, { key: 'х', code: 'BracketLeft', altKey: true }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(primary(platform, { key: 'Х', code: 'BracketLeft', shiftKey: true }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(primary(platform, { key: 'х', code: 'BracketLeft', shiftKey: true }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(primary(platform, { key: '{', code: 'BracketLeft', shiftKey: true }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(press({ key: '[', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(press({ key: 'х', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(false)
    }
    // An accented Latin letter on the key of [ is read by the place too: German ü, Nordic å.
    for (const platform of PLATFORMS) {
      expect(matches(primary(platform, { key: 'ü', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(true)
      expect(matches(primary(platform, { key: 'å', code: 'BracketLeft' }), SHORTCUTS.back, platform)).toBe(true)
      expect(matches(primary(platform, { key: 'Ü', code: 'BracketLeft', shiftKey: true }), SHORTCUTS.back, platform)).toBe(false)
      expect(matches(primary(platform, { key: 'ü', code: 'BracketLeft', altKey: true }), SHORTCUTS.back, platform)).toBe(false)
    }
    // A letter a–z there stays the letter (BÉPO has z on the key of [), and another letter on another key is no [.
    expect(matches(primary('mac', { key: 'z', code: 'BracketLeft' }), SHORTCUTS.back, 'mac')).toBe(false)
    expect(matches(primary('mac', { key: 'z', code: 'BracketLeft' }), SHORTCUTS.undo, 'mac')).toBe(true)
    expect(matches(primary('mac', { key: 'ъ', code: 'BracketRight' }), SHORTCUTS.back, 'mac')).toBe(false)
    expect(matches(primary('mac', { key: 'ü', code: 'BracketRight' }), SHORTCUTS.back, 'mac')).toBe(false)
    // While the input method composes, the key is not read by its place.
    expect(matches(primary('mac', { key: 'х', code: 'BracketLeft', isComposing: true }), SHORTCUTS.back, 'mac')).toBe(false)
  })

  it('tells undo from redo by Shift, and Shift is part of the character for punctuation', () => {
    for (const platform of PLATFORMS) {
      expect(matches(primary(platform, { key: 'z' }), SHORTCUTS.undo, platform)).toBe(true)
      expect(matches(primary(platform, { key: 'z' }), SHORTCUTS.redo, platform)).toBe(false)
      expect(matches(primary(platform, { key: 'Z', shiftKey: true }), SHORTCUTS.redo, platform)).toBe(true)
      expect(matches(primary(platform, { key: 'Z', shiftKey: true }), SHORTCUTS.undo, platform)).toBe(false)
      // ⌘+ is Shift and = on a US keyboard: either zooms in.
      expect(matches(primary(platform, { key: '=' }), SHORTCUTS.canvasZoomIn, platform)).toBe(true)
      expect(matches(primary(platform, { key: '+', shiftKey: true }), SHORTCUTS.canvasZoomIn, platform)).toBe(true)
      expect(matches(primary(platform, { key: '-' }), SHORTCUTS.canvasZoomOut, platform)).toBe(true)
      expect(matches(primary(platform, { key: '=', altKey: true }), SHORTCUTS.canvasZoomIn, platform)).toBe(false)
    }
    expect(matches(press({ key: '?', shiftKey: true }), SHORTCUTS.shortcutsKey, 'mac')).toBe(true)
    expect(matches(press({ key: '?' }), SHORTCUTS.shortcutsKey, 'windows')).toBe(true)
    expect(matches(primary('mac', { key: '?', shiftKey: true }), SHORTCUTS.shortcutsKey, 'mac')).toBe(false)
  })

  it('takes Delete and Backspace without modifiers, and Enter with Shift only for the entry that has it', () => {
    expect(matches(press({ key: 'Backspace' }), SHORTCUTS.deleteSelection, 'mac')).toBe(true)
    expect(matches(press({ key: 'Delete' }), SHORTCUTS.deleteSelection, 'windows')).toBe(true)
    expect(matches(press({ key: 'Backspace', shiftKey: true }), SHORTCUTS.deleteSelection, 'mac')).toBe(false)
    expect(matches(primary('mac', { key: 'Backspace' }), SHORTCUTS.deleteSelection, 'mac')).toBe(false)
    expect(matches(primary('mac', { key: 'Enter' }), SHORTCUTS.focusEnter, 'mac')).toBe(true)
    expect(matches(primary('mac', { key: 'Enter', shiftKey: true }), SHORTCUTS.focusEnter, 'mac')).toBe(false)
  })

  it('on Windows an entry with the primary modifier does not match inside a Terminal Node: the key is the shell’s', () => {
    const target = insideTerminal()
    try {
      expect(matches(primary('windows', { key: 'k', target }), SHORTCUTS.palette, 'windows')).toBe(false)
      expect(matches(primary('windows', { key: 'f', target }), SHORTCUTS.find, 'windows')).toBe(false)
      expect(matches(primary('windows', { key: 'Enter', target }), SHORTCUTS.focusEnter, 'windows')).toBe(false)
      expect(matches(primary('linux', { key: 'k', target }), SHORTCUTS.palette, 'linux')).toBe(false)
      // On macOS the shell's keys are on Ctrl: ⌘K in the terminal is still the palette.
      expect(matches(primary('mac', { key: 'k', target }), SHORTCUTS.palette, 'mac')).toBe(true)
      // Outside the terminal Ctrl+K is the palette again.
      expect(matches(primary('windows', { key: 'k' }), SHORTCUTS.palette, 'windows')).toBe(true)
      // The zoom of the Canvas keeps the exception of worfy-windows 11: only Ctrl+_ is the shell's (readline undo).
      expect(matches(primary('windows', { key: '=', target }), SHORTCUTS.canvasZoomIn, 'windows')).toBe(true)
      expect(matches(primary('windows', { key: '-', target }), SHORTCUTS.canvasZoomOut, 'windows')).toBe(true)
      expect(matches(primary('windows', { key: '_', shiftKey: true, target }), SHORTCUTS.canvasZoomOut, 'windows')).toBe(false)
      expect(matches(primary('windows', { key: '_', shiftKey: true }), SHORTCUTS.canvasZoomOut, 'windows')).toBe(true)
      expect(matches(primary('mac', { key: '_', shiftKey: true, target }), SHORTCUTS.canvasZoomOut, 'mac')).toBe(true)
    } finally {
      target.closest('.w-terminal')?.remove()
    }
  })

  it('an entry of macOS alone never matches on Windows', () => {
    expect(matches(primary('windows', { key: 'i', code: 'KeyI' }), SHORTCUTS.terminalRequest, 'windows')).toBe(false)
    expect(matches(press({ key: 'i', code: 'KeyI', metaKey: true }), SHORTCUTS.terminalRequest, 'windows')).toBe(false)
    expect(matches(primary('mac', { key: 'i', code: 'KeyI' }), SHORTCUTS.terminalRequest, 'mac')).toBe(true)
  })

  it('AltGr on Windows types a character and is no shortcut', () => {
    const altGr = press({ key: '/', ctrlKey: true, altKey: true, getModifierState: (key: string) => key === 'AltGraph' })
    expect(matches(altGr, SHORTCUTS.shortcuts, 'windows')).toBe(false)
    expect(matches({ ...altGr, key: '?' }, SHORTCUTS.shortcutsKey, 'windows')).toBe(false)
  })

  it('a drag entry is held, never pressed', () => {
    expect(matches(primary('mac', { key: 'drag' }), SHORTCUTS.dragFree, 'mac')).toBe(false)
    expect(held(primary('mac', { key: '' }), SHORTCUTS.dragFree, 'mac')).toBe(true)
    expect(held(primary('windows', { key: '' }), SHORTCUTS.dragFree, 'windows')).toBe(true)
    expect(held(press({ key: '', ctrlKey: true }), SHORTCUTS.dragFree, 'mac')).toBe(false)
    expect(held(press({ key: '', metaKey: true }), SHORTCUTS.dragFree, 'windows')).toBe(false)
  })
})

describe('isTextTarget', () => {
  it('is true in a field, a text area, a select and inside editable text, false elsewhere', () => {
    const field = document.createElement('input')
    const area = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inside = document.createElement('span')
    editable.append(inside)
    const plain = document.createElement('div')
    document.body.append(field, area, select, editable, plain)
    try {
      expect(isTextTarget(field)).toBe(true)
      expect(isTextTarget(area)).toBe(true)
      expect(isTextTarget(select)).toBe(true)
      expect(isTextTarget(inside)).toBe(true)
      expect(isTextTarget(plain)).toBe(false)
      expect(isTextTarget(document.body)).toBe(false)
      expect(isTextTarget(null)).toBe(false)
    } finally {
      for (const each of [field, area, select, editable, plain]) each.remove()
    }
  })
})

// Electron hands an accelerator of the app menu only the key presses the page did not cancel
// (the page sees a key first on Windows and Linux). Which of Ctrl+B and Ctrl+/ a Terminal Node keeps
// from the menu therefore depends on xterm.js: Help ▸ Keyboard Shortcuts registers no accelerator
// outside macOS (src/main/menu.ts) because of the answer below.
describe('xterm.js and the keys of the app menu outside macOS', () => {
  /** Presses a key in a real xterm.js (navigator.platform of jsdom is not a Mac); true when it was cancelled. */
  function pressInXterm(init: KeyboardEventInit): boolean {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
    if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const host = document.createElement('div')
    document.body.append(host)
    const terminal = new Terminal()
    try {
      terminal.open(host)
      const field = host.querySelector('textarea')
      if (field === null) throw new Error('xterm.js drew no textarea')
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      field.dispatchEvent(event)
      return event.defaultPrevented
    } finally {
      terminal.dispose()
      host.remove()
      vi.unstubAllGlobals()
    }
  }

  it('cancels Ctrl+B (it sends ^B to the shell), with a Russian layout too: View ▸ Toggle Sidebar never gets it there', () => {
    expect(navigator.platform).not.toMatch(/Mac/)
    expect(pressInXterm({ key: 'b', code: 'KeyB', keyCode: 66, ctrlKey: true })).toBe(true)
    expect(pressInXterm({ key: 'и', code: 'KeyB', keyCode: 66, ctrlKey: true })).toBe(true)
  })

  it('lets Ctrl+/ through: a menu accelerator would take it from the terminal, so the renderer catches it instead', () => {
    expect(pressInXterm({ key: '/', code: 'Slash', keyCode: 191, ctrlKey: true })).toBe(false)
    expect(menuKeys(SHORTCUTS.shortcuts, 'win32')).toMatchObject({ registerAccelerator: false })
    expect(matches(primary('windows', { key: '/', target: insideTerminal() }), SHORTCUTS.shortcuts, 'windows')).toBe(false)
    document.querySelector('.w-terminal')?.remove()
  })
})
