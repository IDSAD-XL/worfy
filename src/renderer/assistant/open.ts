// Open of an item of the Assistant (worfy-assistant ticket 14): where main said its subject lives — the Session on its Node,
// the Pull requests view on a PR, the Pipeline board, the Project, the page of an outside source, the Health check — through
// the same functions the rest of the window opens them with. main counts the Open for the item's duty first.
import type { OpenTarget, WindowItem } from '../../shared/assistant/window'
import { invoke, readableReason, windowMachine } from '../ipc'
import { openPipelineOf } from '../pipeline/open'
import { openPrInboxOf } from '../pr-inbox/open'
import { activeProject, openProject, projectsNow } from '../projects/useProjects'
import { openSessionInProject } from '../session/open-in-project'
import { openHealthCheck } from '../settings/settings-window'
import { showToast } from '../toast/toasts'
import { itemAction } from './useAssistant'

/** Opens where `target` points; answers why it could not, or undefined. */
export async function openTarget(target: OpenTarget): Promise<string | undefined> {
  const activeId = activeProject(projectsNow())?.id
  switch (target.kind) {
    case 'session':
      openSessionInProject({ nodeId: target.nodeId, projectId: target.projectId })
      return undefined
    case 'pr':
      return openPrInboxOf(target.projectId, activeId, { repo: target.repo, number: target.number })
    case 'pipeline':
      return openPipelineOf(target.projectId, activeId)
    case 'project':
      return target.projectId === activeId ? undefined : openProject(windowMachine(), target.projectId)
    case 'url': {
      const result = await invoke('shell.openExternal', { url: target.url })
      return result.ok ? undefined : result.error
    }
    case 'health':
      openHealthCheck()
      return undefined
  }
}

/** Open on an item: counted by main, then shown. */
export async function openItem(item: WindowItem): Promise<void> {
  await itemAction(item.id, 'open')
  if (item.open === null) return
  const problem = await openTarget(item.open)
  if (problem !== undefined) showToast({ kind: 'error', key: `assistant:open:${item.id}`, text: `Open: ${readableReason(problem)}` })
}
