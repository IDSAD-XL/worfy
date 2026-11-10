// Settings → Pull requests (worfy-pr-inbox ticket 07): two switches of the PR inbox, app settings of this Machine
// (src/shared/settings/app-settings.ts), both on by default. "Notify about new review requests and replies" — a
// system notification for a new review request and a new reply in a thread of the user's PR, one per PR and event,
// while no worfy window has focus (PrInboxNotices of src/main/notify.ts). "Morning digest" — at the first focus of
// the window in a day, one toast that sums up the inbox (src/main/github/inbox-digest.ts). Main reads both at each
// change of an inbox and at each focus, so a change acts at once. Whether a Project's PRs are read at all is the
// switch of Project settings (worfy-pr-inbox ticket 03).
import { useState } from 'react'
import { prInboxDigestOf, prInboxNotifyOf, type AppSettingsPatch } from '../../shared/settings/app-settings'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 66
export const title = 'Pull requests'

export const NOTIFY_LABEL = 'Notify about new review requests and replies'
export const DIGEST_LABEL = 'Morning digest'

export default function PullRequestsSection() {
  const notify = useAppSettings(prInboxNotifyOf)
  const digest = useAppSettings(prInboxDigestOf)
  const [problem, setProblem] = useState<string>()
  const choose = (patch: AppSettingsPatch): void => {
    void setAppSettings(patch).then(setProblem)
  }
  return (
    <>
      <SettingRow
        label={NOTIFY_LABEL}
        description={
          problem === undefined ? (
            'A system notification when a review is asked of you or someone replies in a thread of your PR, while worfy is not in front. It names the PR, never the comment.'
          ) : (
            <span role="alert" data-testid="settings-pr-inbox-problem">
              Not saved: {problem}
            </span>
          )
        }
        testId="settings-pr-inbox-notify-row"
      >
        <SettingSwitch label={NOTIFY_LABEL} checked={notify} onChange={(next) => choose({ prInboxNotify: next })} testId="settings-pr-inbox-notify" />
      </SettingRow>
      <SettingRow label={DIGEST_LABEL} description="The first time you come to worfy in a day: reviews that wait for you, PRs with new comments and PRs ready to merge." testId="settings-pr-inbox-digest-row">
        <SettingSwitch label={DIGEST_LABEL} checked={digest} onChange={(next) => choose({ prInboxDigest: next })} testId="settings-pr-inbox-digest" />
      </SettingRow>
    </>
  )
}
