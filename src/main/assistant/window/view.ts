// The Assistant's section of the rail in main (worfy-assistant ticket 14; spec, implementation decisions, UI; boundaries 3
// and 6): the view the window draws, and what each click of the user does.
//
// - The view: the items the duties show now (ticket 07) over every Project of this Machine, each with its reason (the
//   «why» of the Assistant's proposal for it, ticket 09), its source, its Project and its duty; urgent first. The snoozed
//   items, the items the user's dislikes hide (with the rule), the proposals of no item, the journal of actions (ticket 08)
//   with the item that caused each line, the conversation, worfy's own summary of the night and the line of usage (ticket
//   05: the share of the Limits is always an estimate).
// - The clicks: Open, Dismiss and Snooze change the item in the attention core (ticket 03) and are counted by its duty;
//   like and dislike reach the duty (Duties.rate), and taking one back uncounts it (Duties.unrate); Start of a prepared
//   Session starts a new Session with exactly the text the user read, and nothing else starts one (boundary 3); a message
//   of the user goes to the Assistant's Session (ticket 10), refused while the Assistant is off. Apply under a card
//   «before → after» applies the change of the settings a proposal carries (ticket 15): nothing else does. Undo under an
//   applied card puts those settings back as they were, unless one of them changed since (ticket 25).
// - Two machines (worfy-assistant ticket 18; boundary 5): every item and every click is of this Machine's Projects. What
//   waits on a Linked machine comes as it answered (linked.ts) and is shown beside, read-only: a click on it finds no
//   item here, and a Session starts only in a Project of this Machine. waiting() is what a Linked machine reads of this
//   one: this Machine's own items, words and times only, never what it read from another Machine.
//
// - The speech card (worfy-polish 161): Close closes the card as a whole. Every item it would tell of then counts as told
//   by the card until a new event comes on it or it turns urgent; the item itself stays as it was. Until the first Close
//   the view says the card has a backlog, and the card sums it up in one line.
//
// Nothing here runs a model or sends anything out of worfy. The snoozes, the ratings, the conversation and what the
// card told of are kept in the section's own file (store.ts).
import { createHash, randomUUID } from 'node:crypto'
import type { ActionJournalLine, ActionRefusal } from '../../../shared/assistant/actions'
import { LINKED_ITEMS_MAX, linkedItemOf, type LinkedMachineWaits, type LinkedWaits } from '../../../shared/assistant/linked'
import { OPEN_STATES, type AttentionItem, type AttentionState } from '../../../shared/assistant/attention'
import type { DutyLook, MemoryRule, ShownItem } from '../../../shared/assistant/duties'
import { NO_OFFER, type OfferView } from '../../../shared/assistant/intro'
import type { AssistantProposal } from '../../../shared/assistant/proposals'
import { changeBefore, changedSince, changeRows, type SettingsChange, type SettingsNow, type SettingsRestore } from '../../../shared/assistant/settings-change'
import { inWorkHours, nextWorkHoursStart, type WorkHours } from '../../../shared/assistant/schedule/work-hours'
import {
  isUrgentItem,
  SOURCE_LABELS,
  SUMMARY_HOURS,
  type AssistantView,
  type ConversationMessage,
  type JournalRow,
  type OpenTarget,
  type Rating,
  type SnoozeChoice,
  type SummaryView,
  type WindowItem,
  type WindowProposal,
} from '../../../shared/assistant/window'
import type { RatingTarget } from '../../../shared/ipc/assistant'
import type { Snooze, WindowState, WindowStateStore } from './store'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The reason a message to the Assistant is refused while it is off. */
export const ASSISTANT_OFF = 'Assistant is off on this machine'
/** The reason a click is refused on an item the core no longer keeps. */
export const ITEM_GONE = 'This item is no longer there'
/** A prepared Session names a Project this Machine does not have: a Linked machine's, which only its own Assistant acts in. */
export const NOT_THIS_MACHINE = 'A Session starts only in a Project of this Machine'
/** How many journal lines the view carries, newest first. */
export const JOURNAL_SHOWN = 200
/** How many items the summary names to take first. */
export const SUMMARY_FIRST = 3

/** How one Session of the Assistant ended, as far as the window needs it (ticket 10, AssistantRun). */
export interface AssistantRunLike {
  outcome: 'answered' | 'no-answer' | 'failed' | 'timed-out' | 'stopped'
  text: string | null
}

/** The Assistant once it runs (ticket 10, Assistant.userMessage): a new Session with the user's text; null once stopped. */
export interface AssistantConversation {
  userMessage(text: string): Promise<AssistantRunLike> | null
}

