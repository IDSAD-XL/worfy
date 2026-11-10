// Opening the Pull requests view of a Project (worfy-pr-inbox ticket 03): the toolbar tab, the palette
// command, a group of the sidebar's Pull requests section (shell/sidebar/PullRequestsSection.tsx) and the
// entries of later tickets that open it on one PR — the badge on a Ticket Node (ticket 06), the
// notification and the morning digest (ticket 07) — all come through here, as openPipelineOf does for
// the Pipeline board.
import type { PrInboxGroup } from '../../shared/ipc/pr-inbox'
import { windowMachine } from '../ipc'
import { openProject } from '../projects/useProjects'
import { setView } from '../session/navigation'
import { focusPrInbox, type PullRef } from './usePrInbox'

/**
 * Opens the Pull requests view of a Project of the window's Machine: at once for the active one, after
 * selecting it for another. With `pr` the view expands that PR's row and scrolls it into sight, or says
 * "This pull request is not in the inbox"; with `group` it scrolls to that group. Answers why it could
 * not be opened.
 */
export async function openPrInboxOf(projectId: string, activeId: string | undefined, pr?: PullRef, group?: PrInboxGroup): Promise<string | undefined> {
  if (projectId !== activeId) {
    const refused = await openProject(windowMachine(), projectId)
    if (refused !== undefined) return refused
  }
  focusPrInbox(projectId, pr ?? null, group ?? null)
  setView('pull-requests')
  return undefined
}

// The e2e test opens a PR through this until the entries of tickets 06 and 07 exist: on only when the page
// defined `__worfyPrInbox` before the app's scripts ran (an init script of the test); the app never does.
const hook = (globalThis as { __worfyPrInbox?: { open?: typeof openPrInboxOf } }).__worfyPrInbox
if (hook !== undefined) hook.open = openPrInboxOf
