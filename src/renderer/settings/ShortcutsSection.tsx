// Settings → Shortcuts: the list of the Keyboard shortcuts window (shortcuts/ShortcutsOverlay.tsx),
// every entry of the registry this system has, with the keys as this system writes them.
import { ShortcutList } from '../shortcuts/ShortcutsOverlay'

export const order = 30
export const title = 'Shortcuts'

export default function ShortcutsSection() {
  return <ShortcutList />
}