export interface WindowCore {
  items(scope: string | null): readonly AttentionItem[]
  mark(scope: string | null, id: string, state: AttentionState): void
  subscribe(listener: () => void): () => void
}

export interface WindowDuties {
  look(items: readonly AttentionItem[], options?: { countShown?: boolean }): DutyLook
  rate(item: AttentionItem, rating: 'like' | 'dislike'): MemoryRule | null
  unrate(duty: string, itemId: string, rating: 'like' | 'dislike', ruleId: string | null, run?: number): void
  runOf(duty: string): number
  react(item: AttentionItem, reaction: 'accepted' | 'declined'): void
  rules(): MemoryRule[]
  deleteRule(id: string): void
  onChange(listener: () => void): () => void
}

export interface WindowProposals {
  list(): AssistantProposal[]
  subscribe(listener: () => void): () => void
  remove(id: string): void
  /** Notes the user's Apply of a proposal's change (ticket 15), and its Undo (null, ticket 25). */
  update(id: string, change: { applied: AssistantProposal['applied'] }): unknown
}

/** The settings a card «before → after» reads and its Apply changes (ticket 15). */
export interface WindowSettings {
  /** The app settings and the duties as they are now: the «before» of the rows. */
  now(): SettingsNow
  /** Applies the change, or the settings as they were before one (Undo), whole; or throws, with the reason, and changes nothing. */
  apply(change: SettingsChange | SettingsRestore): void
}

export interface AssistantWindowDeps {
  now(): number
  /** The app's attention core; null while it does not run. */
  core(): WindowCore | null
  duties: WindowDuties
  /** The Projects of this Machine; `localOnly` — never seen by a Linked machine (the Demo project, worfy-onboarding 11). */
  projects(): readonly { id: string; name: string; localOnly?: true }[]
  proposals: WindowProposals
  /** The journal of actions, oldest first. */
  journal(): readonly ActionJournalLine[]
  /** Adds a line to the journal of actions (the user's Undo of a card, ticket 25); absent: Undo writes none. */
  record?(line: ActionJournalLine): void
  /** The Assistant's tokens today and this week, and its estimated share (0..1) of each Limits window. */
  usage(): { today: number; week: number; shares: readonly { window: string; share: number }[] }
  workHours(): WorkHours
  /** The settings Apply changes; absent: a card shows no rows and Apply is refused. */
  settings?: WindowSettings
  store: WindowStateStore
  /** The Assistant while it runs; null while it is off. */
  assistant(): AssistantConversation | null
  /** The Node of a live Session of a Project; null when it has none on the Canvas. */
  nodeOf(projectId: string, sessionId: string): string | null
  /** A new Session Node of the Project whose first message is `text`; throws, with the reason, when it cannot start. */
  start(projectId: string, text: string): { nodeId: string; sessionId: string }
  newId?(): string
  log?(message: string, error: unknown): void
  /** What each Linked machine last answered of what waits there (worfy-assistant ticket 18, linked.ts); none when absent. */
  linked?(): readonly LinkedMachineWaits[]
  /** The one offer to turn the Assistant on (worfy-assistant ticket 16, src/main/assistant/intro/); none when absent. */
  offer?(): OfferView
}

/** The first moment of the next work hours after the ones `moment` is in; the next start when it is outside them. */
export function nextWorkHoursAfter(moment: number, hours: WorkHours): number {
  let at = moment
  // Out of the window `moment` is in, in steps of five minutes: a window is at most a day long.
  for (let steps = 0; inWorkHours(at, hours) && steps < (8 * 24 * 60) / 5; steps++) at += 5 * MINUTE
  return nextWorkHoursStart(at, hours)
}

const REFUSALS: Record<ActionRefusal, string> = {
  'not-in-list': 'it is not in the closed list',
  'no-item': 'the item no longer waits',
  'not-proposed': 'its duty does not propose it',
  mode: 'the mode of its duty does not allow it',
  'no-target': 'the Session is not running',
  'run-owns': 'an Autopilot run owns the Session',
  busy: 'the Session is busy',
  limits: 'the Limits still refuse',
  cap: 'it was done too often today',
  failed: 'the Session did not take the message',
}

/** The action of the journal line of an Undo under a card «before → after» (ticket 25): the user's, not the closed list's. */
export const SETTINGS_UNDO_ACTION = 'settings-undo'

const DONE: Record<string, string> = {
  'wake-orchestrator': "Woke the Orchestrator with worfy's fixed message",
  'continue-session': 'Continued the Session after the Limits reset',
  [SETTINGS_UNDO_ACTION]: 'Undid the settings change',
}

const VERB: Record<string, string> = {
  'wake-orchestrator': 'wake the Orchestrator',
  'continue-session': 'continue the Session',
}

