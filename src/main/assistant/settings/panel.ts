// Settings → Assistant in main (worfy-assistant ticket 15): the view the section draws besides the app settings
// (src/shared/assistant/settings-view.ts), and a change of the settings the user applied under a card «before → after»
// (src/shared/assistant/settings-change.ts). Nothing here keeps state of its own: the duties keep theirs in the memory
// file (Duties), the checks their marks (CheckScheduler, assistant-check-marks.json), the usage its ledger.
import { DUTY_ACTION_ALLOWED_MODES, type DutyAction, type DutyActionMode } from '../../../shared/assistant/duties'
import type { LimitsShareEstimate, TokenTotals, UsagePeriod, UsageSummary } from '../../../shared/assistant/budget'
import { CHECK_KINDS, SOURCE_CHECK_KINDS } from '../../../shared/assistant/schedule/settings'
import { dutyChangeProblems, settingsPatchOf, type SettingsChange, type SettingsRestore } from '../../../shared/assistant/settings-change'
import type { AssistantSettingsView, TokenCount, UsagePeriodView } from '../../../shared/assistant/settings-view'
import { SOURCE_LABELS } from '../../../shared/assistant/window'
import type { AppSettingsPatch } from '../../../shared/settings/app-settings'
import type { DutyStatus } from '../../../shared/assistant/duties'
import type { Duties, DutyChoice } from '../duties/duties'
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

const OUTSIDE_SOURCES: ReadonlySet<string> = new Set(SOURCE_CHECK_KINDS)

/**
 * Whether a duty's scope is by Project (ticket 25): a built-in duty over items of worfy's own sources. A rule of a Project
 * is of that Project already, the morning summary has no items, and the items of a check of an outside source (Slack,
 * Jira) belong to no Project — a choice of Projects would hide them all.
 */
export function dutyScopedByProject(duty: Pick<DutyStatus, 'projectId' | 'trigger'>): boolean {
  if (duty.projectId !== null || duty.trigger.kind !== 'items') return false
  return duty.trigger.match.every((each) => !OUTSIDE_SOURCES.has(each.source))
}

/**
 * Checks a choice of Projects of a duty before Duties.configure (ticket 25): only a duty scoped by Project takes one, and
 * only Projects of this Machine — a Linked machine's items are only read here (ticket 18). Throws, with the reason.
 */
export function checkDutyProjects(dutyId: string, choice: DutyChoice, deps: { duties: Pick<Duties, 'look'>; projects(): readonly { id: string }[] }): void {
  if (choice.projects === undefined) return
  const duty = deps.duties.look([], { countShown: false }).duties.find((each) => each.id === dutyId)
  if (duty === undefined) throw new Error(`There is no duty ${dutyId}`)
  if (!dutyScopedByProject(duty)) throw new Error(`The duty «${duty.title}» does not cover Projects`)
  if (choice.projects === 'all') return
  if (choice.projects.length === 0) throw new Error('Choose at least one Project, or All Projects')
  const known = new Set(deps.projects().map((project) => project.id))
  const foreign = choice.projects.filter((id) => !known.has(id))
  if (foreign.length > 0) throw new Error(`Not a Project of this Machine: ${foreign.join(', ')}`)
}

/** Percent with one decimal, so a share under one percent still shows. */
const percent = (share: number): number => Math.round(share * 1000) / 10

/** What the section shows now. */
export function assistantSettingsView(deps: SettingsPanelDeps): AssistantSettingsView {
  const projects = deps.projects()
  const names = new Map(projects.map((project) => [project.id, project.name]))
  const usage = deps.usage()
  return {
    running: deps.running(),
    projects: projects.map((project) => ({ id: project.id, name: project.name })),
    duties: deps.duties.look([], { countShown: false }).duties.map((duty) => ({
      id: duty.id,
      title: duty.title,
      projectId: duty.projectId,
      projectName: duty.projectId === null ? null : (names.get(duty.projectId) ?? null),
      sources: duty.scope.sources.map((source) => SOURCE_LABELS[source] ?? source),
      projects: dutyScopedByProject(duty) ? (duty.scope.projects === 'all' ? 'all' : [...duty.scope.projects]) : null,
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
 * Applies a change the user applied under its card, or its Undo (ticket 25): first checked whole — a duty there is not,
 * an action it has not, a mode its action may not have throw and change nothing — then the app settings, then each duty.
 */
export function applySettingsChange(change: SettingsChange | SettingsRestore, deps: ApplyDeps): void {
  const problems = dutyChangeProblems(change, deps.duties.look([], { countShown: false }).duties)
  if (problems.length > 0) throw new Error(`The change cannot apply: ${problems.join('; ')}`)
  const patch = settingsPatchOf(change)
  if (patch !== null) deps.setSettings(patch)
  for (const [id, duty] of Object.entries(change.duties ?? {})) deps.duties.configure(id, duty)
}
