// Settings → Assistant in main (worfy-assistant ticket 15): the view the section draws besides the app settings
// (src/shared/assistant/settings-view.ts), and a change of the settings the user applied under a card «before → after»
// (src/shared/assistant/settings-change.ts). Nothing here keeps state of its own: the duties keep theirs in the memory
// file (Duties), the checks their marks (CheckScheduler, assistant-check-marks.json), the usage its ledger.
import { DUTY_ACTION_ALLOWED_MODES, type DutyAction, type DutyActionMode } from '../../../shared/assistant/duties'
import type { LimitsShareEstimate, TokenTotals, UsagePeriod, UsageSummary } from '../../../shared/assistant/budget'
import { CHECK_KINDS } from '../../../shared/assistant/schedule/settings'
import { dutyChangeProblems, settingsPatchOf, type SettingsChange } from '../../../shared/assistant/settings-change'
import type { AssistantSettingsView, TokenCount, UsagePeriodView } from '../../../shared/assistant/settings-view'
import { SOURCE_LABELS } from '../../../shared/assistant/window'
import type { AppSettingsPatch } from '../../../shared/settings/app-settings'
import type { Duties } from '../duties/duties'
import type { CheckScheduler } from '../schedule/scheduler'

export interface SettingsPanelDeps {
  /** Whether the Assistant runs now (appAssistant). */
  running(): boolean
  duties: Pick<Duties, 'look' | 'rules' | 'pauseAfter'>
  /** The Projects of this Machine, for the names of the rules of a Project. */
  projects(): readonly { id: string; name: string }[]
  checks: Pick<CheckScheduler, 'failures' | 'nextRun' | 'running'>
  usage(): UsageSummary
  /** The Assistant's estimated share of each Limits window in force. */
  shares(): readonly LimitsShareEstimate[]
  wakesToday(): number
}

const count = (totals: TokenTotals): TokenCount => ({ tokens: totals.tokens, calls: totals.calls })

function period(of: UsagePeriod): UsagePeriodView {
  return {
    from: of.from,
    total: count(of.total),
    sources: Object.entries(of.sources)
      .map(([source, totals]) => ({ source, ...count(totals) }))
      .sort((a, b) => b.tokens - a.tokens || a.source.localeCompare(b.source)),
    wakes: {
      count: of.wakes.count,
      total: count(of.wakes.total),
      byWake: of.wakes.byWake.map((wake) => ({ id: wake.id, at: wake.at, urgent: wake.urgent, tokens: wake.total.tokens })).reverse(),
    },
    conversation: count(of.conversation),
  }
}

/** Percent with one decimal, so a share under one percent still shows. */
const percent = (share: number): number => Math.round(share * 1000) / 10

/** What the section shows now. */
export function assistantSettingsView(deps: SettingsPanelDeps): AssistantSettingsView {
  const names = new Map(deps.projects().map((project) => [project.id, project.name]))
  const usage = deps.usage()
  return {
    running: deps.running(),
    duties: deps.duties.look([], { countShown: false }).duties.map((duty) => ({
      id: duty.id,
      title: duty.title,
      projectId: duty.projectId,
      projectName: duty.projectId === null ? null : (names.get(duty.projectId) ?? null),
      sources: duty.scope.sources.map((source) => SOURCE_LABELS[source] ?? source),
      enabled: duty.enabled,
      thresholdMinutes: duty.thresholdMinutes,
      actions: (Object.entries(duty.modes) as [DutyAction, DutyActionMode][]).map(([action, mode]) => ({ action, mode, allowed: [...DUTY_ACTION_ALLOWED_MODES[action]] })),
      counters: duty.counters,
      paused: duty.paused,
    })),
    pauseAfter: deps.duties.pauseAfter(),
    rules: deps.duties.rules().map((rule) => ({ id: rule.id, text: rule.text, duty: rule.duty, createdAt: rule.createdAt })),
    checks: CHECK_KINDS.map((kind) => ({ kind, failures: deps.checks.failures(kind), nextAt: deps.checks.nextRun(kind), running: deps.checks.running(kind) })),
    wakesToday: deps.wakesToday(),
    usage: {
      day: period(usage.day),
      week: period(usage.week),
      shares: deps.shares().map((share) => ({ window: share.window, utilization: percent(share.utilization), share: percent(share.share) })),
      estimate: true,
    },
  }
}

export interface ApplyDeps {
  duties: Pick<Duties, 'look' | 'configure'>
  /** The app settings of this Machine (AppSettingsStore.set): throws when it refuses. */
  setSettings(patch: AppSettingsPatch): void
}

/**
 * Applies a change the user applied under its card: first checked whole — a duty there is not, an action it has not, a
 * mode its action may not have throw and change nothing — then the app settings, then each duty.
 */
export function applySettingsChange(change: SettingsChange, deps: ApplyDeps): void {
  const problems = dutyChangeProblems(change, deps.duties.look([], { countShown: false }).duties)
  if (problems.length > 0) throw new Error(`The change cannot apply: ${problems.join('; ')}`)
  const patch = settingsPatchOf(change)
  if (patch !== null) deps.setSettings(patch)
  for (const [id, duty] of Object.entries(change.duties ?? {})) deps.duties.configure(id, duty)
}
