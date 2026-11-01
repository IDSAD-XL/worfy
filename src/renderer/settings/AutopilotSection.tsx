// Settings → Autopilot (worfy-throughput ticket 41, worfy-resource-planner ticket 04): the default Run
// mode, the Start window and the budget of the Limits. "Default run mode" — the mode a Run of
// Autopilot starts in unless the start dialog picks another (src/shared/autopilot/run-mode.ts);
// "Start window from" and "to" — the whole local hours new Waves start between in Start window mode,
// 23:00–07:00 at first, enabled only while that mode is the default. "Daily budget" — whether a run
// starts no Wave once today's share of the week is used (src/shared/autopilot/budget.ts: the week left
// after the reserve, spread over the days until the 7-day window resets); "Reserve for your own work"
// — the share of the week Autopilot leaves to the person, enabled while the budget is on or the
// default mode is Budget-aware, which applies the budget whatever the switch says. They are app
// settings of this Machine (`autopilotRun` and `autopilotBudget`, src/shared/settings/app-settings.ts):
// main reads them before every Wave of a run. A choice is kept as the person's own; while no mode is
// chosen the default follows the budget switch (Budget-aware on, Fastest off). A reserve set outside
// the offered values (by hand in app-settings.json) is shown as it is. A window edge picked at the
// other edge's hour is not sent: the window would be empty.
import { useState } from 'react'
import { hourText, RUN_MODE_LABELS, RUN_MODES, type RunMode } from '../../shared/autopilot/run-mode'
import { autopilotBudgetOf, autopilotRunOf, START_WINDOW_SAME_HOURS, type AppSettingsPatch } from '../../shared/settings/app-settings'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 68
export const title = 'Autopilot'

export const MODE_LABEL = 'Default run mode'
export const WINDOW_FROM_LABEL = 'Start window from'
export const WINDOW_TO_LABEL = 'Start window to'
export const BUDGET_LABEL = 'Daily budget of the Limits'
export const RESERVE_LABEL = 'Reserve for your own work'

/** What each mode does, under "Default run mode" (spec of worfy-resource-planner, Settings → Autopilot). */
const MODE_DESCRIPTIONS: Readonly<Record<RunMode, string>> = {
  fastest: 'Waves go one after another: no budget, no window.',
  'budget-aware': 'The daily budget of the Limits, with the reserve.',
  'start-window': 'New Waves start only between the times below; the daily budget too, when it is on.',
}

const MODE_OPTIONS: SelectOption<RunMode>[] = RUN_MODES.map((mode) => ({ value: mode, label: RUN_MODE_LABELS[mode] }))

/** The hours of the window, 00:00 … 23:00. */
const HOUR_OPTIONS: SelectOption[] = Array.from({ length: 24 }, (_unused, hour) => ({ value: String(hour), label: hourText(hour) }))

/** The offered reserves, in percent of the week. */
const RESERVES = [0, 5, 10, 15, 20, 25, 30, 40, 50] as const

/** The options of the reserve, with the current one among them when it is not one of the offered. */
function reserveOptions(current: number): SelectOption[] {
  return [...new Set<number>([...RESERVES, current])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: `${value} % of the week` }))
}

export default function AutopilotSection() {
  const enabled = useAppSettings((settings) => autopilotBudgetOf(settings).enabled)
  const reservePercent = useAppSettings((settings) => autopilotBudgetOf(settings).reservePercent)
  const mode = useAppSettings((settings) => autopilotRunOf(settings).mode)
  const from = useAppSettings((settings) => autopilotRunOf(settings).window.from)
  const to = useAppSettings((settings) => autopilotRunOf(settings).window.to)
  const [problem, setProblem] = useState<string>()
  const choose = (patch: AppSettingsPatch): void => {
    void setAppSettings(patch).then(setProblem)
  }
  /** An edge of the window, unless it meets the other one. */
  const chooseEdge = (edge: 'windowFrom' | 'windowTo', hour: number): void => {
    if (hour === (edge === 'windowFrom' ? to : from)) setProblem(START_WINDOW_SAME_HOURS)
    else choose({ autopilotRun: { [edge]: hour } })
  }
  const windowOff = mode !== 'start-window'
  const reserveOff = !enabled && mode !== 'budget-aware'

  return (
    <>
      <SettingRow label={MODE_LABEL} description={MODE_DESCRIPTIONS[mode]} testId="settings-autopilot-mode-row">
        <Select aria-label={MODE_LABEL} value={mode} options={MODE_OPTIONS} onChange={(next) => choose({ autopilotRun: { mode: next } })} data-testid="settings-autopilot-mode" />
      </SettingRow>
      <SettingRow label={WINDOW_FROM_LABEL} description="Local time; the window may go across midnight." disabled={windowOff} testId="settings-autopilot-window-from-row">
        <Select
          aria-label={WINDOW_FROM_LABEL}
          value={String(from)}
          options={HOUR_OPTIONS}
          onChange={(value) => chooseEdge('windowFrom', Number(value))}
          disabled={windowOff}
          data-testid="settings-autopilot-window-from"
        />
      </SettingRow>
      <SettingRow label={WINDOW_TO_LABEL} description="No new Wave starts from this hour on; a Wave in work is never cut." disabled={windowOff} testId="settings-autopilot-window-to-row">
        <Select
          aria-label={WINDOW_TO_LABEL}
          value={String(to)}
          options={HOUR_OPTIONS}
          onChange={(value) => chooseEdge('windowTo', Number(value))}
          disabled={windowOff}
          data-testid="settings-autopilot-window-to"
        />
      </SettingRow>
      <SettingRow
        label={BUDGET_LABEL}
        description="Spreads what is left of the week over the days until it resets. Once today's share is used, Autopilot starts no new Wave and continues the next day; a Wave in work is never cut."
        testId="settings-autopilot-budget-row"
      >
        <SettingSwitch label={BUDGET_LABEL} checked={enabled} onChange={(next) => choose({ autopilotBudget: { enabled: next } })} testId="settings-autopilot-budget" />
      </SettingRow>
      <SettingRow label={RESERVE_LABEL} description="The share of the week Autopilot leaves for your work by hand." disabled={reserveOff} testId="settings-autopilot-reserve-row">
        <Select
          aria-label={RESERVE_LABEL}
          value={String(reservePercent)}
          options={reserveOptions(reservePercent)}
          onChange={(value) => choose({ autopilotBudget: { reservePercent: Number(value) } })}
          disabled={reserveOff}
          data-testid="settings-autopilot-reserve"
        />
      </SettingRow>
      {problem !== undefined ? (
        <p role="alert" className="w-setting-row__description" data-testid="settings-autopilot-problem">
          Not saved: {problem}
        </p>
      ) : null}
    </>
  )
}
