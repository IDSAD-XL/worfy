// The decision to wake the Assistant in the running app (worfy-assistant ticket 06): the planner (planner.ts) over
// the app's attention core, Limits, usage ledger and work hours, run by the loop (loop.ts).
//
// Nothing starts it yet: the Assistant is off until the user turns it on (ADR-0114, decision 10), and its Session is
// ticket 10. That ticket calls startAssistantWake() with the function that starts a Session on each wake; the closed
// list of actions (ticket 08) calls escalate() of the answer, the conversation (ticket 14) userMessage().
import { join } from 'node:path'
import { workHoursOf } from '../../../shared/assistant/schedule/settings'
import { dailyWakeLimitOf } from '../../../shared/assistant/settings'
import { appLimits } from '../../agent/limits'
import { appNow } from '../../clock'
import { projectStore } from '../../projects/store'
import { appSettingsStore } from '../../settings/store'
import { dataRoot } from '../../storage/paths'
import { appAssistantUsage } from '../budget/ledger'
import { appAttentionCore } from '../core/app'
import type { PowerEvents } from '../schedule/scheduler'
import { fileWakeStore, onResume, onSettingsChange, runWakeLoop, WAKE_FILE, type WakeLoop } from './loop'
import { WakePlanner, type AssistantWake } from './planner'

/**
 * Starts the decision to wake over the app's attention core and follows the system's wake (`power`: Electron's
 * powerMonitor); null while the core is not running.
 */
export function startAssistantWake(onWake: (wake: AssistantWake) => void, power: PowerEvents): WakeLoop | null {
  const core = appAttentionCore()
  if (core === null) return null
  const projects = projectStore()
  const limits = appLimits()
  const planner = new WakePlanner({
    now: appNow,
    items: () => [null, ...projects.list().map((project) => project.id)].flatMap((scope) => core.items(scope)),
    workHours: () => workHoursOf(appSettingsStore().get()),
    limits: () => limits.snapshot(),
    ledger: appAssistantUsage(),
    store: fileWakeStore(join(dataRoot(), WAKE_FILE)),
    dailyWakeLimit: () => dailyWakeLimitOf(appSettingsStore().get()),
  })
  return runWakeLoop({ planner, now: appNow, onWake, changes: [(listener) => core.subscribe(listener), (listener) => limits.subscribe(listener), onResume(power), onSettingsChange(appSettingsStore())] })
}
