// The system the window runs on, for what differs by it in the renderer: which key is the primary
// modifier (⌘ on macOS, Ctrl on Windows and Linux), how a key combination is written, and the
// window frame the styles draw for (worfy-windows ticket 11). The renderer learns the system from
// the user agent: no IPC channel and nothing new in the preload (ADR-0006).
//
// src/renderer/main.tsx writes the system on <html> as `data-platform` before the first render;
// the styles select by it (shell.css, focus.css) and currentPlatform() reads it back, so a test
// sets the system there. Every function also takes the system as a parameter.

export type Platform = 'mac' | 'windows' | 'linux'

const PLATFORMS: readonly Platform[] = ['mac', 'windows', 'linux']

/**
 * What this module reads of the page, spelled out instead of taken from the DOM types: its tests run
 * in Node too, where neither exists (tsconfig.test.node.json).
 */
const page = globalThis as { document?: { documentElement: { dataset: Record<string, string | undefined> } }; navigator?: { userAgent: string } }

/** The system a user agent names: Electron's says `Macintosh; Intel Mac OS X`, `Windows NT` or `X11; Linux`. */
export function platformOf(userAgent: string): Platform {
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac'
  if (/Windows/.test(userAgent)) return 'windows'
  return 'linux'
}

/** The system of this window: `data-platform` of <html> when it is set, else by the user agent. */
export function currentPlatform(): Platform {
  const marked = page.document?.documentElement.dataset.platform
  if (PLATFORMS.includes(marked as Platform)) return marked as Platform
  return platformOf(page.navigator?.userAgent ?? '')
}

/** Writes the system on <html> as `data-platform`, by the user agent unless one is given. */
export function markPlatform(platform: Platform = platformOf(page.navigator?.userAgent ?? '')): void {
  if (page.document) page.document.documentElement.dataset.platform = platform
}

export function isMac(platform: Platform = currentPlatform()): boolean {
  return platform === 'mac'
}

/** The modifier keys of a keyboard or mouse event. */
export interface Modifiers {
  metaKey: boolean
  ctrlKey: boolean
  /** As KeyboardEvent and MouseEvent have it; asked for `AltGraph` only. */
  getModifierState?: (key: string) => boolean
}

/**
 * The primary modifier is held and the other one is not: ⌘ without Ctrl on macOS, Ctrl without ⌘
 * elsewhere. On Windows the AltGr key arrives as Ctrl+Alt with the AltGraph state on; it types a
 * character (`@` on a German keyboard is AltGr+Q) and is no shortcut. Ctrl+Alt pressed as two keys
 * has no AltGraph state and stays a combination with the primary modifier.
 */
export function isPrimary(event: Modifiers, platform: Platform = currentPlatform()): boolean {
  if (isMac(platform)) return event.metaKey && !event.ctrlKey
  return event.ctrlKey && !event.metaKey && event.getModifierState?.('AltGraph') !== true
}

/** The modifier that is not the primary one is held: Ctrl on macOS, ⌘ (the Windows key) elsewhere. */
export function isOtherModifier(event: Modifiers, platform: Platform = currentPlatform()): boolean {
  return isMac(platform) ? event.ctrlKey : event.metaKey
}

/**
 * Whether a key press belongs to the shell of a Terminal Node and not to worfy: outside macOS, a
 * press inside the terminal (`.xterm`), where Ctrl+K, Ctrl+F and Ctrl+C are the shell's own keys.
 * On macOS the shell's keys are on Ctrl and worfy's on ⌘, so nothing is given up there.
 */
export function isTerminalKey(event: { target: unknown }, platform: Platform = currentPlatform()): boolean {
  if (isMac(platform)) return false
  const target = event.target as { closest?: (selector: string) => unknown } | null
  return typeof target?.closest === 'function' && target.closest('.xterm') != null
}

/**
 * The key a shortcut is matched by. A Latin letter is taken from the key cap (`event.key`), in lower
 * case, so a shortcut follows the letter on QWERTZ, AZERTY and Dvorak. With a layout that is not
 * Latin the key cap says `л` where the shortcut says K — on Windows also while Ctrl is held — so
 * there the letter comes from the place of the key (`event.code`, `KeyK`). Only a single letter of
 * another script is read by its place. Everything else is `event.key` as it is: punctuation and
 * accented letters of a Latin layout (Dvorak has `;` and BÉPO `à` where QWERTY has Z), the values
 * that name no character (`Process`, `Dead`, `Unidentified`), and any key while the input method
 * composes.
 */
export function shortcutKey(event: { key: string; code?: string; isComposing?: boolean }): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase()
  if (event.isComposing === true || !/^\p{L}$/u.test(event.key) || /^\p{Script=Latin}$/u.test(event.key)) return event.key
  const place = /^Key([A-Z])$/.exec(event.code ?? '')
  return place ? place[1]!.toLowerCase() : event.key
}

/**
 * A key combination, written without the system: `primary` is ⌘ on macOS and Ctrl elsewhere.
 * `key` is the name of the key as KeyboardEvent.key has it (`K`, `Enter`, `=`).
 */
export interface KeyCombo {
  primary?: boolean
  shift?: boolean
  alt?: boolean
  key: string
  /** How the key is drawn on macOS when not by MAC_KEYS: `↩` in ⌘↩, `Enter` in ⇧Enter. */
  macKey?: string
}

/** Keys macOS draws with a glyph; any other key is written by its name. */
const MAC_KEYS: Record<string, string> = { Enter: '⏎' }

const keyName = (key: string): string => (key.length === 1 ? key.toUpperCase() : key)

/**
 * How the combination is written for the user: `⌘K`, `⇧⏎`, `⌥⌘=` on macOS — modifiers in Apple's
 * order, no separator — and `Ctrl+K`, `Shift+Enter`, `Ctrl+Alt+=` elsewhere.
 */
export function label(combo: KeyCombo, platform: Platform = currentPlatform()): string {
  if (isMac(platform)) {
    const key = combo.macKey ?? MAC_KEYS[combo.key] ?? keyName(combo.key)
    return `${combo.alt ? '⌥' : ''}${combo.shift ? '⇧' : ''}${combo.primary ? '⌘' : ''}${key}`
  }
  return [...(combo.primary ? ['Ctrl'] : []), ...(combo.alt ? ['Alt'] : []), ...(combo.shift ? ['Shift'] : []), keyName(combo.key)].join('+')
}

/** The combination as `aria-keyshortcuts` wants it: `Meta+Enter` on macOS, `Control+Enter` elsewhere. */
export function ariaKeyShortcuts(combo: KeyCombo, platform: Platform = currentPlatform()): string {
  return [...(combo.primary ? [isMac(platform) ? 'Meta' : 'Control'] : []), ...(combo.alt ? ['Alt'] : []), ...(combo.shift ? ['Shift'] : []), keyName(combo.key)].join('+')
}
