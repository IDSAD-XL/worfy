// The Assistant's view in the window (worfy-assistant ticket 14): what main answers to `assistant.open`, kept current through
// `assistant.changed`, and what the section itself remembers while the window lives — the tab, the item to bring into
// sight, the speech cards the user closed, the item whose dislike just hid it. Every click goes to main through the
// functions at the end of this file; an error says why in a toast.
import { create } from 'zustand'
import type { OfferAnswer } from '../../shared/assistant/intro'
import type { AssistantView, Rating, SnoozeChoice, WindowItem } from '../../shared/assistant/window'
import type { RatingTarget } from '../../shared/ipc/assistant'
import { hasPreloadBridge, invoke, readableReason, subscribe } from '../ipc'
import { showSidebarSection } from '../shell/sidebar-scope'
import { showToast } from '../toast/toasts'
import { stillClosed } from './speech'

/** The id of the Assistant's section (its file, src/renderer/shell/sidebar/AssistantSection.tsx). */
export const ASSISTANT_SECTION = 'AssistantSection'

export type AssistantTab = 'waits' | 'summary' | 'journal' | 'chat'

/** An item a dislike just took off the list: its card says what rule hides it, with Undo. */
export interface GoneItem {
  item: WindowItem
  rule: { id: string; text: string }
}

/** A Session to prepare: the text the user reads, and edits, before Start. */
export interface PrepareRequest {
  title: string
  projectId: string
  projectName: string | null
  text: string
  by: 'assistant' | 'worfy'
  itemId: string | null
  proposalId: string | null
}

interface AssistantStore {
  view: AssistantView | null
  tab: AssistantTab
  /** The item a click on a journal line brings into sight. */
  focus: string | null
  /**
   * The items the speech card stopped telling of after a click, until main's view does the same (speech.ts, stillClosed):
   * their items stay in the list.
   */
  closed: readonly string[]
  gone: readonly GoneItem[]
  prepare: PrepareRequest | null
}

export const useAssistant = create<AssistantStore>(() => ({ view: null, tab: 'waits', focus: null, closed: [], gone: [], prepare: null }))

/** A fresh view of main: the card keeps off only what main's view does not take off already. */
function takeView(view: AssistantView): void {
  useAssistant.setState((state) => ({ view, closed: stillClosed(state.closed, view) }))
}

let followers = 0
let stop: (() => void) | null = null

/** Follows main's view while a part of the window needs it; answers the function that stops following. */
export function followAssistant(): () => void {
  followers += 1
  if (followers === 1 && hasPreloadBridge()) {
    let heard = false
    let live = true
    const stops: (() => void)[] = []
    try {
      stops.push(
        subscribe('assistant.changed', (view) => {
          heard = true
          takeView(view)
        }),
      )
      stops.push(subscribe('assistant.reveal', () => revealAssistant()))
    } catch (error) {
      console.error('assistant: cannot subscribe', error)
    }
    void invoke('assistant.open').then((result) => {
      if (!live) return
      if (!result.ok) return console.error('assistant.open failed:', result.error)
      if (!heard) takeView(result.value.view)
      if (result.value.reveal) revealAssistant()
    })
    stop = () => {
      live = false
      for (const each of stops) each()
    }
  }
  return () => {
    followers -= 1
    if (followers === 0) {
      stop?.()
      stop = null
    }
  }
}

/** Shows the Assistant's section on its list (a clicked notification, «N more in Assistant»). */
export function revealAssistant(tab: AssistantTab = 'waits'): void {
  showSidebarSection(ASSISTANT_SECTION)
  useAssistant.setState({ tab })
}

function refused(what: string, error: string): void {
  showToast({ kind: 'error', key: `assistant:${what}`, text: `${what}: ${readableReason(error)}` })
}

export async function itemAction(itemId: string, op: 'open' | 'dismiss' | 'wake'): Promise<void> {
  const result = await invoke('assistant.item', { itemId, op })
  if (!result.ok) refused(op === 'open' ? 'Open' : op === 'dismiss' ? 'Dismiss' : 'Wake now', result.error)
}

export async function snoozeItem(itemId: string, choice: SnoozeChoice): Promise<void> {
  const result = await invoke('assistant.snooze', { itemId, choice })
  if (!result.ok) refused('Snooze', result.error)
}

/** Like or dislike (or take it back); a dislike of an item leaves its card saying what rule hides it now. */
export async function rate(target: RatingTarget, rating: Rating | null, item?: WindowItem): Promise<void> {
  const result = await invoke('assistant.rate', { target, rating })
  if (!result.ok) return refused(rating === 'dislike' ? 'Dislike' : 'Like', result.error)
  const rule = result.value.rule
  if (item !== undefined && rating === 'dislike' && rule !== null) useAssistant.setState((state) => ({ gone: [...state.gone.filter((each) => each.item.id !== item.id), { item, rule }] }))
}

