// Settings → General → Updates (worfy-update ticket 09): the state of the Update of this copy, with
// "Check now" and "Update worfy" (once built: "Restart now", or "Restart when idle" while a Session
// works or Autopilot runs), the switch "Update automatically" and "Roll back to previous version".
// The texts are the spec's (.scratch/worfy-update/spec.md, "Settings → General → Updates").
//
// Main owns the state (src/main/ipc/update.ts) and asks the native dialog of the roll back itself
// (spec R8); this block only shows the snapshot of src/renderer/update/store.ts and calls the
// `update` channels. Without Update in this copy (`enabled: false`) there is no block.
import { useState } from 'react'
import type { UpdateSnapshot } from '../../shared/ipc/update'
import { autoUpdateOf } from '../../shared/settings/app-settings'
import { checkForUpdateNow, installUpdate, restartIntoUpdate, rollBackUpdate, updateStep, useUpdate } from '../update/store'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

/** The time of the last check: the clock today, the day and the clock before. */
function checkedAt(at: string, now: Date = new Date()): string {
  const time = new Date(at)
  const clock = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return time.toDateString() === now.toDateString() ? clock : `${time.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock}`
}

/**
 * The line of the state, as the spec words it. The copy that runs is main's `running`, filled in by
 * the first check; before it, `version`, the build version the line "Version" shows. Neither known —
 * only the last check, or no line.
 */
function statusLine(snapshot: UpdateSnapshot, version: string | undefined): string {
  const step = updateStep(snapshot)
  if (step.kind === 'restart') return `worfy ${step.version} is ready.`
  if (step.kind === 'install') return step.building ? `Building worfy ${step.version}…` : `worfy ${step.version} is available.`
  const running = snapshot.running?.version ?? version
  const checked = snapshot.lastCheck === null ? undefined : `Last checked ${checkedAt(snapshot.lastCheck.at)}.`
  return [running === undefined ? undefined : `worfy ${running}.`, checked].filter((part) => part !== undefined).join(' ')
}

/** The row "Updates": the state, its notes and the buttons. */
function UpdatesRow({ snapshot, version }: { snapshot: UpdateSnapshot; version: string | undefined }) {
  // The reason of the last press here: a refusal, or the skipped check that "Check now" ran.
  const [problem, setProblem] = useState<string>()
  const [checkedHere, setCheckedHere] = useState(false)
  const [pressing, setPressing] = useState(false)
  const step = updateStep(snapshot)
  const checking = snapshot.checking || pressing
  const skipped = checkedHere && snapshot.lastCheck?.result === 'skipped' ? (snapshot.lastCheck.reason ?? 'the check was skipped') : undefined
  const reason = problem ?? skipped
  const missing = snapshot.build.missing ?? []

  const press = (action: () => Promise<string | undefined>): void => {
    setProblem(undefined)
    void action().then(setProblem)
  }
  const checkNow = (): void => {
    setProblem(undefined)
    setPressing(true)
    void checkForUpdateNow().then((error) => {
      setPressing(false)
      setCheckedHere(true)
      setProblem(error)
    })
  }

  const notes: { text: string; testId: string; alert?: boolean }[] = []
  if (snapshot.rolledBackFrom !== null && snapshot.running !== null) {
    notes.push({ text: `worfy is back to ${snapshot.running.version}. Automatic updates wait for the next commit on main.`, testId: 'settings-updates-rolled-back' })
  }
  if (step.kind === 'restart' && snapshot.restartWhenIdle) {
    notes.push({ text: 'worfy restarts when no Session is working and Autopilot has stopped', testId: 'settings-updates-waiting' })
  }
  if (missing.length > 0) {
    notes.push({ text: `Updates need git, node and pnpm: ${missing.join(', ')} not found. See Settings → Health.`, testId: 'settings-updates-missing' })
  }
  if (reason !== undefined) notes.push({ text: reason, testId: 'settings-updates-reason', alert: true })

  return (
    <SettingRow
      label="Updates"
      description={
        <>
          <span data-testid="settings-updates-status">{statusLine(snapshot, version)}</span>
          {notes.map((note) => (
            <span key={note.testId} style={{ display: 'block' }} data-testid={note.testId} role={note.alert === true ? 'alert' : undefined}>
              {note.text}
            </span>
          ))}
        </>
      }
      testId="settings-updates-row"
    >
      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="button" className="w-action" disabled={checking} aria-disabled={checking ? 'true' : undefined} onClick={checkNow} data-testid="settings-updates-check">
          Check now
        </button>
        {step.kind === 'install' ? (
          <button
            type="button"
            className="w-action w-action--primary"
            disabled={step.building}
            aria-disabled={step.building ? 'true' : undefined}
            onClick={() => press(installUpdate)}
            data-testid="settings-updates-install"
          >
            Update worfy
          </button>
        ) : null}
        {step.kind === 'restart' ? (
          <button
            type="button"
            className="w-action w-action--primary"
            disabled={snapshot.restartWhenIdle && step.when === 'idle'}
            aria-disabled={snapshot.restartWhenIdle && step.when === 'idle' ? 'true' : undefined}
            onClick={() => press(() => restartIntoUpdate(step.when))}
            data-testid="settings-updates-restart"
          >
            {step.when === 'now' ? 'Restart now' : 'Restart when idle'}
          </button>
        ) : null}
      </span>
    </SettingRow>
  )
}

