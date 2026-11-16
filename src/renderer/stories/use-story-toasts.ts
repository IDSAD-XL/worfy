// The toasts of the Epic stories for the app's window (worfy-code-stories ticket 10): the active Project's workflow model
// goes to story-toast.ts, and "Open" opens the story through stories/open.ts, as "Story" on the Epic frame does.
import { useEffect } from 'react'
import type { Epic } from '../../shared/workflow/types'
import { useWorkflow } from '../workflow/useWorkflow'
import { epicStoryPath, openStoryFile } from './open'
import { acceptStoryEpics, setStoryToastTarget } from './story-toast'

/** Opens the story of Epic `epic` of Project `projectId`, as "Story" on the Epic frame does. */
function openEpicStoryOf(projectId: string, epic: string, epics: () => readonly Epic[] | undefined): void {
  const path = epicStoryPath(epics()?.find((each) => each.epic === epic))
  if (path !== null) void openStoryFile(projectId, path)
}

/**
 * The toasts of the active Project's Epic stories, for the app's window (main.tsx): follows its workflow model, the
 * same copy the Canvas and the sidebar read, and keeps the shown Epics in localStorage.
 */
export function useStoryToasts(project: { id: string; path: string } | undefined): void {
  const { model } = useWorkflow(project?.path)
  const projectId = project?.id
  useEffect(() => {
    if (projectId === undefined || model === undefined || model.error !== null) return
    setStoryToastTarget((id, epic) => openEpicStoryOf(id, epic, () => model.epics), globalThis.localStorage)
    acceptStoryEpics(projectId, model.epics)
  }, [projectId, model])
}
