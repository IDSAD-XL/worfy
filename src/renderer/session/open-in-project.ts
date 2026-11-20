// Opening a Session that may run in another Project than the one the window shows (worfy-polish
// ticket 127): the "Open" of a question's toast (question-toast.ts) and a click on a system
// notification of this Machine's Session (canvas/overlays/NotificationTarget.tsx). The Session view
// draws the active Project's last Session (navigation.ts), so a Session of another Project needs its
// Project selected first, as the sidebar's Sessions of another Project do (shell/sidebar/SessionsSection.tsx).
// Kept out of navigation.ts, which much of the renderer imports, so that it does not pull in the
// Project list.
import { readableReason, windowMachine } from '../ipc'
import { activeProject, openProject, projectsNow } from '../projects/useProjects'
import { showToast } from '../toast/toasts'
import { openSession, type OpenedSession } from './navigation'

/**
 * openSession() at once for a Session of the active Project. For another Project of the window's
 * Machine, that Project is opened first and the Session after; when the Project is refused, an
 * error toast says why and nothing opens.
 */
export function openSessionInProject(target: OpenedSession): void {
  const projects = projectsNow()
  if (target.projectId === activeProject(projects)?.id) {
    openSession(target)
    return
  }
  const name = projects?.projects.find((project) => project.id === target.projectId)?.name ?? "The Session's Project"
  void openProject(windowMachine(), target.projectId).then((refused) => {
    if (refused === undefined) openSession(target)
    else showToast({ kind: 'error', key: `open-project:${target.projectId}`, text: `${name} could not be opened: ${readableReason(refused)}` })
  })
}
