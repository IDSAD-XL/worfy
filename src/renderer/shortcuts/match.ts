// How the renderer reads the registry of shortcuts (src/shared/shortcuts.ts): whether a key press is
// an entry's, how an entry is written for the system the window runs on, and where a press belongs
// to something else — a text field, the shell of a Terminal Node. Over src/renderer/platform.ts
// (worfy-windows ticket 11), which knows the system, the primary modifier and the key of a press.
import type { Shortcut } from '../../shared/shortcuts'
import { ariaKeyShortcuts, currentPlatform, isOtherModifier, isPrimary, isTerminalKey, label as comboLabel, shortcutKey, type Modifiers, type Platform } from '../platform'

/** What matching reads of a key press: KeyboardEvent has it all. */
export interface ShortcutEvent extends Modifiers {
  key: string
  code?: string
  isComposing?: boolean
  altKey: boolean
  shiftKey: boolean
  target: unknown
}

/** Whether the entry exists on `platform`: an entry of macOS alone is neither matched nor shown elsewhere. */
export function availableOn(shortcut: Shortcut, platform: Platform = currentPlatform()): boolean {
  return shortcut.platforms === undefined || shortcut.platforms.includes(platform)
}

/**
 * Whether the renderer catches the entry's key on `platform` because the app menu shows it there
 * without taking it (`rendererCatchesOn`; src/main/menu.ts).
 */
export function rendererCatches(shortcut: Shortcut, platform: Platform = currentPlatform()): boolean {
  return shortcut.rendererCatchesOn?.includes(platform) === true
}

const keysOf = (shortcut: Shortcut): readonly string[] => [shortcut.keys.key, ...(shortcut.keys.also ?? [])]

/**
 * Whether Shift is part of the combination for `key`, pressed as `pressed` (KeyboardEvent.key): for
 * letters and named keys (`Enter`) it is; for punctuation Shift only picks the character, and which
 * one depends on the layout (`?` is Shift and / on a US keyboard, Shift and , on a German one), so
 * the character alone decides. Punctuation read by the place of a letter (the Cyrillic kha on the key of `[`)
 * counts Shift as the letter does: Shift there only changes the letter's case.
 */
const shiftCounts = (key: string, pressed: string): boolean => key.length > 1 || /^\p{L}$/u.test(key) || /^\p{L}$/u.test(pressed)

/**
 * Whether the key press is the entry's on `platform`: the primary modifier exactly when the entry
 * has it, never the other modifier (Ctrl on macOS, the Windows key elsewhere), Alt and Shift as the
 * entry has them, and the key by shortcutKey — the letter of a Latin layout, the place of the key
 * in another one (the Cyrillic kha on the key of `[` is `[`).
 *
 * The rule of the Terminal Node (worfy-windows ticket 11), one for every entry: on Windows and
 * Linux an entry with the primary modifier does not match a press inside a terminal, where Ctrl
 * and a letter are the shell's; an entry names the keys it gives up in `shellKeeps` when not all.
 * On macOS the shell's keys are on Ctrl and worfy's on ⌘, so nothing is given up there.
 */
export function matches(event: ShortcutEvent, shortcut: Shortcut, platform: Platform = currentPlatform()): boolean {
  if (shortcut.pointer !== undefined || !availableOn(shortcut, platform)) return false
  const { keys } = shortcut
  if (isOtherModifier(event, platform) || (keys.primary === true) !== isPrimary(event, platform) || (keys.alt === true) !== event.altKey) return false
  const pressed = shortcutKey(event).toLowerCase()
  const key = keysOf(shortcut).find((each) => each.toLowerCase() === pressed)
  if (key === undefined) return false
  if (shiftCounts(key, event.key) && (keys.shift === true) !== event.shiftKey) return false
  if (keys.primary === true && isTerminalKey(event, platform) && (shortcut.shellKeeps ?? keysOf(shortcut)).includes(key)) return false
  return true
}

/** Whether the modifiers of a pointer entry (`⌘ + drag`) are held during a mouse event or a drag. */
export function held(event: Modifiers & { altKey?: boolean; shiftKey?: boolean }, shortcut: Shortcut, platform: Platform = currentPlatform()): boolean {
  const { keys } = shortcut
  if (!availableOn(shortcut, platform)) return false
  if (keys.primary === true && !isPrimary(event, platform)) return false
  if (keys.alt === true && event.altKey !== true) return false
  return keys.shift !== true || event.shiftKey === true
}

/**
 * The entry as the user reads it on `platform`: `⌘K`, `⇧⏎`, `⌥⌘=` on macOS, `Ctrl+K`, `Shift+Enter`,
 * `Ctrl+Alt+=` elsewhere; `⌘ + drag` for a pointer entry. Empty for an entry the system does not have.
 */
export function label(shortcut: Shortcut, platform: Platform = currentPlatform()): string {
  if (!availableOn(shortcut, platform)) return ''
  const { keys } = shortcut
  if (shortcut.pointer !== undefined) return `${comboLabel({ ...keys, key: '' }, platform).replace(/\+$/, '')} + ${shortcut.pointer}`
  return comboLabel(keys.name === undefined ? keys : { ...keys, key: keys.name, macKey: keys.macKey ?? keys.name }, platform)
}

/** The entry as `aria-keyshortcuts` wants it: `Meta+Enter` on macOS, `Control+Enter` elsewhere. */
export function ariaKeys(shortcut: Shortcut, platform: Platform = currentPlatform()): string {
  return ariaKeyShortcuts(shortcut.keys, platform)
}

/** True while the element is a place to type: there the keys of the Canvas belong to the text. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}

/** True inside a Terminal Node: its screen, its header, or the Node of the Canvas around it. */
export function isInTerminalNode(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.w-terminal, .react-flow__node-terminal, .xterm') !== null
}
