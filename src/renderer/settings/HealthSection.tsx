// Settings → Health (worfy-ui ticket 6): the checks of First run — what worfy and the Harness need
// on this Machine — with the same rows, actions and "Check again" (shell/FirstRunChecks.tsx), from
// the same store as the First run dialog: a check or an action started in one shows in the other.
// Opening the section checks. Closing Settings is not closing First run: nothing here calls
// `firstRun.close`, so the mark that keeps First run from opening at start is written only by the
// dialog's own Close.
import type { CSSProperties } from 'react'
import { FirstRunChecks } from '../shell/FirstRunChecks'
import { closeSettings, SETTINGS_LAYER } from './settings-window'

export const order = 20
export const title = 'Health'

/** The move form of the old Harness opens over this window: one layer above it, whatever the window's layer is. */
const FORM_LAYER = SETTINGS_LAYER + 10

const styles = {
  // Stays in sight while the rows scroll: the result of an action pressed far down shows here.
  head: { position: 'sticky', top: 0, zIndex: 1, paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' },
  lead: { margin: '0 0 var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  bar: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 'var(--row-height)' },
} satisfies Record<string, CSSProperties>

export default function HealthSection() {
  return (
    <FirstRunChecks checkOnShow formLayer={FORM_LAYER} onTerminalOpened={closeSettings}>
      {({ summary, list, message, checkAgain }) => (
        <div data-testid="settings-health">
          <div style={styles.head}>
            <p style={styles.lead}>What worfy and the Harness need on this Machine. Nothing changes until you confirm it.</p>
            <div style={styles.bar}>
              {summary}
              {message}
              {checkAgain}
            </div>
          </div>
          {list}
        </div>
      )}
    </FirstRunChecks>
  )
}