function journalText(line: ActionJournalLine): string {
  if (line.outcome === 'escalated') return 'Woke Assistant: the fixed steps of worfy did not help'
  if (line.outcome === 'done') return DONE[line.action] ?? `Did «${line.action}»`
  const reason = line.reason === undefined ? 'refused' : REFUSALS[line.reason]
  return `Did not ${VERB[line.action] ?? `do «${line.action}»`}: ${reason}`
}

const journalId = (line: ActionJournalLine): string => `${line.at}|${line.action}|${line.by}|${line.item}`

const NO_ANSWER: Record<Exclude<AssistantRunLike['outcome'], 'answered'>, string> = {
  'no-answer': 'I had no answer this time.',
  failed: 'I could not start this time. Try again in a minute.',
  'timed-out': 'I ran out of time before I answered.',
  stopped: 'I was turned off before I answered.',
}

/** Where Open takes the user for an item. */
export function openTargetOf(item: AttentionItem, nodeOf: (projectId: string, sessionId: string) => string | null): OpenTarget | null {
  const { projectId, subject } = item
  if (subject.kind === 'message') return item.message?.url.startsWith('https://') === true ? { kind: 'url', url: item.message.url } : null
  if (subject.kind === 'check' && item.source === 'health') return { kind: 'health' }
  if (projectId === null) return null
  switch (subject.kind) {
    case 'session': {
      const nodeId = nodeOf(projectId, subject.id)
      return nodeId === null ? { kind: 'project', projectId } : { kind: 'session', projectId, nodeId }
    }
    case 'pr': {
      const [, repo, number] = /^(.+)#(\d+)$/u.exec(subject.id) ?? []
      return repo === undefined || number === undefined ? { kind: 'project', projectId } : { kind: 'pr', projectId, repo, number: Number(number) }
    }
    case 'check':
      return item.pr === undefined ? { kind: 'project', projectId } : { kind: 'pr', projectId, repo: item.pr.repo, number: item.pr.number }
    case 'ticket':
    case 'run':
      return { kind: 'pipeline', projectId }
    default:
      return { kind: 'project', projectId }
  }
}

/** Urgent first, then the newest. */
const byUrgency = (a: WindowItem, b: WindowItem): number => Number(b.urgent) - Number(a.urgent) || b.lastAt - a.lastAt

const ruleHides = (rule: MemoryRule, item: AttentionItem): boolean => rule.duty === item.duty && rule.projectId === item.projectId && rule.source === item.source && rule.kind === item.kind

const ratingKey = (target: RatingTarget): string => `${target.kind}:${target.id}`

/** Whether the speech card told of the item as it is now: closed over it, and no event came on it nor did it turn urgent since. */
const cardTold = (told: { events: number; urgent: boolean } | undefined, item: AttentionItem): boolean => told !== undefined && told.events === item.events && told.urgent === isUrgentItem(item)

export class AssistantWindow {
  private readonly listeners = new Set<() => void>()
  private pending = false
  private state: WindowState | null = null

  constructor(private readonly deps: AssistantWindowDeps) {}

  private load(): WindowState {
    this.state ??= this.deps.store.read()
    return this.state
  }

  private save(edit: (state: WindowState) => void): void {
    const next = structuredClone(this.load())
    edit(next)
    this.deps.store.write(next)
    this.state = next
    this.changed()
  }

