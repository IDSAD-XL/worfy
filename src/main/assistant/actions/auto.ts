// What main does from the closed list by itself (worfy-assistant ticket 08; owner's decisions 1, 13 and 21): no model, by
// the mode of the duty whose item proposes the action. Each look goes over what the duties show; an action whose mode is
// `self` or `pre-approved` goes through the closed list (closed-list.ts) with `by: 'main'` once its checks hold — before
// that, check() writes nothing, so a Session that is busy for an hour fills no journal.
//
// - continue-session: a Session on the Canvas whose wait for the Limits is due (limits-waits.ts) is continued.
// - wake-orchestrator: an idle Orchestrator, with no background task alive and the Limits free, is woken once. The wake
//   helped when the Orchestrator starts a Subagent after it, or a person writes to it: its next stop is a new one. When
//   it stands again with neither — or after WAKES_PER_DAY wakes in 24 hours — the closed list did not help: the item
//   is escalated once (the model of the Assistant wakes for it, ticket 06), and no further wake goes.
//
// A look runs after each change of what main follows (the items, the Limits, the waits, the Mac's wake) and every
// AUTO_LOOK_MS: the reset of the Limits comes by the clock, with no event.
import type { AgentEvent } from '../../../shared/agent/events'
import { isClosedAction, WAKE_ORCHESTRATOR_TEXT, type ActionRequest } from '../../../shared/assistant/actions'
import type { ShownItem } from '../../../shared/assistant/duties'
import type { EventSink } from '../../agent/session/types'
import type { ClosedList } from './closed-list'

/** How often a look runs without a change: once a minute. Decided without the owner (ticket 08, result section). */
export const AUTO_LOOK_MS = 60_000

/**
 * The most wakes of one Orchestrator in 24 hours; past it the item is escalated instead. Six: one per 5-hour window of
 * a day and night with one to spare. Decided without the owner (ticket 08, result section).
 */
export const WAKES_PER_DAY = 6

const DAY_MS = 24 * 60 * 60_000

export interface ClosedListAutoDeps {
  list: Pick<ClosedList, 'check' | 'act' | 'escalate' | 'journal'>
  /** What the duties show now (Duties.look over every item of the attention core). */
  shown(): readonly ShownItem[]
  /** Every event of every Session (SessionRegistry.observe): what an Orchestrator did after its wake. */
  observe(sink: EventSink): () => void
  /** What may make an action due besides the clock; each answers its unsubscribe. */
  changes: readonly ((listener: () => void) => () => void)[]
  now(): number
  setTimer?(run: () => void, ms: number): unknown
  clearTimer?(timer: unknown): void
  log?(message: string, error: unknown): void
}

export interface ClosedListAuto {
  /** One pass over what the duties show. */
  look(): void
  stop(): void
}

export function runClosedListAuto(deps: ClosedListAutoDeps): ClosedListAuto {
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const log = deps.log ?? ((message, error) => console.warn(message, error))
  /** The Orchestrators woken whose wake has not yet shown it helped. */
  const woken = new Set<string>()
  let timer: unknown
  let soon: unknown
  let stopped = false

  const helped = (sessionId: string, event: AgentEvent): void => {
    if (!woken.has(sessionId)) return
    const person = event.type === 'prompt' && event.text !== WAKE_ORCHESTRATOR_TEXT
    const started = (event.type === 'subagent' && event.phase === 'started') || (event.type === 'background_tasks_changed' && event.tasks.some((task) => !task.ambient))
    if (person || started) woken.delete(sessionId)
  }

  const wakesToday = (sessionId: string, now: number): number =>
    deps.list.journal().filter((line) => line.action === 'wake-orchestrator' && line.outcome === 'done' && line.sessionId === sessionId && line.at > now - DAY_MS).length

  const escalatedBefore = (itemId: string): boolean => deps.list.journal().some((line) => line.outcome === 'escalated' && line.item === itemId)

  const pass = (): void => {
    for (const shown of deps.shown()) {
      for (const proposal of shown.proposals) {
        if (!isClosedAction(proposal.action) || (proposal.mode !== 'self' && proposal.mode !== 'pre-approved')) continue
        const request: ActionRequest = { action: proposal.action, itemId: shown.item.id, by: 'main' }
        if (deps.list.check(request) !== null) continue
        if (proposal.action === 'continue-session') {
          deps.list.act(request)
          continue
        }
        const target = shown.item.subject.id
        if (woken.has(target) || wakesToday(target, deps.now()) >= WAKES_PER_DAY) {
          if (!escalatedBefore(shown.item.id)) deps.list.escalate(shown.item.id)
          continue
        }
        if (deps.list.act(request).ok) woken.add(target)
      }
    }
  }

  function look(): void {
    if (stopped) return
    try {
      pass()
    } catch (error) {
      log('[assistant] the closed list could not look at the items', error)
    }
  }
  const tick = (): void => {
    look()
    if (!stopped) timer = setTimer(tick, AUTO_LOOK_MS)
  }
  const lookSoon = (): void => {
    if (soon !== undefined || stopped) return
    soon = setTimer(() => {
      soon = undefined
      look()
    }, 0)
  }
  const unsubscribe = [deps.observe(helped), ...deps.changes.map((subscribe) => subscribe(lookSoon))]
  timer = setTimer(tick, AUTO_LOOK_MS)
  return {
    look,
    stop: () => {
      stopped = true
      for (const each of unsubscribe) each()
      if (timer !== undefined) clearTimer(timer)
      if (soon !== undefined) clearTimer(soon)
    },
  }
}
