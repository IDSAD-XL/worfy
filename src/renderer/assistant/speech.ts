// The Assistant's own notifications in the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): a speech card
// next to the Assistant's icon on the rail, at the left edge of the window — apart from worfy's toasts, which stand at the
// right edge, up to three. One card at a time; the rest is the number on the icon and the list in its section.
//
// Close closes the card as a whole (worfy-polish 161, the owner's report: closing one item showed the next of 56): the
// items it would tell of then count as told by the card (main keeps it, `cardSeen`), and the card speaks again only of
// what comes after. Until the first Close the card sums the backlog up in one line instead of telling of its oldest item,
// unless an urgent item waits: that one is told of.
import type { InWindowNotices } from '../../shared/assistant/settings'
import type { AssistantView, WindowItem } from '../../shared/assistant/window'
import type { RailBadge } from '../shell/sidebar-scope'

/**
 * The items the cards tell of, in turn: what came and the user has not seen (state `new`), urgent first, without the ones
 * the card already told of (`cardSeen`) and the ones this window stopped telling of while main's view catches up. Nothing while the Assistant is off, or while its section is in front of the user: the list is there.
 * `inWindow` is the user's choice (Settings → Assistant, ticket 25): `urgent` keeps the urgent items only, `none` tells
 * of nothing — the number on the icon and the list stay (assistantBadge).
 */
export function speechQueue(view: AssistantView | null, closed: ReadonlySet<string>, sectionShown: boolean, inWindow: InWindowNotices = 'batched'): WindowItem[] {
  if (view === null || !view.on || sectionShown || inWindow === 'none') return []
  return view.items.filter((item) => item.state === 'new' && item.cardSeen !== true && !closed.has(item.id) && (inWindow === 'batched' || item.urgent))
}

/** What the card shows: the first item of the queue and how many more, or, while the card was never closed, one line of the backlog. */
export type SpeechCard = { kind: 'item'; item: WindowItem; more: number } | { kind: 'backlog'; count: number }

export function speechCard(view: AssistantView | null, queue: readonly WindowItem[]): SpeechCard | null {
  const first = queue[0]
  if (first === undefined) return null
  if (view?.cardBacklog === true && queue.length > 1) {
    // An urgent item is never folded into the line (review round 2): the card tells of the first urgent one.
    const urgent = queue.find((each) => each.urgent)
    return urgent === undefined ? { kind: 'backlog', count: queue.length } : { kind: 'item', item: urgent, more: queue.length - 1 }
  }
  return { kind: 'item', item: first, more: queue.length - 1 }
}

/**
 * The ids this window still keeps off the card after a click, of a fresh view: an id goes once main's view does the
 * same — the card told of the item, it left the state `new`, or it left the list — so a new event on it later tells again.
 */
export function stillClosed(closed: readonly string[], view: AssistantView | null): string[] {
  if (view === null) return [...closed]
  const waiting = new Set(view.items.filter((item) => item.state === 'new' && item.cardSeen !== true).map((item) => item.id))
  return closed.filter((id) => waiting.has(id))
}

/**
 * The items the window shows the user now, which their duties count as shown (`assistant.shown`): the item of the speech
 * card, and every item of the list while the section is in front on its tab of what waits. Nothing while the Assistant is
 * off: its duties count nothing before the user turns it on.
 */
export function shownItemIds(view: AssistantView | null, sectionShown: boolean, tab: string, queue: readonly WindowItem[]): string[] {
  if (view === null || !view.on) return []
  if (sectionShown) return tab === 'waits' ? view.items.map((item) => item.id) : []
  const card = speechCard(view, queue)
  return card?.kind === 'item' ? [card.item.id] : []
}

/**
 * The badge of the Assistant's rail button: while a card tells of an item, how many more wait behind it («+2»); without
 * one, or under the line of the backlog, how many items wait. None while the Assistant is off, or nothing waits.
 */
export function assistantBadge(view: AssistantView | null, queue: readonly WindowItem[]): RailBadge | undefined {
  if (view === null || !view.on) return undefined
  if (speechCard(view, queue)?.kind === 'item') {
    const more = queue.length - 1
    return more > 0 ? { tone: 'assistant', count: more, label: `${more} more from Assistant` } : undefined
  }
  const waiting = view.items.length
  return waiting > 0 ? { tone: 'assistant', count: waiting, label: waiting === 1 ? '1 item waits for you' : `${waiting} items wait for you` } : undefined
}
