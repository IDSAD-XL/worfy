// Settings → Shortcuts: the list of the Keyboard shortcuts window (shortcuts/ShortcutsOverlay.tsx),
// every entry of the registry this system has, with the keys as this system writes them.
import { ShortcutList } from '../shortcuts/ShortcutsOverlay'
import type { SettingsGroup, SettingsIconName } from './sections'

export const order = 30
export const title = 'Shortcuts'
export const group: SettingsGroup = 'App'
export const icon: SettingsIconName = 'keyboard'

export default function ShortcutsSection() {
  return <ShortcutList />
}
