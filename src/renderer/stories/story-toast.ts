// The toast "The Code story of Epic <name> is ready" with "Open" (worfy-code-stories ticket 10, decisions 7 and 20), as
// the toast of a stopped Run is made (flight-recorder/stop-toast.ts): an `action` toast, so it stays until it is closed;
// "Open" opens the story of that Epic in the Story view (stories/open.ts). One per Epic, ever: the Epics it was shown for
// are kept in this window's localStorage — worfy's data folder (ADR-0005), as the Update toasts keep theirs — so a second
// read of the Epic and a restart of worfy show none. A PR story (`stories/*.md`) gives no notice (decision 7).
//
// The stories come with the workflow model (the Epic's `stories`, src/shared/workflow/types.ts): when the reader first
// sees an Epic's `story.md`. The first model of a Project this machine ever sees only remembers the stories it already
// has: a Project connected with finished Epics, or worfy updated over them, gets no stack of toasts for old stories
// (decided without the owner, worfy-code-stories ticket 10, to confirm).
// The window follows the model and opens the story in useStoryToasts (use-story-toasts.ts): this module stays free of the
// stores, so a Node test reads it.
import type { Epic } from '../../shared/workflow/types'
import { showToast } from '../toast/toasts'

/** `data-testid` of the toast. */
export const STORY_TOAST_TEST_ID = 'story-ready-toast'

/** Where the Epics whose toast was shown are kept, by Project: `{ "<projectId>": ["<epic>", …] }`. */
export const STORY_TOAST_ITEM = 'worfy.stories.epicToastShown'

/** The toast's key: one per Epic of a Project. */
export const storyToastKey = (projectId: string, epic: string): string => `story-ready:${projectId}:${epic}`

/** Opens the story of an Epic: what "Open" calls. */
export type OpenEpicStory = (projectId: string, epic: string) => unknown

type ShownStorage = Pick<Storage, 'getItem' | 'setItem'>

let open: OpenEpicStory = () => undefined
let storage: ShownStorage | undefined
/** What the storage holds, read once per window; the window's own record when the storage cannot be used. */
let shown: Record<string, string[]> | null = null

function readShown(): Record<string, string[]> {
  if (shown !== null) return shown
  shown = {}
  try {
    const text = storage?.getItem(STORY_TOAST_ITEM) ?? null
    const value: unknown = text === null ? null : JSON.parse(text)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [projectId, epics] of Object.entries(value)) if (Array.isArray(epics)) shown[projectId] = epics.filter((epic): epic is string => typeof epic === 'string')
    }
  } catch (error) {
    console.error('story toasts: localStorage cannot be used', error)
  }
  return shown
}

function writeShown(record: Record<string, string[]>): void {
  try {
    storage?.setItem(STORY_TOAST_ITEM, JSON.stringify(record))
  } catch (error) {
    console.error('story toasts: localStorage cannot be used', error)
  }
}

/**
 * Takes the Epics of a model of Project `projectId`: shows the toast of each Epic whose `story.md` it sees for the first
 * time, and remembers it. The first model of a Project only remembers.
 */
export function acceptStoryEpics(projectId: string, epics: readonly Pick<Epic, 'epic' | 'stories'>[]): void {
  const record = readShown()
  const withStory = epics.filter((epic) => epic.stories?.some((entry) => entry.kind === 'epic') === true).map((epic) => epic.epic)
  const known = record[projectId]
  if (known === undefined) {
    record[projectId] = withStory
    writeShown(record)
    return
  }
  const fresh = withStory.filter((epic) => !known.includes(epic))
  if (fresh.length === 0) return
  record[projectId] = [...known, ...fresh]
  writeShown(record)
  for (const epic of fresh) {
    showToast({
      kind: 'action',
      key: storyToastKey(projectId, epic),
      projectId,
      testId: STORY_TOAST_TEST_ID,
      text: `The Code story of Epic ${epic} is ready`,
      actions: [{ label: 'Open', run: () => void open(projectId, epic) }],
    })
  }
}

/** What "Open" calls and where the shown Epics are kept; the app's: setStoryToastTarget(openEpicStory, localStorage). */
export function setStoryToastTarget(openEpic: OpenEpicStory, kept: ShownStorage | undefined): void {
  open = openEpic
  // The same storage keeps what this window read and wrote: a storage that cannot be used still shows each toast once.
  if (kept === storage) return
  storage = kept
  shown = null
}

/** Forgets the target and what was read of the storage; tests start from here. */
export function resetStoryToasts(): void {
  open = () => undefined
  storage = undefined
  shown = null
}
