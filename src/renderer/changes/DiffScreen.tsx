// The diff screen that the Changes of a Ticket (ChangesView.tsx) and the Review mode of a pull request
// (pr-review/ReviewMode.tsx) share (worfy-changes-view ticket 08; the owner's decision D1 of 2026-11-21: one screen
// for both): the tree of files on the left (FileTree.tsx), the diff on the right (DiffPane.tsx), and what stands above
// the diff. Each caller puts its own around it — a PR its head, Viewed and the review bar; a Ticket its scopes and the
// tray of comments.
// The keys of the screen are diff-keys.ts.
import { useState, type ReactNode } from 'react'
import { DiffPane, type DiffPaneProps } from './DiffPane'
import { FileTree, type FileTreeProps } from './FileTree'

export interface DiffScreenProps {
  /** The tree; the folders opened and folded are the screen's own. */
  tree: Omit<FileTreeProps, 'toggled' | 'onToggle'>
  diff: DiffPaneProps
  /** What stands above the diff, in its column: the comments of Review mode off their lines. */
  aboveDiff?: ReactNode
  /** The class of the column of the diff. */
  columnClassName?: string
}

export function DiffScreen({ tree, diff, aboveDiff, columnClassName = 'w-changes__column' }: DiffScreenProps) {
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  return (
    <div className="w-changes__main">
      <FileTree
        {...tree}
        toggled={toggled}
        onToggle={(key) =>
          setToggled((set) => {
            const next = new Set(set)
            if (!next.delete(key)) next.add(key)
            return next
          })
        }
      />
      <div className={columnClassName}>
        {aboveDiff}
        <DiffPane {...diff} />
      </div>
    </div>
  )
}
