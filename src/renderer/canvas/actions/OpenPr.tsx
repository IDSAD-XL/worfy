import { pullOfTicket } from '../../../shared/ipc/checks'
import { invoke } from '../../ipc'
import { useChecks } from '../badges/use-checks'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'

// "Open PR" on a Ticket that has a PR (ticket 23): opens the PR's address from `gh` (the checks
// snapshot of ticket 17) in the browser through `shell.openExternal` (ticket 11). Only
// https://github.com/ addresses are opened; any other is refused on the button. worfy writes
// nothing to GitHub: the button only opens the page.

export const order = 30

/** The address when it is a page on https://github.com/; null for anything else. */
function githubAddress(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.port === '' && parsed.username === '' && parsed.password === '' ? parsed.href : null
}

function OpenPullRequest({ root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const snapshot = useChecks(root)
  const pull = snapshot?.gh.available ? pullOfTicket(snapshot, ticket) : null
  if (!pull) return null
  const address = githubAddress(pull.url)
  return (
    <ActionButton
      label="Open PR"
      testId="action-open-pr"
      enabled={address !== null}
      title={address ?? `Not a GitHub address: ${pull.url}`}
      run={async () => {
        if (address === null) return `Not a GitHub address: ${pull.url}`
        const result = await invoke('shell.openExternal', { url: address })
        return result.ok ? undefined : result.error
      }}
    />
  )
}

export default function OpenPr({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <OpenPullRequest {...subject} /> : null
}
