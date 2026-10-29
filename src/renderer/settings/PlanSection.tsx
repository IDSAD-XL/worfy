// Settings → Plan (worfy-throughput ticket 42): the plan Claude Code is signed in with, and for Pro the
// preset of src/shared/agent/plan-preset.ts — fewer agents per Ticket, Sonnet with effort medium for
// every role in the active Project's Profile, and this Machine's Autopilot budget on — with an Apply
// button. Nothing is written without the click: main writes the Profile through the Harness's
// `bin/profile-set --field` and then turns the budget on (`planPreset.apply`, src/main/ipc/plan-preset.ts).
// Max and the plans worfy does not know get no offer. No prices.
import { useEffect, useState, type CSSProperties } from 'react'
import { planOf, presetFor, presetInUse, type PlanPreset } from '../../shared/agent/plan-preset'
import type { PlanPresetRead } from '../../shared/ipc/plan-preset'
import { autopilotBudgetOf } from '../../shared/settings/app-settings'
import { invoke, readableReason, windowMachine } from '../ipc'
import { activeProject, useProjects } from '../projects/useProjects'
import { useAppSettings } from './useAppSettings'

export const order = 69
export const title = 'Plan'

/** The line of a conflict: the Profile changed since the section read it; nothing was written. */
export const CHANGED_SINCE_READ = 'The Profile has changed since it was read. Reload it.'
/** The line of a busy lock: another write of this Profile is going on; nothing was written. */
export const WRITE_IN_PROGRESS = 'Another write is in progress — try again.'
/** What a Harness without `bin/profile-set --field` gets. */
export const HARNESS_TOO_OLD = 'The Harness is too old to apply the settings. Update it from the Harness item of the toolbar.'

