// The duties of the Assistant in main (worfy-assistant ticket 07; spec, implementation decisions, duties; test decisions, seam A).
// In: the items of the attention core, the clock, the user's choices kept in the memory file (memory.ts) and the rules
// of each Project's settings. Out: what each duty shows and proposes, its counters, whether it is paused. No model.
//
// - Each event of the core gets the duty whose trigger takes it (dutyOf); an item of a kind no duty takes — a Session
//   that ended its turn — is shown by none.
// - A Session that is silent or waits for an answer is shown once it has waited the duty's threshold; the CI of the
//   main branch gives its item only after its threshold (main-ci.ts); a rule of a Project after its quiet minutes (rules.ts).
// - A dislike at once hides the items of that duty of the same source and kind in the same Project, and writes that as
//   a rule in the memory file; a deleted rule no longer hides anything. A like is counted.
// - Each item is counted once as shown, and once as accepted, declined (a reaction, or the item dismissed) or ignored
//   (still open IGNORED_AFTER_MS after it was first shown). Ignored proposals and dislikes in a row pause the duty after
//   `pauseAfter` (DEFAULT_PAUSE_AFTER); a paused duty shows nothing until resume().
import { randomUUID } from 'node:crypto'
import { CONTINUE_SESSION_TEXT, WAKE_ORCHESTRATOR_TEXT } from '../../../shared/assistant/actions'
import type { AttentionEvent, AttentionItem } from '../../../shared/assistant/attention'
import {
  BUILTIN_DUTIES,
  DEFAULT_PAUSE_AFTER,
  DUTY_ACTION_ALLOWED_MODES,
  DUTY_COUNTERS,
  dutyActionModeAllowed,
  dutyActionModeSchema,
  projectRuleDutyId,
  triggerSources,
  type DutyAction,
  type DutyActionMode,
  type DutyCounters,
  type DutyDefinition,
  type DutyLook,
  type DutyProposal,
  type DutyStatus,
  type MemoryRule,
  type ProjectRule,
  type ShownItem,
} from '../../../shared/assistant/duties'
import { ATTENTION_KEEP_DAYS } from '../core/attention-core'
import { assistantMemorySchema, type AssistantMemory, type DutyState, type MemoryStore } from './memory'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/**
 * How long a shown item may stay open with no reaction before it counts as ignored: a day. Decided without the owner
 * (ticket 07, result section).
 */
export const IGNORED_AFTER_MS = DAY

/** The kinds of Session items shown only once they have waited the duty's threshold; a `waiting` item is raised then. */
const WAITED_KINDS: ReadonlySet<string> = new Set(['quiet', 'question', 'permission'])

export interface DutiesOptions {
  now: () => number
  store: MemoryStore
  /** The Projects whose rules are duties too. */
  projects?: () => readonly string[]
  /** The rules of a Project's settings (readProjectAssistantRules). */
  projectRules?: (projectId: string) => readonly ProjectRule[]
}

/** What the user may change of a duty (ticket 15 shows it). `projects: 'all'` widens the scope back. */
export interface DutyChoice {
  modes?: Partial<Record<DutyAction, DutyActionMode>>
  projects?: 'all' | readonly string[]
  thresholdMinutes?: number
  enabled?: boolean
}

interface Known {
  definition: DutyDefinition
  projectId: string | null
}

/** The run of ignored proposals and dislikes ends: it starts again from none, as a new run. */
function endRun(state: { streak: number; run?: number }): void {
  state.streak = 0
  state.run = (state.run ?? 0) + 1
}

const zero = (): DutyCounters => Object.fromEntries(DUTY_COUNTERS.map((name) => [name, 0])) as DutyCounters

/** The text of the Session that fixes the red CI of the main branch: main writes it, not the Assistant. */
function fixText(item: AttentionItem): string {
  const [, repo = '', branch = 'main'] = /^ci:(.+)@([^@]+)$/u.exec(item.subject.id) ?? []
  const cause = item.pr === undefined ? 'its last commit' : `${item.pr.repo}#${item.pr.number} (${item.pr.title})`
  return `The CI of the ${branch} branch of ${repo} is red since ${cause}. Find the check that fails and its cause, fix it on a new branch and open a PR.`
}