/** Undo of a dislike: its rule is deleted, and the item waits again. */
export async function undoDislike(gone: GoneItem): Promise<void> {
  const result = await invoke('assistant.rate', { target: { kind: 'item', id: gone.item.id }, rating: null })
  if (!result.ok) {
    const forgot = await invoke('assistant.forgetRule', { ruleId: gone.rule.id })
    if (!forgot.ok) return refused('Undo', forgot.error)
  }
  useAssistant.setState((state) => ({ gone: state.gone.filter((each) => each.item.id !== gone.item.id) }))
}

export async function forgetRule(ruleId: string): Promise<void> {
  const result = await invoke('assistant.forgetRule', { ruleId })
  if (!result.ok) refused('Show again', result.error)
}

export async function dismissProposal(proposalId: string): Promise<void> {
  const result = await invoke('assistant.dismissProposal', { proposalId })
  if (!result.ok) refused('Dismiss', result.error)
}

/** Apply under a card «before → after» (ticket 15): main applies the change; the card then says when. */
export async function applyChange(proposalId: string): Promise<void> {
  const result = await invoke('assistant.apply', { proposalId })
  if (!result.ok) refused('Apply', result.error)
}

/**
 * Undo under an applied card «before → after» (ticket 25): main puts the settings back as they were, and the card shows
 * Apply again; refused, with the settings that changed since the Apply, when one did.
 */
export async function undoChange(proposalId: string): Promise<void> {
  const result = await invoke('assistant.undo', { proposalId })
  if (!result.ok) refused('Undo', result.error)
}

/** Start of the prepared Session with exactly the text the user read; answers whether it started. */
export async function startPrepared(request: PrepareRequest, text: string): Promise<boolean> {
  const result = await invoke('assistant.start', { projectId: request.projectId, text, itemId: request.itemId, proposalId: request.proposalId })
  if (!result.ok) {
    refused('Start Session', result.error)
    return false
  }
  showToast({ kind: 'success', key: `assistant:started:${result.value.sessionId}`, text: `Session started in ${request.projectName ?? 'the Project'}.` })
  return true
}

/**
 * The person's answer to the one offer to turn the Assistant on (worfy-assistant ticket 16): `accepted` turns it on, and
 * the section shows the conversation, where it introduces itself; `declined` ends the offer; `seen` notes its message
 * for an updated user was shown. Answers whether main took it.
 */
export async function answerOffer(answer: OfferAnswer): Promise<boolean> {
  const result = await invoke('assistant.offer', { answer })
  if (!result.ok) {
    if (answer === 'seen') console.warn('assistant.offer failed:', result.error)
    else refused(answer === 'accepted' ? 'Turn on' : 'Not now', result.error)
    return false
  }
  if (answer === 'accepted') useAssistant.setState({ tab: 'chat', focus: null })
  return true
}

/** The user writes to the Assistant; answers whether main took the message. */
export async function sendMessage(text: string): Promise<boolean> {
  const result = await invoke('assistant.send', { text })
  if (!result.ok) refused('Send', result.error)
  return result.ok
}

let lastShown = ''

/**
 * Tells main which items the window shows the user now (`assistant.shown`), so their duties count them as shown; the
 * same list twice in a row is told once.
 */
export function reportShown(itemIds: readonly string[]): void {
  const key = itemIds.join('\n')
  if (key === lastShown) return
  lastShown = key
  if (itemIds.length === 0) return
  void invoke('assistant.shown', { itemIds: [...itemIds] }).then((result) => {
    if (!result.ok) console.warn('assistant.shown failed:', result.error)
  })
}

/**
 * The speech card stops telling of these items, as it showed them; they stay in the list as they are. Main keeps them as
 * told by the card (`assistant.cardClosed`, worfy-polish 161) with the count of events the card showed, so the card is
 * not shown for them again, after a restart too, until something new comes on one. This window keeps them off the card
 * at once, until main's view does the same.
 */
export function closeCard(items: readonly Pick<WindowItem, 'id' | 'events'>[]): void {
  if (items.length === 0) return
  useAssistant.setState((state) => ({ closed: [...new Set([...state.closed, ...items.map((each) => each.id)])] }))
  const told = items.map((each) => (each.events === undefined ? { id: each.id } : { id: each.id, events: each.events }))
  void invoke('assistant.cardClosed', { items: told }).then((result) => {
    if (!result.ok) refused('Close', result.error)
  })
}

/** Opens Prepare: the exact text of the Session, read before Start. */
export function prepareItem(item: WindowItem): void {
  if (item.prepare === null) return
  useAssistant.setState({
    prepare: { title: item.title, projectId: item.prepare.projectId, projectName: item.prepare.projectName, text: item.prepare.text, by: item.prepare.by, itemId: item.id, proposalId: item.proposalId },
  })
}
