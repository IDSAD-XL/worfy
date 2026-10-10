// src/renderer/platform.ts (worfy-windows ticket 11): the primary modifier and how a key combination
// is written, by system. The system is a parameter, so both branches run on any machine. What reads
// <html data-platform> is in test/unit/platform-shortcuts.test.tsx (jsdom).
import { describe, expect, it } from 'vitest'
import { ariaKeyShortcuts, currentPlatform, isMac, isOtherModifier, isPrimary, isTerminalKey, label, platformOf, shortcutKey, type Platform } from '../../src/renderer/platform'

const keys = (metaKey: boolean, ctrlKey: boolean) => ({ metaKey, ctrlKey })
const OTHERS: Platform[] = ['windows', 'linux']

describe('platformOf', () => {
  it('reads the system from the user agent of Electron', () => {
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) worfy/0.2.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36')).toBe('mac')
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) worfy/0.2.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36')).toBe('windows')
    expect(platformOf('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) worfy/0.2.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36')).toBe('linux')
    expect(platformOf('')).toBe('linux')
  })

  it('without a document answers by the user agent alone', () => {
    // This file runs in Node: no document, and a navigator (if any) that names no system.
    expect('document' in globalThis).toBe(false)
    expect(currentPlatform()).toBe('linux')
  })

  it('isMac is true on macOS only', () => {
    expect(isMac('mac')).toBe(true)
    expect(isMac('windows')).toBe(false)
    expect(isMac('linux')).toBe(false)
  })
})

describe('isPrimary and isOtherModifier', () => {
  it('on macOS the primary modifier is ⌘ without Ctrl, and the other one is Ctrl', () => {
    expect(isPrimary(keys(true, false), 'mac')).toBe(true)
    expect(isPrimary(keys(false, true), 'mac')).toBe(false)
    expect(isPrimary(keys(true, true), 'mac')).toBe(false)
    expect(isPrimary(keys(false, false), 'mac')).toBe(false)
    expect(isOtherModifier(keys(false, true), 'mac')).toBe(true)
    expect(isOtherModifier(keys(true, false), 'mac')).toBe(false)
  })

  it.each(OTHERS)('on %s the primary modifier is Ctrl without ⌘, and the other one is ⌘', (platform) => {
    expect(isPrimary(keys(false, true), platform)).toBe(true)
    expect(isPrimary(keys(true, false), platform)).toBe(false)
    expect(isPrimary(keys(true, true), platform)).toBe(false)
    expect(isPrimary(keys(false, false), platform)).toBe(false)
    expect(isOtherModifier(keys(true, false), platform)).toBe(true)
    expect(isOtherModifier(keys(false, true), platform)).toBe(false)
  })

  // On Windows the AltGr key arrives as Ctrl+Alt with the AltGraph state on. It types a character
  // (`@` on a German keyboard is AltGr+Q) and is no shortcut; Ctrl+Alt pressed as two keys is one.
  it.each(OTHERS)('on %s AltGr is not the primary modifier, and Ctrl+Alt pressed as two keys is', (platform) => {
    const altGr = { ...keys(false, true), getModifierState: (key: string) => key === 'AltGraph' }
    const ctrlAlt = { ...keys(false, true), getModifierState: () => false }
    expect(isPrimary(altGr, platform)).toBe(false)
    expect(isPrimary(ctrlAlt, platform)).toBe(true)
  })

  it('on macOS the AltGraph state changes nothing', () => {
    expect(isPrimary({ ...keys(true, false), getModifierState: (key: string) => key === 'AltGraph' }, 'mac')).toBe(true)
  })
})

