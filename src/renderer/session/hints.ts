// The key hints of the input field, written for the system the window runs on (worfy-windows
// ticket 11): ⏎ and ⇧⏎ on macOS, Enter and Shift+Enter on Windows. The keys come from the registry
// of shortcuts (src/shared/shortcuts.ts), as the Keyboard shortcuts window shows them.
import { SHORTCUTS } from '../../shared/shortcuts'
import type { Platform } from '../platform'
import { label } from '../shortcuts/match'

/** The hint under the field (MessageInput.tsx). */
export const composerHint = (platform?: Platform): string => `/ commands · ${label(SHORTCUTS.newLine, platform)} new line · ${label(SHORTCUTS.history, platform)} history`

/** The hint in the head of the slash menu (SlashMenu.tsx). */
export const slashHint = (platform?: Platform): string => `↑↓ navigate · ${label(SHORTCUTS.slashSelect, platform)} select · esc`
