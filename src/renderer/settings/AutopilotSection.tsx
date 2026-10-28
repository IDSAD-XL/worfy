// Settings → Autopilot (worfy-throughput ticket 41): the budget of the Limits. "Daily budget" —
// whether a run starts no Wave once today's share of the week is used (src/shared/autopilot/budget.ts:
// the week left after the reserve, spread over the days until the 7-day window resets); "Reserve for
// your own work" — the share of the week Autopilot leaves to the person. Both are app settings of
// this Machine (`autopilotBudget`, src/shared/settings/app-settings.ts): main reads them before every
// Wave of a run. A choice is kept as the person's own; a reserve set outside the offered values (by
// hand in app-settings.json) is shown as it is.
import { useState } from 'react'
import { autopilotBudgetOf, type AutopilotBudgetChoice } from '../../shared/settings/app-settings'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 68
export const title = 'Autopilot'

export const BUDGET_LABEL = 'Daily budget of the Limits'
export const RESERVE_LABEL = 'Reserve for your own work'

/** The offered reserves, in percent of the week. */
const RESERVES = [0, 5, 10, 15, 20, 25, 30, 40, 50] as const

/** The options of the reserve, with the current one among them when it is not one of the offered. */
function reserveOptions(current: number): SelectOption[] {
  return [...new Set<number>([...RESERVES, current])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: `${value} % of the week` }))
}

export default function AutopilotSection() {
  const enabled = useAppSettings((settings) => autopilotBudgetOf(settings).enabled)
  const reservePercent = useAppSettings((settings) => autopilotBudgetOf(settings).reservePercent)
  const [problem, setProblem] = useState<string>()
  const choose = (choice: AutopilotBudgetChoice): void => {
    void setAppSettings({ autopilotBudget: choice }).then(setProblem)
  }

  return (
    <>
      <SettingRow
        label={BUDGET_LABEL}
        description="Spreads what is left of the week over the days until it resets. Once today's share is used, Autopilot starts no new Wave and continues the next day; a Wave in work is never cut."
        testId="settings-autopilot-budget-row"
      >
        <SettingSwitch label={BUDGET_LABEL} checked={enabled} onChange={(next) => choose({ enabled: next })} testId="settings-autopilot-budget" />
      </SettingRow>
      <SettingRow label={RESERVE_LABEL} description="The share of the week Autopilot leaves for your work by hand." disabled={!enabled} testId="settings-autopilot-reserve-row">
        <Select
          aria-label={RESERVE_LABEL}
          value={String(reservePercent)}
          options={reserveOptions(reservePercent)}
          onChange={(value) => choose({ reservePercent: Number(value) })}
          disabled={!enabled}
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
