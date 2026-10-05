// Reading a git branch or a worktree folder as a reference to a Ticket.
//
// worfy names its own branches `<epic>/<NN>` and worktrees `.claude/worktrees/<NN>`; older
// branches and folders carry a slug after the number (`<epic>/<NN>-<slug>`,
// `.claude/worktrees/<NN>-<slug>`). Both forms are understood; anything else is not a Ticket.

/** A Ticket named by a branch: its Epic, number and, in the older form, the slug. */
export interface BranchTicketRef {
  epic: string
  num: number
  slug: string | null
}

/** A Ticket named by a worktree folder. The folder does not carry the Epic. */
export interface FolderTicketRef {
  num: number
  slug: string | null
}

// The Epic is one path segment (an Epic is a folder name); the number is all digits; the slug,
// when present, follows a single dash and is not empty.
const BRANCH = /^(?:refs\/heads\/)?([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d+)(?:-([^/]+))?$/u
const FOLDER = /(?:^|\/)\.claude\/worktrees\/(\d+)(?:-([^/]+))?\/?$/u

/** `worfy-mvp/07`, `worfy-mvp/07-движок-сессий`, `refs/heads/ui-triage-4/01` → a Ticket; else null. */
export function parseTicketBranch(branch: string): BranchTicketRef | null {
  const match = BRANCH.exec(branch.trim())
  if (!match) return null
  const [, epic, digits, slug] = match
  return { epic: epic!, num: Number(digits), slug: slug ?? null }
}

/** `<repo>/.claude/worktrees/07` or `.claude/worktrees/07-движок-сессий` → a Ticket; else null. */
export function parseWorktreeFolder(path: string): FolderTicketRef | null {
  const match = FOLDER.exec(path.trim())
  if (!match) return null
  const [, digits, slug] = match
  return { num: Number(digits), slug: slug ?? null }
}
