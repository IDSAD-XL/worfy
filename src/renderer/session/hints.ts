// The key hints of the input field, written for the system the window runs on (worfy-windows
// ticket 11): ⏎ and ⇧⏎ on macOS, Enter and Shift+Enter on Windows.
import { label, type Platform } from '../platform'

/** The hint under the field (MessageInput.tsx). */
export const composerHint = (platform?: Platform): string => `/ commands · ${label({ shift: true, key: 'Enter' }, platform)} new line · ↑↓ history`

/** The hint in the head of the slash menu (SlashMenu.tsx). */
export const slashHint = (platform?: Platform): string => `↑↓ navigate · ${label({ key: 'Enter' }, platform)} select · esc`
