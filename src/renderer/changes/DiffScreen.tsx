// The diff screen that the Changes of a Ticket (ChangesView.tsx) and the Review mode of a pull request
// (pr-review/ReviewMode.tsx) share (worfy-changes-view ticket 08; the owner's decision D1 of 2026-11-21: one screen
// for both): the tree of files on the left (FileTree.tsx), the diff on the right (DiffPane.tsx), and what stands above
// the diff. Each caller puts its own around it — a PR its head, Viewed and the review bar; a Ticket its scopes and the
// tray of comments.
// The folders opened and folded are the caller's (toggledWith of diff-window.ts): the callers draw «Reading…» in
// place of this screen while a read runs, and the folders must outlive it (review round 1 of PR #2124).
// The keys of the screen are diff-keys.ts.
import type { ReactNode } from 'react'
import { DiffPane, type DiffPaneProps } from './DiffPane'
import { FileTree, type FileTreeProps } from './FileTree'

export interface DiffScreenProps {
  /** The tree, with the folders opened and folded kept by the caller. */
  tree: FileTreeProps
  diff: DiffPaneProps
  /** What stands above the diff, in its column: the comments of Review mode off their lines. */
  aboveDiff?: ReactNode
  /** The class of the column of the diff. */
  columnClassName?: string
}

export function DiffScreen({ tree, diff, aboveDiff, columnClassName = 'w-changes__column' }: DiffScreenProps) {
  return (
    <div className="w-changes__main">
      <FileTree {...tree} />
      <div className={columnClassName}>
        {aboveDiff}
        <DiffPane {...diff} />
      </div>
    </div>
  )
}
