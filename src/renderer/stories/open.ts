// Opening the Story view (Epic worfy-code-stories, ticket 09): a Code story over the whole main area, beside Run
// history. The view takes a story already read — the data of src/shared/stories/schema.ts — and a function that
// gives the code of each fragment. It reads no file itself.
//
// The entries of ticket 10 — "Code story" on the Epic frame, in its "⋯" menu, on the Ticket card and in
// Pull requests, the toast of an Epic story and the Command palette's "Open code story" — all go through
// openStoryFile: main reads the story file (`stories.read`, from the main branch in Full mode, from the Workflow folder
// in Silent; ticket 08) and the view asks main for the code of each fragment where the story is anchored
// (`stories.code`, storyCodeSource).
import { create } from 'zustand'
import { failureReason } from '../../shared/ipc/channels'
import type { StoryFile, StoryFragment } from '../../shared/stories/schema'
import type { Epic } from '../../shared/workflow/types'
import { invoke } from '../ipc'
import { setView } from '../session/navigation'

/** The code a step shows for a fragment: its lines, the number of the first one and the key lines. */
export interface FragmentCode {
  code: string
  startLine: number
  keyLines: readonly number[]
  /**
   * True when the code is the story's own — the code of the PR head — rather than the code git holds (TICKETS.md,
   * "Story anchor", reader step 3): the view says so above the code.
   */
  fromHead: boolean
  /**
   * Why it is the story's own code (`stories.code`): `changed` — the anchor commit holds other code there; `no-anchor`
   * — there is no commit to read it at. Null or absent: the code was found, or the reason is not known.
   */
  reason?: 'changed' | 'no-anchor' | null
}

/**
 * Gives the code of `fragment`, read against `head` — the PR head a story kept outside git names, for the story or for
 * its chapter; null for a committed story — and `pr`, the PR of the story or of the fragment's chapter (null for
 * `PR -`). The story's own code serves when nothing reads git, as in the tests.
 */
export type FragmentCodeSource = (fragment: StoryFragment, head: string | null, pr: number | null) => Promise<FragmentCode>

/** The fragment as the story quotes it: what a story kept with its code shows when nothing reads git. */
export const storyOwnCode: FragmentCodeSource = (fragment) =>
  Promise.resolve({ code: fragment.code, startLine: fragment.startLine, keyLines: fragment.keyLines, fromHead: false })

/**
 * The code of each fragment of the story file `path` of Project `projectId`, from main (`stories.code`): at the PR head
 * a story or its chapter names, otherwise in the commit that added the file, the PR helping a Silent Project's story
 * (main takes the Ticket's PR itself for `PR -`). A refusal rejects, and the view shows the story's own code with why.
 */
export function storyCodeSource(projectId: string, path: string): FragmentCodeSource {
  return async (fragment, head, pr) => {
    const at = head !== null ? { commit: head } : { path, pr }
    const result = await invoke('stories.code', { projectId, at, fragment })
    if (!result.ok) throw new Error(failureReason('stories.code', result.error))
    return result.value
  }
}

export interface OpenStoryOptions {
  /** The code of each fragment; the story's own code when left out. */
  codeOf?: FragmentCodeSource
  /**
   * The folder of the story file, relative to the Project root: a Requirement link is relative to the story file
   * (TICKETS.md, "Code story"). Left out — a story kept outside the Project — such a link opens nothing.
   */
  storyDir?: string
}

interface StoryViewState {
  /** The Project the story is of. */
  projectId: string | null
  story: StoryFile | null
  codeOf: FragmentCodeSource
  storyDir: string | undefined
  /** Counts the openings: each one starts the story at its first screen and asks for the focus. */
  opened: number
}

export const useStoryView = create<StoryViewState>(() => ({ projectId: null, story: null, codeOf: storyOwnCode, storyDir: undefined, opened: 0 }))

/**
 * Shows `story` of the Project over the whole main area, at its first screen; Esc goes back to the Canvas. A story read
 * from its file (`StoryFile`, commit and chapter heads may be null) and one made by the button (`Story`) both show.
 */
export function openStory(projectId: string, story: StoryFile, options: OpenStoryOptions = {}): void {
  useStoryView.setState((state) => ({ projectId, story, codeOf: options.codeOf ?? storyOwnCode, storyDir: options.storyDir, opened: state.opened + 1 }))
  setView('story')
}

/**
 * Reads the story file `path` of Project `projectId` (`<epic>/story.md` or `<epic>/stories/<NN>-<slug>.md` under its
 * Tickets root) and shows it. Resolves to the reason when main could not read it or it does not fit the format — the
 * entry shows that reason and the Canvas stays — and to undefined when the view opened.
 */
export async function openStoryFile(projectId: string, path: string): Promise<string | undefined> {
  const result = await invoke('stories.read', { projectId, path })
  if (!result.ok) return failureReason('stories.read', result.error)
  const read = result.value
  if (!read.ok) return read.reason
  openStory(projectId, read.story, { codeOf: storyCodeSource(projectId, read.path), storyDir: read.dir })
  return undefined
}

/**
 * The code of each fragment of a story made by the button (worfy-code-stories ticket 11), from main (`stories.code`): at
 * the PR head its header names, or for an Epic's chapter the head of that chapter's PR. A fragment with no head — none
 * in such a story — shows the story's own code.
 */
export function madeStoryCodeSource(projectId: string): FragmentCodeSource {
  return async (fragment, head, pr) => {
    if (head === null) return storyOwnCode(fragment, head, pr)
    const result = await invoke('stories.code', { projectId, at: { commit: head }, fragment })
    if (!result.ok) throw new Error(failureReason('stories.code', result.error))
    return result.value
  }
}

/** The key main kept each story made by the button under (`StoryMade.key`), by the story shown. */
const madeKeys = new WeakMap<StoryFile, string>()

/**
 * The key a story made by the button was kept under, for stories.ask and stories.answers: main keeps the answers there
 * and reads the PR in the repository it names (a Project over several repositories). Undefined for a story file.
 */
export function madeStoryKey(story: StoryFile): string | undefined {
  return madeKeys.get(story)
}

/** Shows a story made by the button, kept under `key`: kept outside the Project, so a Requirement link opens nothing. */
export function openMadeStory(projectId: string, story: StoryFile, key?: string): void {
  if (key !== undefined) madeKeys.set(story, key)
  openStory(projectId, story, { codeOf: madeStoryCodeSource(projectId) })
}

/** The Epic's own story, `<epic>/story.md`; null while the Epic has none. */
export function epicStoryPath(epic: Pick<Epic, 'stories'> | undefined): string | null {
  return epic?.stories?.find((entry) => entry.kind === 'epic')?.path ?? null
}

/** The story of the PR of Ticket `num` of the Epic, `<epic>/stories/<NN>-<slug>.md`; null while there is none. */
export function ticketStoryPath(epic: Pick<Epic, 'stories'> | undefined, num: number): string | null {
  const nn = String(num).padStart(2, '0')
  return epic?.stories?.find((entry) => entry.kind === 'pr' && entry.ticket === nn)?.path ?? null
}

// The e2e test of the view itself opens a story it holds through this (ticket 09): on only when the page defined
// `__worfyStory` before the app's scripts ran (an init script of the test); the app never does.
const hook = (globalThis as { __worfyStory?: { open?: (projectId: string, story: StoryFile) => void } }).__worfyStory
if (hook !== undefined) hook.open = (projectId, story) => openStory(projectId, story)
