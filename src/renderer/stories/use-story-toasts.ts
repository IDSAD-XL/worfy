// The toasts of the Epic stories for the app's window (worfy-code-stories ticket 10): the active Project's workflow model
// goes to story-toast.ts, and "Open" opens the story through stories/open.ts, as "Code story" on the Epic frame does.
// A story main cannot read shows its reason in an error toast: "Open" closes the Epic's only toast either way.
//
// worfy-polish 122: a story made by the button whose build ended while no button followed it — the PR or Epic left, the
// window reloaded — gives the toast "The Code story of <PR owner/name#N | Epic name> is ready" with "Open", which opens
// the story main kept (stories/open.ts, openMadeStory). The toast of ticket 10 (story-toast.ts) is for an Epic's
// story.md the workflow model brings, kept once per Epic in localStorage: it does not fit a story main keeps, so this
// one is an `action` toast of its own, one per key, shown for each build that ends. A build that ends "Failed" or "Not
// available" with no button following it gives an error toast with its reason (stopped: none — Stop was pressed).
import { useEffect } from 'react'
import type { Story } from '../../shared/stories/schema'
import type { Epic } from '../../shared/workflow/types'
import { hasPreloadBridge, subscribe } from '../ipc'
import { useWorkflow } from '../workflow/useWorkflow'
import { showToast } from '../toast/toasts'
import { epicStoryPath, openMadeStory, openStoryFile } from './open'
import { takeEndedInView } from './story-build'
import { acceptStoryEpics, setStoryToastTarget } from './story-toast'

/** `data-testid` of the toast of a story made by the button. */
export const MADE_STORY_TOAST_TEST_ID = 'story-made-toast'

/** What a story made by the button is of, by the key main kept it under: `Epic <name>` or `PR owner/name#N`. */
export const madeStoryName = (key: string): string => (key.startsWith('epic:') ? `Epic ${key.slice('epic:'.length)}` : `PR ${key}`)

/** `data-testid` of the toast of a build by the button that failed with no button following it. */
export const MADE_STORY_FAILED_TEST_ID = 'story-made-failed-toast'

/** The error toast of a build by the button that ended without a story and with no button on screen: its reason. */
export function showMadeStoryFailure(projectId: string, key: string, status: 'failed' | 'unavailable', reason: string): void {
  const what = status === 'failed' ? 'failed' : 'is not available'
  showToast({ kind: 'error', projectId, testId: MADE_STORY_FAILED_TEST_ID, text: `The Code story of ${madeStoryName(key)} ${what}: ${reason}` })
}

/** The toast "The Code story of … is ready" of a story made by the button, kept by main under `key`; "Open" opens it. */
export function showMadeStoryToast(projectId: string, key: string, story: Story): void {
  showToast({
    kind: 'action',
    key: `story-made:${projectId}:${key}`,
    projectId,
    testId: MADE_STORY_TOAST_TEST_ID,
    text: `The Code story of ${madeStoryName(key)} is ready`,
    actions: [{ label: 'Open', run: () => openMadeStory(projectId, story, key) }],
  })
}

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
  // A build by the button that ended with no button following it: its story waits in a toast, whatever Project is active.
  // Decided after every listener of the event ran, so a button that heard it first or after counts either way.
  useEffect(() => {
    // A window without the preload (the App rendered in jsdom) hears no event.
    if (!hasPreloadBridge()) return
    return subscribe('stories.made', ({ storyId, projectId, made }) => {
      setTimeout(() => {
        if (takeEndedInView(storyId) || made.reused) return
        const outcome = made.outcome
        if (outcome.status === 'story') showMadeStoryToast(projectId, made.key, outcome.story)
        // A build that failed with nobody looking: its reason, or it would be lost — the button shows no bar for it any more.
        else if (outcome.status === 'failed' || outcome.status === 'unavailable') showMadeStoryFailure(projectId, made.key, outcome.status, outcome.reason)
      }, 0)
    })
  }, [])
  const { model } = useWorkflow(project?.path)
  const projectId = project?.id
  useEffect(() => {
    if (projectId === undefined || model === undefined || model.error !== null) return
    setStoryToastTarget((id, epic) => void openEpicStoryOf(id, epic, () => model.epics), globalThis.localStorage)
    acceptStoryEpics(projectId, model.epics)
  }, [projectId, model])
}