// Review round 1 of PR #215: with a Russian layout the K key gives key 'л' and code 'KeyK'.
describe('shortcutKey', () => {
  it('is the letter of the key cap when the layout is Latin, whatever the place of the key', () => {
    expect(shortcutKey({ key: 'k', code: 'KeyK' })).toBe('k')
    expect(shortcutKey({ key: 'K', code: 'KeyK' })).toBe('k')
    // QWERTZ: the key that says Z is where QWERTY has Y, and the one that says Y is where Z is.
    expect(shortcutKey({ key: 'z', code: 'KeyY' })).toBe('z')
    expect(shortcutKey({ key: 'y', code: 'KeyZ' })).toBe('y')
  })

  it('is the Latin letter of the key place when the layout is not Latin', () => {
    expect(shortcutKey({ key: 'л', code: 'KeyK' })).toBe('k')
    expect(shortcutKey({ key: 'А', code: 'KeyF' })).toBe('f')
    expect(shortcutKey({ key: 'я', code: 'KeyZ' })).toBe('z')
    expect(shortcutKey({ key: 'ω', code: 'KeyV' })).toBe('v')
  })

  it('is the key itself for anything that is not a letter key, and without a code', () => {
    expect(shortcutKey({ key: 'Enter', code: 'Enter' })).toBe('Enter')
    expect(shortcutKey({ key: '=', code: 'Equal' })).toBe('=')
    expect(shortcutKey({ key: 'ё', code: 'Backquote' })).toBe('ё')
    expect(shortcutKey({ key: 'л' })).toBe('л')
    expect(shortcutKey({ key: 'л', code: '' })).toBe('л')
  })
})

describe('label and ariaKeyShortcuts', () => {
  it.each([
    [{ primary: true, key: 'k' }, '⌘K', 'Ctrl+K'],
    [{ primary: true, key: 'F' }, '⌘F', 'Ctrl+F'],
    [{ primary: true, key: 'Enter', macKey: '↩' }, '⌘↩', 'Ctrl+Enter'],
    [{ shift: true, key: 'Enter' }, '⇧⏎', 'Shift+Enter'],
    [{ shift: true, key: 'Enter', macKey: 'Enter' }, '⇧Enter', 'Shift+Enter'],
    [{ key: 'Enter' }, '⏎', 'Enter'],
    [{ primary: true, shift: true, key: 'z' }, '⇧⌘Z', 'Ctrl+Shift+Z'],
    [{ primary: true, alt: true, key: '=' }, '⌥⌘=', 'Ctrl+Alt+='],
    [{ primary: true, alt: true, shift: true, key: 'z' }, '⌥⇧⌘Z', 'Ctrl+Alt+Shift+Z'],
  ])('%o is %s on macOS and %s on Windows', (combo, mac, windows) => {
    expect(label(combo, 'mac')).toBe(mac)
    expect(label(combo, 'windows')).toBe(windows)
    expect(label(combo, 'linux')).toBe(windows)
  })

  it('aria-keyshortcuts names the primary modifier Meta on macOS and Control elsewhere', () => {
    const combo = { primary: true, key: 'Enter', macKey: '↩' }
    expect(ariaKeyShortcuts(combo, 'mac')).toBe('Meta+Enter')
    expect(ariaKeyShortcuts(combo, 'windows')).toBe('Control+Enter')
    expect(ariaKeyShortcuts({ primary: true, shift: true, alt: true, key: 'z' }, 'linux')).toBe('Control+Alt+Shift+Z')
    expect(ariaKeyShortcuts({ key: 'Escape' }, 'mac')).toBe('Escape')
  })
})

describe('isTerminalKey', () => {
  const inside = { closest: (selector: string) => (selector === '.xterm' ? {} : null) }
  const outside = { closest: () => null }

  it('outside macOS gives a press inside a Terminal Node to its shell', () => {
    for (const platform of OTHERS) {
      expect(isTerminalKey({ target: inside }, platform)).toBe(true)
      expect(isTerminalKey({ target: outside }, platform)).toBe(false)
      expect(isTerminalKey({ target: null }, platform)).toBe(false)
      // window and document have no closest().
      expect(isTerminalKey({ target: {} }, platform)).toBe(false)
    }
  })

  it('on macOS gives up nothing: ⌘K and ⌘F work from a Terminal Node', () => {
    expect(isTerminalKey({ target: inside }, 'mac')).toBe(false)
  })
})
