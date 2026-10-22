// Settings → Canvas (worfy-canvas ticket 08, ADR-0076, point 7): the automatic archive of finished
// Sessions. "Archive finished sessions after" — how long a finished Session stays on the Canvas
// after its last record: Never, 6 h, 24 h, 3 days or 7 days; Never turns the timer off. "…and when
// their Ticket is done" — also archive a finished Session of a done Ticket, an hour after its last
// record. Both are app settings of this Machine (`sessionArchive`, src/shared/settings/app-settings.ts)
// and act on its Projects: main reads them at every run of the archive (src/main/layout/archive.ts).
// A choice is kept as the person's own: a change of the defaults (SESSION_ARCHIVE_DEFAULTS, ticket 10
// turned the timer on at 24 h) leaves it, and only a setting never chosen follows the defaults.
import { useState } from 'react'
import { sessionArchiveOf, type SessionArchiveAfter, type SessionArchiveChoice } from '../../shared/settings/app-settings'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 65
export const title = 'Canvas'

/** The thresholds in the order of ADR-0076, with their labels. */
const ARCHIVE_AFTER_OPTIONS: readonly SelectOption<SessionArchiveAfter>[] = [
  { value: 'never', label: 'Never' },
  { value: '6h', label: '6 h' },
  { value: '24h', label: '24 h' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
]

export const ARCHIVE_AFTER_LABEL = 'Archive finished sessions after'
export const TICKET_DONE_LABEL = '…and when their Ticket is done'

export default function CanvasSection() {
  const after = useAppSettings((settings) => sessionArchiveOf(settings).after)
  const ticketDone = useAppSettings((settings) => sessionArchiveOf(settings).ticketDone)
  const [problem, setProblem] = useState<string>()
  const choose = (choice: SessionArchiveChoice): void => {
    void setAppSettings({ sessionArchive: choice }).then(setProblem)
  }

  return (
    <>
      <SettingRow
        label={ARCHIVE_AFTER_LABEL}
        description={
          problem === undefined ? (
            'A finished Session leaves the Canvas this long after its last message; nothing is deleted. Never turns this off.'
          ) : (
            <span role="alert" data-testid="settings-archive-problem">
              Not saved: {problem}
            </span>
          )
        }
        testId="settings-archive-after-row"
      >
        <Select aria-label={ARCHIVE_AFTER_LABEL} value={after} options={ARCHIVE_AFTER_OPTIONS} onChange={(value) => choose({ after: value })} data-testid="settings-archive-after" />
      </SettingRow>
      <SettingRow label={TICKET_DONE_LABEL} description="Also an hour after the last message of a Session whose Ticket is done." testId="settings-archive-ticket-done-row">
        <SettingSwitch label={TICKET_DONE_LABEL} checked={ticketDone} onChange={(next) => choose({ ticketDone: next })} testId="settings-archive-ticket-done" />
      </SettingRow>
    </>
  )
}
