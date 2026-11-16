// Opening the Story view (Epic worfy-code-stories, ticket 09): a Code story over the whole main area, beside Run
// history. The view takes a story already read — the data of src/shared/stories/schema.ts — and a function that
// gives the code of each fragment. It reads no file itself: the reader of ticket 08 reads a story file and the
// code from git, and the entries of ticket 10 (the Epic frame, the Ticket card, Pull requests, the toast, the
// Command palette) call openStory with what it read.
import { create } from 'zustand'
import type { Story, StoryFragment } from '../../shared/stories/schema'
import { setView } from '../session/navigation'

/** The code a step shows for a fragment: its lines, the number of the first one and the key lines. */
export interface FragmentCode {
  code: string
  startLine: number
  keyLines: readonly number[]
  /**
   * True when the code is the story's own — the code of the PR head — because the main branch no longer holds
   * it in this form (TICKETS.md, "Story anchor", reader step 3): the view says so above the code.
   */
  fromHead: boolean
}

/**
 * Gives the code of `fragment`, read against `head` — the PR head of the story or of its chapter; null for a
 * chapter without one. Ticket 08 reads it from git; until then, and in the tests, the story's own code serves.
 */
export type FragmentCodeSource = (fragment: StoryFragment, head: string | null) => Promise<FragmentCode>

/** The fragment as the story quotes it: what a story kept with its code shows when nothing reads git. */
export const storyOwnCode: FragmentCodeSource = (fragment) =>
  Promise.resolve({ code: fragment.code, startLine: fragment.startLine, keyLines: fragment.keyLines, fromHead: false })

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
  story: Story | null
  codeOf: FragmentCodeSource
  storyDir: string | undefined
  /** Counts the openings: each one starts the story at its first screen and asks for the focus. */
  opened: number
}

export const useStoryView = create<StoryViewState>(() => ({ projectId: null, story: null, codeOf: storyOwnCode, storyDir: undefined, opened: 0 }))

/** Shows `story` of the Project over the whole main area, at its first screen; Esc goes back to the Canvas. */
export function openStory(projectId: string, story: Story, options: OpenStoryOptions = {}): void {
  useStoryView.setState((state) => ({ projectId, story, codeOf: options.codeOf ?? storyOwnCode, storyDir: options.storyDir, opened: state.opened + 1 }))
  setView('story')
}

// The e2e test opens the view through this until the entries exist (ticket 10): on only when the page defined
// `__worfyStory` before the app's scripts ran (an init script of the test); the app never does.
const hook = (globalThis as { __worfyStory?: { open?: (projectId: string, story: Story) => void } }).__worfyStory
if (hook !== undefined) hook.open = (projectId, story) => openStory(projectId, story)
