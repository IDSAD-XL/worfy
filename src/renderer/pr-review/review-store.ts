// The state of Review mode and of Start review outside their components (worfy-pr-review ticket 09): which PR Review mode
// is open on, its file and Show new commits — in the store of the view, so another tab and back keeps them — the
// Project's last choice of who writes the review, and the small rules both screens and their tests share.
import { useEffect, useState, type MouseEvent } from 'react'
import { create } from 'zustand'
import '../../shared/ipc/pr-review'
import type { PrReviewDraftRow, ReviewDraft, ReviewEvent } from '../../shared/ipc/pr-review'
import '../../shared/ipc/shell'
import type { FileEntry } from '../changes/diff-window'
import { invoke, subscribe, windowMachine } from '../ipc'

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

// ── the drafts of the Project, for the chip `Review draft` of a list row (worfy-pr-review ticket 10) ──

/** Grows with each change of a draft this window made: the list reads the drafts again. */
const useDraftsSeq = create<{ seq: number }>(() => ({ seq: 0 }))

/** A draft changed here (a comment saved or deleted, Discard, Start review). */
export function draftChanged(): void {
  useDraftsSeq.setState((state) => ({ seq: state.seq + 1 }))
}

/** The key of a PR in useReviewDrafts' answer. */
export const draftKey = (repo: string, pr: number): string => `${repo.toLowerCase()}#${pr}`

const NO_DRAFTS: ReadonlyMap<string, PrReviewDraftRow> = new Map()

/**
 * The drafts of the Project on this machine (`prReview.drafts`), by draftKey: read when the Project is shown, after each
 * change this window made, and when an Agent review writes one (`prReview.changed`). A Linked machine reads none: the
 * channel is local, the drafts live on the Machine of the Project.
 */
export function useReviewDrafts(projectId: string): ReadonlyMap<string, PrReviewDraftRow> {
  const seq = useDraftsSeq((state) => state.seq)
  const [changed, setChanged] = useState(0)
  const [read, setRead] = useState<{ of: string; drafts: ReadonlyMap<string, PrReviewDraftRow> } | null>(null)
  const away = reviewAway() !== null
  useEffect(() => {
    if (away) return
    return subscribe('prReview.changed', (payload) => {
      if (payload.projectId === projectId) setChanged((value) => value + 1)
    })
  }, [away, projectId])
  useEffect(() => {
    if (away) return
    let current = true
    void invoke('prReview.drafts', { projectId }).then((answer) => {
      if (!current) return
      // A failed read keeps what was shown: the chip is a hint, the draft itself is read by Review mode.
      if (!answer.ok) return
      // An answer without the list (an older main, a stand-in of a test) is no drafts.
      const rows = (answer.value as Partial<typeof answer.value> | null)?.drafts ?? []
      setRead({ of: projectId, drafts: new Map(rows.map((row) => [draftKey(row.repo, row.pr), row])) })
    })
    return () => {
      current = false
    }
  }, [away, projectId, seq, changed])
  return read?.of === projectId ? read.drafts : NO_DRAFTS
}

// ── Finish review (worfy-pr-review ticket 11) ──

/** The verdicts as the Finish review dialog and the bar name them. */
export const EVENT_WORDS: Readonly<Record<ReviewEvent, string>> = { COMMENT: 'Comment', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes' }

/** Opens `url` in the system's browser, never in the window. */
export function openOutside(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}
