import { useId, useState, type CSSProperties } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import type { DemoCost } from '../../shared/ipc/getting-started'
import { invoke } from '../ipc'
import { acceptGettingStarted } from './store'

/**
 * The cost switch of the demo (worfy-onboarding ticket 09; spec, decision 5), under step 2 of
 * Getting started while there is a Demo project: the settings of the demo's Orchestrator, Sonnet with
 * effort medium or Opus. Main saves the pick for the Orchestrator's Node and gives it to a live
 * Session from its next turn (`gettingStarted.setCost`); the switch shows the demo record's cost.
 * Texts are those of the spec, section "Texts (draft)": no prices, no numbers.
 */

const COST_LABEL = 'Demo agents'
const COST_OPTIONS: readonly { cost: DemoCost; text: string }[] = [
  { cost: 'cheaper', text: 'Sonnet — a bit cheaper' },
  { cost: 'more-expensive', text: 'Opus — a bit more expensive' },
]

const styles = {
  group: { margin: '6px 0 0', padding: 0, border: 0, minWidth: 0 },
  legend: { padding: 0, fontSize: 'var(--text-11)', lineHeight: '14px', fontWeight: 600, color: 'var(--text-muted)' },
  row: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--text)' },
  radio: { margin: 0, accentColor: 'var(--accent)' },
  error: { margin: '4px 0 0', fontSize: 'var(--text-12)', lineHeight: '16px', color: 'var(--blocked-text)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

export default function CostSwitch({ cost }: { cost: DemoCost }) {
  const name = useId()
  /** The pick on its way to main: shown until main answers. */
  const [pending, setPending] = useState<DemoCost | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pick = async (next: DemoCost): Promise<void> => {
    setPending(next)
    setError(null)
    const result = await invoke('gettingStarted.setCost', { cost: next })
    setPending(null)
    if (!result.ok) setError(failureReason('gettingStarted.setCost', result.error))
    else acceptGettingStarted(result.value)
  }

  const shown = pending ?? cost
  return (
    <fieldset style={styles.group} data-testid="getting-started-cost" data-cost={cost}>
      <legend style={styles.legend}>{COST_LABEL}</legend>
      {COST_OPTIONS.map((option) => (
        <label key={option.cost} style={styles.row}>
          <input
            type="radio"
            name={name}
            value={option.cost}
            style={styles.radio}
            checked={shown === option.cost}
            disabled={pending !== null}
            onChange={() => void pick(option.cost)}
          />
          {option.text}
        </label>
      ))}
      {error !== null ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
