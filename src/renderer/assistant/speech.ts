// The Assistant's own notifications in the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): a speech card
// next to the Assistant's icon on the rail, at the left edge of the window — apart from worfy's toasts, which stand at the
// right edge, up to three. One card at a time; the rest is the number on the icon and the list in its section.
import type { AssistantView, WindowItem } from '../../shared/assistant/window'
import type { RailBadge } from '../shell/sidebar-scope'

/**
 * The items the cards tell of, in turn: what came and the user has not seen (state `new`), urgent first, without the ones
 * the user closed. Nothing while the Assistant is off, or while its section is in front of the user: the list is there.
 */
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean): WindowItem[] {
  if (view === null || !view.on || sectionShown) return []
  return view.items.filter((item) => item.state === 'new' && !closed.has(item.id))
}

/**
 * The badge of the Assistant's rail button: while a card speaks, how many more wait behind it («+2»); without a card, how
 * many items wait. None while the Assistant is off, or nothing waits.
 */
export function assistantBadge(view: AssistantView | null, queue: readonly WindowItem[]): RailBadge | undefined {
  if (view === null || !view.on) return undefined
  if (queue.length > 0) {
    const more = queue.length - 1
    return more > 0 ? { tone: 'assistant', count: more, label: `${more} more from Assistant` } : undefined
  }
  const waiting = view.items.length
  return waiting > 0 ? { tone: 'assistant', count: waiting, label: waiting === 1 ? '1 item waits for you' : `${waiting} items wait for you` } : undefined
}