  /** Told after each change, once per turn of the event loop; answers the function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A change: the listeners hear of it once, after the work of this turn. */
  changed(): void {
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => {
      this.pending = false
      for (const listener of [...this.listeners]) listener()
    })
  }

  /** Follows the attention core, the duties and the proposals; answers the function that stops it. */
  watch(): () => void {
    const core = this.deps.core()
    const stops = [
      this.deps.duties.onChange(() => this.changed()),
      this.deps.proposals.subscribe(() => this.changed()),
      ...(core === null
        ? []
        : [
            core.subscribe(() => {
              this.tick()
              this.changed()
            }),
          ]),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }

  private scopes(): (string | null)[] {
    return [null, ...this.deps.projects().map((project) => project.id)]
  }

  private allItems(): AttentionItem[] {
    const core = this.deps.core()
    if (core === null) return []
    return this.scopes().flatMap((scope) => core.items(scope))
  }

  private find(itemId: string): AttentionItem {
    const found = this.allItems().find((item) => item.id === itemId)
    if (found === undefined) throw new Error(ITEM_GONE)
    return found
  }

  /** A reaction to an item reaches its duty — and counts it as shown — only while the Assistant is on, as shown() does. */
  private react(item: AttentionItem, reaction: 'accepted' | 'declined'): void {
    if (this.deps.assistant() !== null) this.deps.duties.react(item, reaction)
  }

  private mark(item: AttentionItem, state: AttentionState): void {
    this.deps.core()?.mark(item.projectId, item.id, state)
  }

  private rating(target: RatingTarget): Rating | null {
    return this.load().ratings.find((each) => each.key === ratingKey(target))?.rating ?? null
  }

  /**
   * The window showed these items to the user: in the open section or on a speech card. Their duties count them as shown
   * — once each, and only while the Assistant is on, so that nothing counts, ignores or pauses a duty before the user
   * turned it on. An id no longer there is skipped.
   */
  shown(itemIds: readonly string[]): void {
    if (this.deps.assistant() === null || itemIds.length === 0) return
    const ids = new Set(itemIds)
    const items = this.allItems().filter((item) => ids.has(item.id))
    if (items.length > 0) this.deps.duties.look(items)
  }

  /**
   * The user closed the speech card over these items (`assistant.cardClosed`): each counts as told by the card with the
   * count of events the card showed of it — an event that came after the card was drawn keeps the item untold; without a
   * count, as the item is now. Nothing else of the item changes — its state, its duty's counts, the list. Marks of items
   * no longer there go.
   */
  cardClosed(closed: readonly { id: string; events?: number | undefined }[]): void {
    const shown = new Map(closed.map((each) => [each.id, each.events]))
    const items = this.allItems()
    const before = this.load().card?.told ?? {}
    const told: Record<string, { events: number; urgent: boolean }> = {}
    for (const item of items) {
      if (shown.has(item.id)) told[item.id] = { events: shown.get(item.id) ?? item.events, urgent: isUrgentItem(item) }
      else if (before[item.id] !== undefined) told[item.id] = before[item.id]!
    }
    this.save((state) => void (state.card = { told }))
  }

  /** The view the window draws. */
  view(): AssistantView {
    const now = this.deps.now()
    const items = this.allItems()
    // The view counts no item as shown: the background loop and the notifications ask for it too. shown() counts.
    const look = this.deps.duties.look(items, { countShown: false })
    const projects = this.deps.projects()
    const names = new Map(projects.map((project) => [project.id, project.name]))
    const titles = new Map(look.duties.map((duty) => [duty.id, duty.title]))
    const proposals = this.deps.proposals.list()
    const proposalOf = new Map<string, AssistantProposal>()
    // A proposal that changes a setting has its card among the proposals, never on its item (ticket 15).
    for (const proposal of proposals) if (proposal.item !== null && proposal.change == null && !proposalOf.has(proposal.item)) proposalOf.set(proposal.item, proposal)
    const snoozes = new Map(this.load().snoozes.map((snooze) => [snooze.itemId, snooze]))
    const card = this.load().card

    const windowItem = (item: AttentionItem, shown?: ShownItem): WindowItem => {
      const proposal = proposalOf.get(item.id)
      const fix = shown?.proposals.find((each) => each.action === 'fix-session')
      const prepare =
        proposal?.prepare != null
          ? { ...proposal.prepare, projectName: names.get(proposal.prepare.projectId) ?? null, by: 'assistant' as const }
          : fix !== undefined && item.projectId !== null && names.has(item.projectId)
            ? { projectId: item.projectId, projectName: names.get(item.projectId) ?? null, text: fix.text, by: 'worfy' as const }
            : null
      const duty = item.duty === null ? null : { id: item.duty, title: titles.get(item.duty) ?? item.duty }
      const snooze = snoozes.get(item.id)
      return {
        id: item.id,
        title: item.text,
        why: proposal?.why ?? null,
        source: item.source,
        sourceLabel: SOURCE_LABELS[item.source] ?? item.source,
        subject: item.subject,
        kind: item.kind,
        projectId: item.projectId,
        projectName: item.projectId === null ? null : (names.get(item.projectId) ?? null),
        duty,
        urgent: isUrgentItem(item),
        state: item.state,
        startedAt: item.startedAt,
        lastAt: item.lastAt ?? item.startedAt,
        events: item.events,
        outside: item.message === undefined ? null : { author: item.message.author, at: item.message.at, url: item.message.url },
        proposalId: proposal?.id ?? null,
        prepare,
        open: openTargetOf(item, this.deps.nodeOf),
        rating: this.rating({ kind: 'item', id: item.id }),
        ...(item.state === 'snoozed' ? { snoozedUntil: snooze?.until ?? null } : {}),
        ...(cardTold(card?.told[item.id], item) ? { cardSeen: true } : {}),
      }
    }

    const shownItems = look.shown.map((shown) => windowItem(shown.item, shown)).sort(byUrgency)
    const shownIds = new Set(shownItems.map((item) => item.id))
    const snoozed = items
      .filter((item) => item.state === 'snoozed' && item.duty !== null)
      .map((item) => windowItem(item))
      .sort(byUrgency)
    const rules = this.deps.duties.rules()
    const hidden = items.flatMap((item) => {
      if (item.state !== 'new' && item.state !== 'seen') return []
      const rule = rules.find((each) => ruleHides(each, item))
      return rule === undefined ? [] : [{ item: windowItem(item), rule: { id: rule.id, text: rule.text } }]
    })
    const openIds = new Set(items.filter((item) => OPEN_STATES.includes(item.state)).map((item) => item.id))
    const free: WindowProposal[] = proposals
      .filter((proposal) => proposal.item === null || proposal.change != null || (!shownIds.has(proposal.item) && openIds.has(proposal.item)))
      .map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        why: proposal.why,
        prepare: proposal.prepare === null ? null : { ...proposal.prepare, projectName: names.get(proposal.prepare.projectId) ?? null, by: 'assistant' as const },
        change: this.changeCard(proposal),
        createdAt: proposal.createdAt,
        rating: this.rating({ kind: 'proposal', id: proposal.id }),
      }))

    const byId = new Map(items.map((item) => [item.id, item]))
    const lines = this.deps.journal()
    const journal: JournalRow[] = lines
      .slice(-JOURNAL_SHOWN)
      .reverse()
      .map((line) => {
        const id = journalId(line)
        const item = byId.get(line.item)
        return {
          id,
          at: line.at,
          by: line.by === 'main' ? ('worfy' as const) : line.by === 'assistant' ? ('assistant' as const) : ('you' as const),
          text: journalText(line),
          outcome: line.outcome,
          cause: { itemId: line.item, text: item?.text ?? line.itemText ?? line.item, open: item !== undefined && openIds.has(item.id) },
          duty: line.duty === null ? null : (titles.get(line.duty) ?? line.duty),
          rating: this.rating({ kind: 'journal', id }),
        }
      })

    const conversation = this.load().conversation.map((message) => ({ ...message, rating: this.rating({ kind: 'message', id: message.id }) }))

    const usage = this.deps.usage()
    const share = (window: string): number | null => {
      const found = usage.shares.find((each) => each.window === window)
      return found === undefined ? null : Math.round(found.share * 1000) / 10
    }

    return {
      on: this.deps.assistant() !== null,
      projects: projects.length,
      items: shownItems,
      snoozed,
      hidden,
      proposals: free,
      journal,
      conversation,
      summary: this.summary(now, items, shownItems, lines, conversation, names),
      usage: { today: usage.today, week: usage.week, fiveHour: share('five_hour'), sevenDay: share('seven_day'), estimate: true },
      workHours: inWorkHours(now, this.deps.workHours()),
      linked: [...(this.deps.linked?.() ?? [])],
      offer: this.deps.offer?.() ?? { ...NO_OFFER },
      ...(card === undefined ? { cardBacklog: true } : {}),
    }
  }

  /**
   * What a Linked machine reads of this one (`assistant.waiting`): the Projects of this Machine and the items the section
   * shows now, urgent first, as words and times — no prepared text, proposal, target or rating. An item's id is a digest
   * of the core's, which may hold a source's text. Reading counts nothing as shown, and nothing of a third Machine goes.
   * A Project local to this Machine (`localOnly`, as ProjectStore.states() leaves it out of a Linked machine's list) and
   * its items stay here, and so do the items of no Project (Limits, a message tied to none): only the items of a Project
   * the Linked machine may see go, the first LINKED_ITEMS_MAX of them.
   */
  waiting(): LinkedWaits {
    const shared = this.deps.projects().filter((project) => project.localOnly !== true)
    const ids = new Set(shared.map((project) => project.id))
    return {
      projects: shared.map((project) => ({ id: project.id, name: project.name })),
      items: this.view()
        .items.filter((item) => item.projectId !== null && ids.has(item.projectId))
        .slice(0, LINKED_ITEMS_MAX)
        .map((item) => ({ ...linkedItemOf(item), id: createHash('sha256').update(item.id).digest('hex').slice(0, 24) })),
    }
  }

  private summary(
    now: number,
    items: readonly AttentionItem[],
    shown: readonly WindowItem[],
    lines: readonly ActionJournalLine[],
    conversation: readonly ConversationMessage[],
    names: ReadonlyMap<string, string>,
  ): SummaryView {
    const since = now - SUMMARY_HOURS * HOUR
    const came = items.filter((item) => item.startedAt >= since)
    const projects = new Map<string | null, SummaryView['projects'][number]>()
    const row = (projectId: string | null) => {
      let found = projects.get(projectId)
      if (found === undefined) {
        found = { projectId, name: projectId === null ? 'This machine' : (names.get(projectId) ?? projectId), came: 0, waiting: 0, urgent: 0 }
        projects.set(projectId, found)
      }
      return found
    }
    for (const item of came) row(item.projectId).came += 1
    for (const item of shown) {
      const each = row(item.projectId)
      each.waiting += 1
      if (item.urgent) each.urgent += 1
    }
    const morning = [...conversation].reverse().find((message) => message.reason === 'morning' && message.state === 'done')
    const day = new Date(now)
    const id = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return {
      id,
      since,
      came: came.length,
      done: lines.filter((line) => line.at >= since && line.outcome === 'done' && line.by !== 'user').length,
      stopped: came.filter((item) => item.kind === 'run-stopped').length,
      waiting: shown.length,
      projects: [...projects.values()],
      first: shown.slice(0, SUMMARY_FIRST).map((item) => item.id),
      morning: morning === undefined ? null : { at: morning.at, text: morning.text },
      rating: this.rating({ kind: 'summary', id }),
    }
  }

  /** Open, Dismiss or Wake now on an item. */
  item(itemId: string, op: 'open' | 'dismiss' | 'wake'): void {
    const item = this.find(itemId)
    if (op === 'open') {
      if (item.state === 'new') this.mark(item, 'seen')
      this.react(item, 'accepted')
    } else if (op === 'dismiss') {
      this.mark(item, 'dismissed')
      // The user saw the item to dismiss it: the view counts nothing as shown, so the reaction counts it here.
      this.react(item, 'declined')
    } else if (item.state === 'snoozed') {
      this.mark(item, 'new')
    }
    if (op !== 'open') this.dropSnooze(itemId)
    this.changed()
  }

  private dropSnooze(itemId: string): void {
    if (this.load().snoozes.some((snooze) => snooze.itemId === itemId)) this.save((state) => void (state.snoozes = state.snoozes.filter((snooze) => snooze.itemId !== itemId)))
  }

  /** Snoozes an item; answers until when, or null for «until something changes». */
  snooze(itemId: string, choice: SnoozeChoice): number | null {
    const item = this.find(itemId)
    const now = this.deps.now()
    const until = choice === 'hour' ? now + HOUR : choice === 'three-hours' ? now + 3 * HOUR : choice === 'next-work-hours' ? nextWorkHoursAfter(now, this.deps.workHours()) : null
    this.mark(item, 'snoozed')
    const snooze: Snooze = { itemId, scope: item.projectId, until, revision: item.revision }
    this.save((state) => void (state.snoozes = [...state.snoozes.filter((each) => each.itemId !== itemId), snooze]))
    return until
  }

  /** Wakes the snoozed items that are due, or whose subject changed since; drops the snoozes of items gone or woken. */
  tick(): void {
    const snoozes = this.load().snoozes
    if (snoozes.length === 0) return
    const now = this.deps.now()
    const core = this.deps.core()
    if (core === null) return
    const kept: Snooze[] = []
    for (const snooze of snoozes) {
      const item = core.items(snooze.scope).find((each) => each.id === snooze.itemId)
      if (item === undefined || item.state !== 'snoozed') continue
      const due = snooze.until === null ? item.revision !== snooze.revision : now >= snooze.until
      if (due) core.mark(snooze.scope, snooze.itemId, 'new')
      else kept.push(snooze)
    }
    if (kept.length !== snoozes.length) this.save((state) => void (state.snoozes = kept))
  }

  /** Like, dislike, or take the rating back (null); answers the rule a dislike of an item wrote. */
  rate(target: RatingTarget, rating: Rating | null): { id: string; text: string } | null {
    const key = ratingKey(target)
    const before = this.load().ratings.find((each) => each.key === key)
    const item = this.ratedItem(target)
    if (before?.rating === rating) {
      const rule = before?.rule === undefined ? undefined : this.deps.duties.rules().find((each) => each.id === before.rule)
      return rule === undefined ? null : { id: rule.id, text: rule.text }
    }
    // Taking a rating back uncounts it at its duty; a dislike's rule goes with it, and the items it hid wait again —
    // unless another rating still holds that rule (a dislike of the item and one of a journal row it caused).
    const held = before?.rule !== undefined && this.load().ratings.some((each) => each.key !== key && each.rule === before.rule)
    const ruleId = before?.rule === undefined || held ? null : before.rule
    if (before?.counted !== undefined) this.deps.duties.unrate(before.counted.duty, before.counted.item, before.rating, ruleId, before.counted.run)
    else if (ruleId !== null) this.deps.duties.deleteRule(ruleId)
    let rule: MemoryRule | null = null
    if (rating !== null && item !== null) rule = this.deps.duties.rate(item, rating)
    const counted = rating !== null && item !== null && item.duty !== null ? { duty: item.duty, item: item.id, run: this.deps.duties.runOf(item.duty) } : undefined
    this.save((state) => {
      state.ratings = state.ratings.filter((each) => each.key !== key)
      if (rating !== null) state.ratings.push({ key, rating, at: this.deps.now(), ...(rule === null ? {} : { rule: rule.id }), ...(counted === undefined ? {} : { counted }) })
    })
    return rule === null ? null : { id: rule.id, text: rule.text }
  }

  /** The item whose duty a rating reaches; null for a message, a proposal or the summary, which have none. */
  private ratedItem(target: RatingTarget): AttentionItem | null {
    switch (target.kind) {
      case 'item':
        return this.find(target.id)
      case 'journal': {
        const line = this.deps.journal().find((each) => journalId(each) === target.id)
        if (line === undefined) throw new Error('This line is no longer in the journal')
        return this.allItems().find((item) => item.id === line.item) ?? null
      }
      case 'message':
        if (!this.load().conversation.some((message) => message.id === target.id)) throw new Error('This message is no longer there')
        return null
      case 'proposal':
        if (!this.deps.proposals.list().some((proposal) => proposal.id === target.id)) throw new Error('This proposal is no longer there')
        return null
      case 'summary':
        return null
    }
  }

  /** Deletes a rule of the user's dislikes (Show again): the items it hid wait again. */
  forgetRule(ruleId: string): void {
    this.deps.duties.deleteRule(ruleId)
    this.save((state) => {
      state.ratings = state.ratings.filter((each) => each.rule !== ruleId)
    })
  }

  dismissProposal(proposalId: string): void {
    this.deps.proposals.remove(proposalId)
    this.changed()
  }

  /** The card «before → after» of a proposal: its rows now, or as they were when the user applied it; null without a change. */
  private changeCard(proposal: AssistantProposal): WindowProposal['change'] {
    if (proposal.change == null) return null
    if (proposal.applied != null) return { rows: proposal.applied.rows, applied: proposal.applied.at, undoable: proposal.applied.before !== undefined }
    if (this.deps.settings === undefined) return { rows: [], applied: null }
    try {
      return { rows: changeRows(proposal.change, this.deps.settings.now()), applied: null }
    } catch (error) {
      this.deps.log?.('[assistant] the rows of a change could not be read', error)
      return { rows: [], applied: null }
    }
  }

  /**
   * Apply under a card «before → after» (ticket 15; story 26): the only way a change the Assistant proposed reaches the
   * settings. Applied once; the card keeps its rows as they were and when. A change the settings refuse throws, with the
   * reason, and the card stays as it was.
   */
  apply(proposalId: string): void {
    const proposal = this.deps.proposals.list().find((each) => each.id === proposalId)
    if (proposal === undefined) throw new Error('This proposal is no longer there')
    if (proposal.change == null) throw new Error('This proposal changes no setting')
    if (proposal.applied != null) throw new Error('This change is applied already')
    const settings = this.deps.settings
    if (settings === undefined) throw new Error('Settings cannot be changed here')
    const now = settings.now()
    const rows = changeRows(proposal.change, now)
    // What Undo puts back (ticket 25): each setting the change names, as it is before this Apply.
    const before = changeBefore(proposal.change, now)
    settings.apply(proposal.change)
    this.deps.proposals.update(proposalId, { applied: { at: this.deps.now(), rows, before } })
    this.changed()
  }

  /**
   * Undo under an applied card «before → after» (ticket 25; the prototype's `undoapply`): each setting the change named
   * goes back to the value it had before the Apply, through the same path as Apply, and the card is not applied again
   * (Apply shows once more). Refused whole, changing nothing, when any of those settings no longer holds the value the
   * Apply gave it — the user or another card changed it since — and the refusal names them: Undo never overwrites a
   * later choice. Writes the line «Undid the settings change» to the journal.
   */
  undo(proposalId: string): void {
    const proposal = this.deps.proposals.list().find((each) => each.id === proposalId)
    if (proposal === undefined) throw new Error('This proposal is no longer there')
    if (proposal.change == null || proposal.applied == null) throw new Error('This change is not applied')
    if (proposal.applied.before === undefined) throw new Error('This change was applied before Undo existed: change it back in Settings → Assistant')
    const settings = this.deps.settings
    if (settings === undefined) throw new Error('Settings cannot be changed here')
    const moved = changedSince(proposal.change, settings.now())
    if (moved.length > 0) throw new Error(`Changed since Apply, so Undo would overwrite it: ${moved.join(', ')}. Change it in Settings → Assistant`)
    settings.apply(proposal.applied.before)
    this.deps.proposals.update(proposalId, { applied: null })
    this.deps.record?.({
      at: this.deps.now(),
      action: SETTINGS_UNDO_ACTION,
      by: 'user',
      item: `proposal:${proposal.id}`,
      duty: null,
      projectId: null,
      itemKind: null,
      itemText: `Before → after card: ${proposal.title}`,
      mode: null,
      sessionId: null,
      outcome: 'done',
      detail: proposal.applied.rows.map((row) => `${row.label}: ${row.after} → ${row.before}`).join('; '),
    })
    this.changed()
  }

  /** Start of a prepared Session, on the user's click, with exactly the text they read. */
  start(request: { projectId: string; text: string; itemId: string | null; proposalId: string | null }): { projectId: string; nodeId: string; sessionId: string } {
    if (!this.deps.projects().some((project) => project.id === request.projectId)) throw new Error(`${NOT_THIS_MACHINE}: ${request.projectId} is not one`)
    const started = this.deps.start(request.projectId, request.text)
    if (request.itemId !== null) {
      const item = this.allItems().find((each) => each.id === request.itemId)
      if (item !== undefined) {
        if (item.state === 'new') this.mark(item, 'seen')
        this.react(item, 'accepted')
      }
    }
    if (request.proposalId !== null && this.deps.proposals.list().some((proposal) => proposal.id === request.proposalId)) this.deps.proposals.remove(request.proposalId)
    this.changed()
    return { projectId: request.projectId, ...started }
  }

  private newId(): string {
    return this.deps.newId?.() ?? randomUUID()
  }

  /** The user writes to the Assistant: their message, then the Assistant's answer when its Session ends. */
  send(text: string): void {
    const assistant = this.deps.assistant()
    if (assistant === null) throw new Error(ASSISTANT_OFF)
    const now = this.deps.now()
    const mine: ConversationMessage = { id: this.newId(), at: now, who: 'you', text, state: 'done', reason: 'user', rating: null }
    const answer: ConversationMessage = { id: this.newId(), at: now, who: 'assistant', text: '', state: 'pending', reason: 'user', rating: null }
    this.save((state) => void state.conversation.push(mine, answer))
    const settle = (run: AssistantRunLike): void => {
      const done = run.outcome === 'answered' && run.text !== null && run.text.trim() !== ''
      this.answer(answer.id, done ? { text: run.text ?? '', state: 'done' } : { text: run.outcome === 'answered' ? NO_ANSWER['no-answer'] : NO_ANSWER[run.outcome], state: 'failed' })
    }
    const run = assistant.userMessage(text)
    if (run === null) return settle({ outcome: 'stopped', text: null })
    run.then(settle, (error: unknown) => {
      this.deps.log?.('[assistant] a message of the user got no answer', error)
      settle({ outcome: 'failed', text: null })
    })
  }

  private answer(id: string, change: Pick<ConversationMessage, 'text' | 'state'>): void {
    this.save((state) => {
      const message = state.conversation.find((each) => each.id === id)
      if (message !== undefined) Object.assign(message, change, { at: this.deps.now() })
    })
  }

  /**
   * A finished run of the Assistant (ticket 10, onAssistantRun): the text of a wake that answered joins the conversation.
   * The run of the user's message is not posted again — send() shows its answer — and a run without an answer posts
   * nothing.
   */
  noteWakeRun(run: { reason: 'urgent' | 'batch' | 'morning' | 'user'; outcome: AssistantRunLike['outcome']; text: string | null }): void {
    if (run.reason === 'user' || run.outcome !== 'answered' || run.text === null) return
    this.noteAssistantMessage(run.reason, run.text)
  }

  /**
   * A message of the Assistant from one of its wakes (ticket 10): the morning one is the summary's. Or one of its
   * introduction (ticket 16), whose last message hands over the proposal of the first setup: its card follows it.
   */
  noteAssistantMessage(reason: 'urgent' | 'batch' | 'morning' | 'intro', text: string, proposalId: string | null = null): void {
    if (text.trim() === '') return
    const message: ConversationMessage = { id: this.newId(), at: this.deps.now(), who: 'assistant', text, state: 'done', reason, rating: null, ...(proposalId === null ? {} : { proposalId }) }
    this.save((state) => void state.conversation.push(message))
  }
}
