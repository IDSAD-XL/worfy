// The state of Review mode and of Start review outside their components (worfy-pr-review ticket 09): which PR Review mode
// is open on, its file and Show new commits — in the store of the view, so another tab and back keeps them — the
// Project's last choice of who writes the review, and the small rules both screens and their tests share.
import { create } from 'zustand'
import type { ReviewDraft } from '../../shared/ipc/pr-review'
import type { FileEntry } from '../changes/diff-window'
import { windowMachine } from '../ipc'

/** Who writes the review. */
export type ReviewHow = 'myself' | 'agent'

/** The reason Start review is inactive on a Linked machine. */
export const LINKED_REVIEW_HINT = 'Review on the machine of the Project'

/**
 * LINKED_REVIEW_HINT in a window of a Linked machine, whatever level it was given, else null: the `prReview.*` channels
 * are `local`, so the draft is never reached from another Machine, even with Full access.
 */
export function reviewAway(): string | null {
  return windowMachine() === null ? null : LINKED_REVIEW_HINT
}

const choiceKey = (projectId: string): string => `worfy.prReview.how.${projectId}`

/** The Project's last choice on this machine; Review myself until one is made. */
export function lastReviewChoice(projectId: string): ReviewHow {
  try {
    return globalThis.localStorage?.getItem(choiceKey(projectId)) === 'agent' ? 'agent' : 'myself'
  } catch {
    return 'myself'
  }
}

export function rememberReviewChoice(projectId: string, how: ReviewHow): void {
  try {
    globalThis.localStorage?.setItem(choiceKey(projectId), how)
  } catch {
    // Storage refused (a full disk): the choice holds for this run only, through the menu.
  }
}

/** How often Review mode reads the PR again while it is shown and the window has the focus. */
export const REVIEW_REFRESH_MS = 2 * 60_000
/** A read older than this is read again when the window gets the focus. */
export const REVIEW_STALE_MS = 60_000

/** The PR Review mode is open on, how it was started, and whether this window may change its draft. */
export interface ReviewOpen {
  projectId: string
  repo: string
  number: number
  how: ReviewHow
  /** A window of a Linked machine: the diff and the threads only. */
  readOnly: boolean
  /** Agent review was chosen and its Session is not asked for yet: Review mode asks once the draft is there. */
  agentAsked: boolean
}

interface ReviewModeStore {
  open: ReviewOpen | null
  /** The file chosen last (fileKey), kept when the view is left and shown again. */
  file: string | null
  /** Show new commits: the diff since the commit of the draft. */
  since: boolean
}

export const useReviewMode = create<ReviewModeStore>(() => ({ open: null, file: null, since: false }))

/** Start review: Review mode on the PR. Agent review asks for its Session once the draft is there. */
export function openReviewMode(target: { projectId: string; repo: string; number: number }, how: ReviewHow, readOnly: boolean): void {
  useReviewMode.setState({ open: { ...target, how, readOnly, agentAsked: how === 'agent' && !readOnly }, file: null, since: false })
}

/** Back to the list; the draft stays. */
export function closeReviewMode(): void {
  useReviewMode.setState({ open: null, file: null, since: false })
}

/** Whether Review mode is open on this PR of the Project. */
export const reviewOpenOn = (open: ReviewOpen | null, projectId: string, row: { repo: string; number: number }): boolean =>
  open !== null && open.projectId === projectId && open.repo.toLowerCase() === row.repo.toLowerCase() && open.number === row.number

/** The commit the draft's comments are numbered on and Submit sends them with: where they were placed last, else where the review started. */
export const draftCommitOf = (draft: Pick<ReviewDraft, 'anchoredOn' | 'startedOn'>): string => draft.anchoredOn ?? draft.startedOn

/** Two commits are one when one is a prefix of the other (a short sha of a draft against a full one). */
export const sameCommit = (a: string, b: string): boolean => a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase())

export const short = (sha: string): string => sha.slice(0, 7)
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** The blob a Viewed mark is set at: the new side's; a deleted file has none, its old one stands in. */
export const viewedBlobOf = (entry: FileEntry): string => entry.file.newBlob ?? `deleted ${entry.file.oldBlob ?? ''}`.trim()

/** Viewed: marked at the blob the file has now. A mark at another blob is one a new head took away. */
export const isViewed = (draft: ReviewDraft | null, entry: FileEntry): boolean => draft !== null && draft.viewed[entry.file.path] === viewedBlobOf(entry)
