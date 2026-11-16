// The toasts of the Epic stories for the app's window (worfy-code-stories ticket 10): the active Project's workflow model
// goes to story-toast.ts, and "Open" opens the story through stories/open.ts, as "Code story" on the Epic frame does.
// A story main cannot read shows its reason in an error toast: "Open" closes the Epic's only toast either way.
import { useEffect } from 'react'
import type { Epic } from '../../shared/workflow/types'
import { useWorkflow } from '../workflow/useWorkflow'
import { showToast } from '../toast/toasts'
import { epicStoryPath, openStoryFile } from './open'
import { acceptStoryEpics, setStoryToastTarget } from './story-toast'

/**
 * Opens the story of Epic `epic` of Project `projectId`, as "Code story" on the Epic frame does; main's reason, when it
 * cannot read the story, in an error toast.
 */
export async function openEpicStoryOf(projectId: string, epic: string, epics: () => readonly Epic[] | undefined): Promise<void> {
  const path = epicStoryPath(epics()?.find((each) => each.epic === epic))
  const failure = path === null ? 'the Epic has no story.md any more' : await openStoryFile(projectId, path)
  if (failure !== undefined) showToast({ kind: 'error', projectId, text: `The Code story of Epic ${epic} cannot be opened: ${failure}`, testId: 'story-open-error' })
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
    setStoryToastTarget((id, epic) => void openEpicStoryOf(id, epic, () => model.epics), globalThis.localStorage)
    acceptStoryEpics(projectId, model.epics)
  }, [projectId, model])
}
