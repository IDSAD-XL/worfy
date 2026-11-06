// The facts of the Start Autopilot window (`autopilot.prepare`, worfy-autopilot-queue ticket 09): what
// the window shows before a start. The sources are those of the autopilot_start dialog
// (appAutopilotStarter, chat-confirm.ts): a fresh workflow read, the Project's recent run journals, the
// app's Limits, Settings → Autopilot and the Vendor the Orchestrator runs on; the forecast lines are made
// the same way as that dialog's (forecastLines there), so both say the same words. To them come the
// Orchestrator's saved Session and what keeps it busy now (Orchestrators.busy, ticket 07).
//
// Several Epics (a queue, tickets 13–15) count one after another: their Waves left follow each other,
// and the forecast is drawn over all of them. Named Tickets go with one Epic only. An Epic or a named
// Ticket the Project does not have is refused, as a start would be (startRefusal). Journals that cannot
// be read leave the forecast lines out; the window still opens. Nothing here writes.
import type { LimitsState } from '../../shared/agent/limits'
import type { AutopilotBudget } from '../../shared/autopilot/budget'
import { BUDGET_FRESH_MS } from '../../shared/autopilot/budget'
import { budgetWindows, type VendorLimits } from '../../shared/autopilot/budget-window'
import { epicForecast, remainingWaves, type RemainingWaves } from '../../shared/autopilot/forecast'
import { dialogLines } from '../../shared/autopilot/forecast-lines'
import type { JournalEvent } from '../../shared/autopilot/journal'
import { usedNowText, waveSamples, type WeekNow } from '../../shared/autopilot/limits-estimate'
import { toMs } from '../../shared/autopilot/resume-at'
import { waveDurationP90 } from '../../shared/autopilot/wave-duration'
import type { AutopilotPrepareAnswer, AutopilotPrepareInput } from '../../shared/ipc/autopilot-prepare'
import type { AutopilotRunSettings } from '../../shared/settings/app-settings'
import type { VendorId } from '../../shared/vendors/vendor'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { OrchestratorBusy } from '../agent/orchestrator'
import { startRefusal } from './run'

/** What the facts are read from; the app's are in src/main/ipc/autopilot-prepare.ts, tests pass their own. */
export interface PrepareSources {
  /** The Project's name, as its list shows it; throws for a Project that is not in the list. */
  projectName(projectId: string): string
  /** A fresh read of the Project's Epics and Tickets. */
  workflow(projectId: string): Promise<Pick<WorkflowModel, 'epics' | 'tickets' | 'error'>>
  /** The events of the Project's recent runs, one list per journal (readRecentRuns); a rejection leaves the forecast lines out. */
  runs(projectId: string): Promise<JournalEvent[][]>
  /** The app's Limits now (Claude's). */
  limits(): LimitsState
  /** Settings → Autopilot: the default Run mode and the Start window, and the budget with its reserve. */
  settings(): { run: AutopilotRunSettings; budget: AutopilotBudget }
  now(): number
  /** The Vendor the Project's Orchestrator runs on (Orchestrators.runsOn). */
  vendor(projectId: string): VendorId
  /** That Vendor's windows when it is not Claude (appVendorLimits); undefined on Claude. */
  vendorLimits(projectId: string): VendorLimits | undefined
  /** The Orchestrator's saved Session id; null before its first Session. */
  session(projectId: string): string | null
  /** What keeps the Orchestrator busy now (Orchestrators.busy); null when it is free. */
  busy(projectId: string): OrchestratorBusy | null
}

/** The week of the forecast's "Used now": the budget window when its number is fresh, as forecast-lines.ts reads it. */
function weekNow(limits: LimitsState, now: number, vendor: VendorLimits | undefined): WeekNow | null {
  const week = budgetWindows(limits, vendor).week
  if (week === null || week.utilization === null || now - week.receivedAt > BUDGET_FRESH_MS) return null
  return { utilization: week.utilization, resetsAt: week.resetsAt === null ? null : toMs(week.resetsAt) / 1000 }
}

/** The Waves left of each Epic, one after another, as one plan. */
function joined(left: readonly RemainingWaves[]): RemainingWaves {
  return { waves: left.flatMap((each) => each.waves), uncounted: left.flatMap((each) => each.uncounted) }
}

/** The facts of the window for `input`; throws the refusal for an Epic or a Ticket the Project does not have. */
export async function prepareAutopilot(sources: PrepareSources, { projectId, epics, tickets }: AutopilotPrepareInput): Promise<AutopilotPrepareAnswer> {
  const name = sources.projectName(projectId)
  const model = await sources.workflow(projectId)
  if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
  for (const epic of epics) {
    const refusal = startRefusal(model, epic, tickets)
    if (refusal !== null) throw new Error(refusal)
  }
  const settings = sources.settings()
  const now = sources.now()
  const limits = sources.limits()
  const vendor = sources.vendorLimits(projectId)
  const left = epics.map((epic) => remainingWaves(model.tickets, epic, tickets))
  let runs: JournalEvent[][] | null
  try {
    runs = await sources.runs(projectId)
  } catch (error) {
    console.warn(`[autopilot] ${projectId}: the start window shows no forecast, the run journals cannot be read`, error)
    runs = null
  }
  const forecast = epicForecast({ samples: runs === null ? [] : waveSamples(runs, vendor?.vendor), waves: joined(left) })
  const wave = runs === null ? null : waveDurationP90(runs)
  const lines =
    wave === null ? [] : dialogLines({ forecast, wave, limits, now, reserve: settings.budget.reserve, window: settings.run.window, ...(vendor === undefined ? {} : { vendor }) })
  const week = weekNow(limits, now, vendor)
  const busy = sources.busy(projectId)
  return {
    project: { id: projectId, name },
    epics: epics.map((epic, index) => ({
      epic,
      tickets: model.tickets
        .filter((ticket) => ticket.epic === epic && ticket.state !== 'done' && (tickets === undefined || tickets.includes(ticket.num)))
        .map((ticket) => ticket.num)
        .sort((a, b) => a - b),
      waves: left[index]?.waves.length ?? 0,
      accepted: null,
    })),
    orchestrator: { vendor: sources.vendor(projectId), session: sources.session(projectId) },
    forecast: { lines, waves: forecast.waves, range: forecast.range, duration: wave === null || wave.p90 === null ? null : wave.p90 * forecast.waves },
    budget: { enabled: settings.budget.enabled, reserve: settings.budget.reserve },
    limits: { utilization: week?.utilization ?? null, text: usedNowText(week, now) },
    mode: settings.run.mode,
    window: { from: settings.run.window.from, to: settings.run.window.to },
    busy: busy === null ? null : { turn: busy.turn, queued: busy.queued, tasks: busy.tasks.map((task) => ({ id: task.taskId, type: task.taskType, description: task.description })) },
  }
}
