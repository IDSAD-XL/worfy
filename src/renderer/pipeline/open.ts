// Opening the Pipeline board of a Project: a row of the sidebar's Pipeline section
// (shell/sidebar/PipelineSection.tsx) and a click on the notification of a Ticket that waits for the
// owner (canvas/overlays/NotificationTarget.tsx, worfy-pipeline ticket 06) do it alike.
import { windowMachine } from '../ipc'
import { openProject } from '../projects/useProjects'
import { setView } from '../session/navigation'

/**
 * Opens the Pipeline board of a Project of the window's Machine: at once for the active one, after
 * selecting it for another. Answers why it could not be opened.
 */
export async function openPipelineOf(projectId: string, activeId: string | undefined): Promise<string | undefined> {
  if (projectId === activeId) {
    setView('pipeline')
    return undefined
  }
  const refused = await openProject(windowMachine(), projectId)
  if (refused === undefined) setView('pipeline')
  return refused
}