const styles = {
  lead: { margin: '0 0 var(--space-3)', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  offer: { border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', padding: 'var(--space-3)', fontSize: 'var(--text-12)', color: 'var(--text)' },
  heading: { margin: '0 0 var(--space-2)', fontSize: 'var(--text-12)', fontWeight: 600 },
  list: { margin: '0 0 var(--space-3)', paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  note: { margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  problem: { margin: 'var(--space-2) 0 0', color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

type Outcome = null | { kind: 'saved'; warning: string | null } | { kind: 'conflict' } | { kind: 'busy' } | { kind: 'too-old' } | { kind: 'failed'; reason: string }

/** The plan's name for the line «Plan: …»: the preset's label, else what Claude Code answered. */
const planName = (read: PlanPresetRead, preset: PlanPreset | null): string => preset?.label ?? read.subscriptionType ?? 'not known'

interface PlanOfferProps {
  root: string
}

/** The plan and, for a plan with a preset, the offer for the Project at `root`. */
export function PlanOffer({ root }: PlanOfferProps) {
  const [read, setRead] = useState<PlanPresetRead | { error: string } | undefined>(undefined)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, setBusy] = useState(false)
  /** Counts the reads: Reload and a saved Apply ask for one more. */
  const [generation, setGeneration] = useState(0)
  const budgetEnabled = useAppSettings((settings) => autopilotBudgetOf(settings).enabled)

  useEffect(() => {
    let active = true
    void invoke('planPreset.read', { root }).then((result) => {
      if (!active) return
      setRead(result.ok ? result.value : { error: readableReason(result.error) })
    })
    return () => {
      active = false
    }
  }, [root, generation])

  if (read === undefined) return <p style={styles.lead}>Reading the plan…</p>
  if ('error' in read) {
    return (
      <p style={styles.problem} role="alert" data-testid="plan-read-failed">
        Could not read the plan: {read.error}
      </p>
    )
  }
  const preset = presetFor(read.subscriptionType)
  if (read.planError !== null) {
    return (
      <p style={styles.lead} data-testid="plan-unknown">
        Plan: not known. Claude Code did not answer: {read.planError}
      </p>
    )
  }
  if (preset === null) {
    return (
      <p style={styles.lead} data-testid="plan-no-offer">
        Plan: {planName(read, null)}.{' '}
        {planOf(read.subscriptionType) === 'max' ? 'Your settings stay as they are.' : 'worfy has no recommended settings for this plan.'}
      </p>
    )
  }
  const profile = read.profile
  const inUse = profile?.available === true && presetInUse(preset, { fields: profile.fields, budgetEnabled })

  const apply = async (): Promise<void> => {
    if (profile?.available !== true) return
    setBusy(true)
    setOutcome(null)
    const result = await invoke('planPreset.apply', { root, plan: preset.plan, expected: profile.fingerprint })
    setBusy(false)
    if (!result.ok) {
      setOutcome({ kind: 'failed', reason: readableReason(result.error) })
      return
    }
    const done = result.value
    if (done.status === 'invalid') setOutcome({ kind: 'failed', reason: done.reason })
    else setOutcome(done.status === 'saved' ? { kind: 'saved', warning: done.warning } : { kind: done.status })
    if (done.status === 'saved') setGeneration((count) => count + 1)
  }

  return (
    <section style={styles.offer} aria-label={`Recommended settings for ${preset.label}`} data-testid="plan-offer">
      <p style={styles.heading}>Plan: {preset.label}</p>
      <p style={{ ...styles.note, marginBottom: 'var(--space-2)' }}>Recommended settings for {preset.label}, to make a Ticket spend fewer tokens:</p>
      <ul style={styles.list}>
        {preset.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {profile === null || !profile.available ? (
        <p style={styles.note} data-testid="plan-profile-unavailable">
          {profile?.available === false && profile.reason.includes('profile-set') ? HARNESS_TOO_OLD : `Not available for this Project: ${profile?.reason ?? 'its Profile was not read'}.`}
        </p>
      ) : inUse ? (
        <p style={styles.note} data-testid="plan-in-use">
          These settings are in use.
        </p>
      ) : (
        <div style={styles.actions}>
          <button type="button" className="w-action w-action--primary" disabled={busy} onClick={() => void apply()} data-testid="plan-apply">
            Apply
          </button>
          <span style={styles.note}>Writes the Project's Profile and turns on the daily budget in Settings → Autopilot.</span>
        </div>
      )}
      {outcome?.kind === 'saved' && outcome.warning !== null ? (
        <p style={styles.note} role="status" data-testid="plan-warning">
          Applied. The change was not committed in the Harness home: {outcome.warning}
        </p>
      ) : null}
      {outcome?.kind === 'conflict' ? (
        <div style={{ ...styles.actions, marginTop: 'var(--space-2)' }} role="alert" data-testid="plan-conflict">
          <span style={{ ...styles.problem, margin: 0 }}>{CHANGED_SINCE_READ}</span>
          <button type="button" className="w-action" onClick={() => setGeneration((count) => count + 1)} data-testid="plan-reload">
            Reload
          </button>
        </div>
      ) : null}
      {outcome?.kind === 'busy' ? (
        <p style={styles.problem} role="alert" data-testid="plan-busy">
          {WRITE_IN_PROGRESS}
        </p>
      ) : null}
      {outcome?.kind === 'too-old' ? (
        <p style={styles.problem} role="alert" data-testid="plan-too-old">
          {HARNESS_TOO_OLD}
        </p>
      ) : null}
      {outcome?.kind === 'failed' ? (
        <p style={styles.problem} role="alert" data-testid="plan-failed">
          Not applied: {outcome.reason}
        </p>
      ) : null}
    </section>
  )
}

/** The section: the plan, and its offer for the window's active Project of this Machine. */
export default function PlanSection() {
  const project = activeProject(useProjects())
  if (windowMachine() !== null) return <p style={styles.lead}>The plan and its settings are applied in worfy on the Machine of the Project.</p>
  if (project === undefined) return <p style={styles.lead}>Open a Project to see the settings recommended for your plan.</p>
  return <PlanOffer key={project.path} root={project.path} />
}