/** The text of an action on an item; null when the action does not fit the item. */
function proposalText(action: DutyAction, item: AttentionItem): string | null {
  switch (action) {
    case 'open':
      return `Open ${item.subject.label}`
    // The texts of the closed list (ticket 08): the proposal shows what main will send.
    case 'wake-orchestrator':
      return item.subject.kind === 'session' ? WAKE_ORCHESTRATOR_TEXT : null
    case 'continue-session':
      return item.subject.kind === 'session' ? CONTINUE_SESSION_TEXT : null
    case 'fix-session':
      return item.source === 'ci' ? fixText(item) : null
    case 'summary':
      return null
    case 'pr-follow':
      return item.source === 'pr-inbox' && item.subject.kind === 'pr' ? `Follow ${item.subject.label}: Fix checks, Resolve conflicts or Address comments, as the pull request needs` : null
    case 'autopilot-start':
      return item.source === 'autopilot' ? 'Start Autopilot again: its dialog asks you to confirm' : null
  }
}

export class Duties {
  private memory: AssistantMemory | undefined
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: DutiesOptions) {}

  private load(): AssistantMemory {
    this.memory ??= this.options.store.read() ?? { duties: {}, rules: [], items: {} }
    return this.memory
  }

  private save(): void {
    const memory = this.load()
    const oldest = this.options.now() - ATTENTION_KEEP_DAYS * DAY
    memory.items = Object.fromEntries(Object.entries(memory.items).filter(([, counted]) => counted.shownAt >= oldest))
    this.options.store.write(memory)
  }

  private state(id: string): DutyState {
    const duties = this.load().duties
    return (duties[id] ??= { counters: zero(), streak: 0 })
  }

  /** The rules of a Project's settings that act. */
  projectRules(projectId: string): ProjectRule[] {
    return (this.options.projectRules?.(projectId) ?? []).filter((rule) => rule.enabled !== false)
  }

  private known(): Map<string, Known> {
    const known = new Map<string, Known>(BUILTIN_DUTIES.map((definition) => [definition.id, { definition, projectId: null }]))
    for (const projectId of this.options.projects?.() ?? []) {
      for (const rule of this.projectRules(projectId)) {
        const id = projectRuleDutyId(projectId, rule.id)
        known.set(id, { definition: { id, title: rule.title, trigger: { kind: 'rule', when: rule.when, quietMinutes: rule.quietMinutes }, actions: { open: 'hand-over' } }, projectId })
      }
    }
    return known
  }

  private definition(id: string): DutyDefinition {
    const known = this.known().get(id)
    if (known === undefined) throw new Error(`No duty ${id}`)
    return known.definition
  }

  /** The built-in duty whose trigger takes the event; null when none does. A rule's event names its duty itself. */
  dutyOf(event: Omit<AttentionEvent, 'at'>): string | null {
    for (const duty of BUILTIN_DUTIES) {
      if (duty.trigger.kind !== 'items') continue
      if (duty.trigger.match.some((match) => match.source === event.source && (match.kinds === undefined || match.kinds.includes(event.kind)))) return duty.id
    }
    return null
  }

  /** The threshold of a duty in force, in ms: the user's, else the duty's own; 0 for a duty without one. */
  thresholdMs(id: string): number {
    const chosen = this.load().duties[id]?.thresholdMinutes
    return (chosen ?? BUILTIN_DUTIES.find((duty) => duty.id === id)?.thresholdMinutes ?? 0) * MIN
  }

  /** Whether the user left the duty enabled; a duty is enabled until turned off. */
  enabled(id: string): boolean {
    return this.load().duties[id]?.enabled ?? true
  }

  /** Follows the user's choices of the duties (configure, setPauseAfter, resume); answers the function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /**
   * Changes what the user chose of a duty; a mode or an action the duty does not know, or a mode its action may not
   * have (DUTY_ACTION_ALLOWED_MODES: never `self` for `pr-follow`), throws, and nothing changes.
   */
  configure(id: string, choice: DutyChoice): void {
    const definition = this.definition(id)
    for (const [action, mode] of Object.entries(choice.modes ?? {}) as [DutyAction, DutyActionMode][]) {
      if (!(action in definition.actions)) throw new Error(`The duty ${id} has no action ${action}`)
      dutyActionModeSchema.parse(mode)
      if (!dutyActionModeAllowed(action, mode)) throw new Error(`The action ${action} may not be ${mode}: it may be ${DUTY_ACTION_ALLOWED_MODES[action].join(', ')}`)
    }
    // A threshold out of the bounds of the memory file (assistantMemorySchema) throws in change(), before anything changes.
    this.change((memory) => {
      const state = (memory.duties[id] ??= { counters: zero(), streak: 0 })
      if (choice.modes !== undefined) state.modes = { ...state.modes, ...choice.modes }
      if (choice.projects === 'all') delete state.projects
      else if (choice.projects !== undefined) state.projects = [...choice.projects]
      if (choice.thresholdMinutes !== undefined) state.thresholdMinutes = choice.thresholdMinutes
      if (choice.enabled !== undefined) state.enabled = choice.enabled
    })
  }

  /** How many ignored proposals or dislikes in a row pause a duty; a number the memory file refuses throws, and nothing changes. */
  setPauseAfter(count: number): void {
    this.change((memory) => {
      memory.pauseAfter = count
    })
  }

  /** How many ignored proposals or dislikes in a row pause a duty now: the user's number, else DEFAULT_PAUSE_AFTER. */
  pauseAfter(): number {
    return this.load().pauseAfter ?? DEFAULT_PAUSE_AFTER
  }

  /** Ends the pause of a duty; its run of ignored proposals and dislikes starts again from none. */
  resume(id: string): void {
    this.change((memory) => {
      const state = (memory.duties[id] ??= { counters: zero(), streak: 0 })
      delete state.paused
      endRun(state)
    })
  }

  /**
   * A choice of the user: made on a copy, checked by the schema of the memory file and written, and only then taken.
   * A value the file refuses — or a write that fails — throws and leaves the memory as it was.
   */
  private change(edit: (memory: AssistantMemory) => void): void {
    const next = structuredClone(this.load())
    edit(next)
    this.options.store.write(assistantMemorySchema.parse(next))
    this.memory = next
    for (const listener of [...this.listeners]) listener()
  }

  /** The rules drawn from dislikes, oldest first. */
  rules(): MemoryRule[] {
    return [...this.load().rules]
  }

  deleteRule(id: string): void {
    const memory = this.load()
    memory.rules = memory.rules.filter((rule) => rule.id !== id)
    this.save()
  }

  /** The user acted on an item's proposal or turned it down: counted once per item, and the run of ignored ones ends. */
  react(item: AttentionItem, reaction: 'accepted' | 'declined'): void {
    if (item.duty === null) return
    if (this.settle(item.duty, item.id, reaction)) this.save()
  }

  /** A like or a dislike of an item; a dislike answers the rule it wrote in the memory file. */
  rate(item: AttentionItem, rating: 'like' | 'dislike'): MemoryRule | null {
    if (item.duty === null) return null
    const state = this.state(item.duty)
    if (rating === 'like') {
      state.counters.liked += 1
      endRun(state)
      this.save()
      return null
    }
    state.counters.disliked += 1
    this.extend(state, 'disliked')
    const memory = this.load()
    let rule = memory.rules.find((each) => each.duty === item.duty && each.projectId === item.projectId && each.source === item.source && each.kind === item.kind)
    if (rule === undefined) {
      const title = this.known().get(item.duty)?.definition.title ?? item.duty
      rule = {
        id: randomUUID(),
        duty: item.duty,
        projectId: item.projectId,
        source: item.source,
        kind: item.kind,
        text: `Do not show «${item.kind}» items of ${item.source} in «${title}»${item.projectId === null ? '' : ` for the Project ${item.projectId}`}`,
        createdAt: this.options.now(),
        from: item.id,
      }
      memory.rules.push(rule)
    }
    this.save()
    return rule
  }

  /**
   * Takes back a like or a dislike that rate() counted for the item (worfy-assistant ticket 14): its counter; for a
   * dislike also its step of the run of dislikes — only while `run`, the run it was counted in (runOf), is still the
   * current one — and the pause that run began when it falls short again; and the rule `ruleId` when this item wrote it
   * (the caller passes null while another rating still holds that rule). A like's end of a run is not taken back.
   */
  unrate(duty: string, itemId: string, rating: 'like' | 'dislike', ruleId: string | null, run?: number): void {
    const memory = this.load()
    const state = memory.duties[duty]
    if (state !== undefined) {
      if (rating === 'like') state.counters.liked = Math.max(0, state.counters.liked - 1)
      else {
        state.counters.disliked = Math.max(0, state.counters.disliked - 1)
        if (run === (state.run ?? 0)) {
          state.streak = Math.max(0, state.streak - 1)
          if (state.paused?.by === 'disliked' && state.streak < (memory.pauseAfter ?? DEFAULT_PAUSE_AFTER)) delete state.paused
        }
      }
    }
    if (ruleId !== null) memory.rules = memory.rules.filter((rule) => rule.id !== ruleId || rule.from !== itemId)
    this.save()
  }

  /** The number of the duty's current run of ignored proposals and dislikes (unrate). */
  runOf(duty: string): number {
    return this.load().duties[duty]?.run ?? 0
  }

  /** Counts what became of an item once; false when it was counted before. */
  private settle(duty: string, itemId: string, outcome: 'accepted' | 'declined' | 'ignored'): boolean {
    const memory = this.load()
    const state = this.state(duty)
    let counted = memory.items[itemId]
    // An item glued into another duty (attention-core.ts) is a new item for that duty's counters.
    if (counted === undefined || counted.duty !== duty) {
      counted = memory.items[itemId] = { duty, shownAt: this.options.now() }
      state.counters.shown += 1
    }
    if (counted.outcome !== undefined) return false
    counted.outcome = outcome
    state.counters[outcome] += 1
    if (outcome === 'ignored') this.extend(state, 'ignored')
    else endRun(state)
    return true
  }

  /** One more ignored proposal or dislike in a row; the duty pauses at `pauseAfter`. */
  private extend(state: DutyState, by: 'ignored' | 'disliked'): void {
    state.streak += 1
    if (state.paused === undefined && state.streak >= (this.load().pauseAfter ?? DEFAULT_PAUSE_AFTER)) state.paused = { at: this.options.now(), by }
  }

  /**
   * What the duties show of `items` now (and the state of each duty); counts what is shown and what was ignored.
   * `countShown: false` counts no item as shown: the section's view, the Assistant's reads (`worfy-app` items_list and
   * action_run) and the closed list pass it (worfy-assistant ticket 14). An item counts as shown only when the window
   * showed it to the user — the section's own call of look (AssistantWindow.shown), with the default. An item counted as
   * shown before still counts as ignored a day later, and a dismissed one as declined.
   */
  look(items: readonly AttentionItem[], { countShown = true }: { countShown?: boolean } = {}): DutyLook {
    const now = this.options.now()
    const known = this.known()
    const memory = this.load()
    let changed = false
    const shown: ShownItem[] = []
    for (const item of items) {
      const duty = item.duty === null ? undefined : known.get(item.duty)
      if (duty === undefined) continue
      const id = duty.definition.id
      const state = memory.duties[id]
      if (item.state === 'dismissed') {
        // Dismiss is a reaction: it turns down the proposal of the duty that showed it.
        const shownBy = memory.items[item.id]?.duty
        if (shownBy !== undefined) changed = this.settle(shownBy, item.id, 'declined') || changed
        continue
      }
      if (item.state !== 'new' && item.state !== 'seen') continue
      if (state?.enabled === false || state?.paused !== undefined) continue
      if (state?.projects !== undefined && (item.projectId === null || !state.projects.includes(item.projectId))) continue
      // From the latest event glued into the item: a question at noon after a turn-end at ten waits from noon.
      if (item.source === 'session' && WAITED_KINDS.has(item.kind) && now - (item.lastAt ?? item.startedAt) < this.thresholdMs(id)) continue
      if (memory.rules.some((rule) => rule.duty === id && rule.projectId === item.projectId && rule.source === item.source && rule.kind === item.kind)) continue
      const counted = memory.items[item.id]
      if (counted === undefined || counted.duty !== id) {
        if (!countShown) {
          shown.push({ item, duty: id, proposals: this.proposals(duty.definition, item) })
          continue
        }
        memory.items[item.id] = { duty: id, shownAt: now }
        this.state(id).counters.shown += 1
        changed = true
      } else if (counted.outcome === undefined && now - counted.shownAt >= IGNORED_AFTER_MS) {
        changed = this.settle(id, item.id, 'ignored') || changed
      }
      shown.push({ item, duty: id, proposals: this.proposals(duty.definition, item) })
    }
    if (changed) this.save()
    const duties = [...known.values()].map((each) => this.status(each))
    const paused = new Set(duties.filter((duty) => duty.paused !== null).map((duty) => duty.id))
    return { duties, shown: shown.filter((each) => !paused.has(each.duty)) }
  }

  private proposals(definition: DutyDefinition, item: AttentionItem): DutyProposal[] {
    const modes = { ...definition.actions, ...this.load().duties[definition.id]?.modes }
    const proposals: DutyProposal[] = []
    for (const [action, mode] of Object.entries(modes) as [DutyAction, DutyActionMode][]) {
      const text = proposalText(action, item)
      if (text !== null) proposals.push({ action, mode, text })
    }
    return proposals
  }

  private status({ definition, projectId }: Known): DutyStatus {
    const state = this.load().duties[definition.id]
    return {
      id: definition.id,
      title: definition.title,
      projectId,
      trigger: definition.trigger,
      scope: { projects: state?.projects ?? 'all', sources: triggerSources(definition.trigger) },
      modes: { ...definition.actions, ...state?.modes },
      thresholdMinutes: state?.thresholdMinutes ?? definition.thresholdMinutes ?? null,
      enabled: state?.enabled ?? true,
      counters: { ...zero(), ...state?.counters },
      paused: state?.paused ?? null,
    }
  }
}
