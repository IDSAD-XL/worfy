// The closed list of actions in the running app (worfy-assistant ticket 08): the closed list over the app's attention core,
// duties, Sessions, Limits and journal file, the Limits waits of the Sessions on the Canvas, and main's automatic pass.
//
// Nothing starts it yet, as nothing starts the decision to wake (src/main/assistant/wake/app.ts): the Assistant is off
// until the user turns it on (ADR-0114, decision 10). The ticket that turns it on (10, the Session of the Assistant)
// calls startClosedList() with the escalation of its wake loop (WakeLoop.escalate); `worfy-app` (ticket 09) and the
// window (ticket 14) call appClosedList().act() — the one door, with `by: 'assistant'` and `by: 'user'`.
import { appLimits } from '../../agent/limits'
import { sharedOrchestratorContinue } from '../../agent/app-orchestrators'
import { sharedRegistry } from '../../agent/app-registry'
import { appNow } from '../../clock'
import { projectStore } from '../../projects/store'
import { dataRoot } from '../../storage/paths'
import { appAttentionCore } from '../core/app'
import { appDuties } from '../duties/app'
import type { PowerEvents } from '../schedule/scheduler'
import { onResume } from '../wake/loop'
import { runClosedListAuto } from './auto'
import { ClosedList, type ActionTarget } from './closed-list'
import { actionJournalFile, actionJournalPath } from './journal'
import { LimitsWaits } from './limits-waits'

interface Running {
  list: ClosedList
  waits: LimitsWaits
}

let running: Running | null = null

/** The closed list of the running app; null until startClosedList (and while the attention core is not running). */
export function appClosedList(): ClosedList | null {
  return running?.list ?? null
}

/** The Limits waits of the Sessions on the Canvas, for the window (ticket 14); null until startClosedList. */
export function appLimitsWaits(): LimitsWaits | null {
  return running?.waits ?? null
}

const liveSession = <T>(sessionId: string, take: (session: ReturnType<ReturnType<typeof sharedRegistry>['get']>) => T): T | null => {
  try {
    return take(sharedRegistry().get(sessionId))
  } catch {
    return null
  }
}

/**
 * Starts the closed list over the app (the attention core must run: startAttentionCore) and main's automatic pass;
 * `escalate` wakes the model of the Assistant for an item the closed list did not help with. Answers the stop; null
 * while the core is not running.
 */
export function startClosedList(options: { escalate?: (itemId: string) => void; power: PowerEvents }): (() => void) | null {
  const core = appAttentionCore()
  if (core === null || running !== null) return null
  const projects = projectStore()
  const registry = sharedRegistry()
  const limits = appLimits()
  const continuer = sharedOrchestratorContinue()
  const observe = registry.observe.bind(registry)
  const shown = () => appDuties().look([null, ...projects.list().map((project) => project.id)].flatMap((scope) => core.items(scope))).shown
  const waits = new LimitsWaits({
    observe,
    isOrchestrator: (sessionId) => projects.list().some((project) => continuer.sessionOf(project.id) === sessionId),
    session: (sessionId) => liveSession(sessionId, (session) => session),
    limits: () => limits.snapshot(),
    now: appNow,
  })
  const list = new ClosedList({
    now: appNow,
    shown,
    orchestratorOf: (projectId) => continuer.sessionOf(projectId),
    session: (sessionId) => liveSession<ActionTarget>(sessionId, (session) => session),
    limits: () => limits.snapshot(),
    continuing: (projectId) => continuer.wait(projectId) !== null,
    waits,
    journal: actionJournalFile(actionJournalPath(dataRoot()), appNow),
    ...(options.escalate === undefined ? {} : { escalate: options.escalate }),
  })
  const loop = runClosedListAuto({
    list,
    shown,
    observe,
    now: appNow,
    changes: [(listener) => core.subscribe(listener), (listener) => limits.subscribe(listener), (listener) => waits.observeWaits(listener), onResume(options.power)],
  })
  running = { list, waits }
  return () => {
    loop.stop()
    waits.stop()
    running = null
  }
}