/** The switch "Update automatically" (`autoUpdate`, on by default). */
function AutoUpdateRow() {
  const enabled = useAppSettings(autoUpdateOf)
  const [problem, setProblem] = useState<string>()
  return (
    <SettingRow
      label="Update automatically"
      description={
        problem === undefined ? (
          'Build new versions of worfy in the background. worfy restarts only when you say so.'
        ) : (
          <span role="alert" data-testid="settings-updates-auto-problem">
            Not saved: {problem}
          </span>
        )
      }
      testId="settings-updates-auto-row"
    >
      <SettingSwitch
        label="Update automatically"
        checked={enabled}
        onChange={(next) => {
          void setAppSettings({ autoUpdate: next }).then(setProblem)
        }}
        testId="settings-updates-auto"
      />
    </SettingRow>
  )
}

/** "Roll back to previous version": inactive without a previous copy. */
function RollbackRow({ snapshot }: { snapshot: UpdateSnapshot }) {
  const [problem, setProblem] = useState<string>()
  const [asking, setAsking] = useState(false)
  const { previous } = snapshot
  const off = previous === null || asking
  return (
    <SettingRow
      label="Roll back to previous version"
      description={
        <>
          {previous === null ? 'No previous version is kept.' : `Return to worfy ${previous.version}. Automatic updates wait for the next commit on main.`}
          {problem === undefined ? null : (
            <span style={{ display: 'block' }} role="alert" data-testid="settings-updates-rollback-problem">
              {problem}
            </span>
          )}
        </>
      }
      disabled={previous === null}
      testId="settings-updates-rollback-row"
    >
      <button
        type="button"
        className="w-action"
        disabled={off}
        aria-disabled={off ? 'true' : undefined}
        onClick={() => {
          setProblem(undefined)
          setAsking(true)
          void rollBackUpdate().then((error) => {
            setAsking(false)
            setProblem(error)
          })
        }}
        data-testid="settings-updates-rollback"
      >
        Roll back
      </button>
    </SettingRow>
  )
}

/**
 * The block "Updates" of Settings → General; nothing without Update in this copy. `version`: the
 * build version of this copy (`app.version`), for the line before main knows the copy that runs.
 */
export function UpdatesBlock({ version }: { version?: string | undefined } = {}) {
  const snapshot = useUpdate()
  if (snapshot === null || !snapshot.enabled) return null
  return (
    <>
      <UpdatesRow snapshot={snapshot} version={version} />
      <AutoUpdateRow />
      <RollbackRow snapshot={snapshot} />
    </>
  )
}
