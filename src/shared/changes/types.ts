// The model of the Changes screen (worfy-changes-view ticket 02; ADR-0110): the files a scope of a Ticket changed,
// their hunks and lines, the commits of the Ticket. Main reads it from git (src/main/changes/); the screen only
// shows it (src/renderer/changes/, ticket 03). The zod schemas of the channels are in src/shared/ipc/changes.ts.

/** How a file changed: Added, Modified, Deleted, Renamed, Type changed (a file became a link or back). */
export const CHANGE_STATUSES = ['A', 'M', 'D', 'R', 'T'] as const
export type ChangeStatus = (typeof CHANGE_STATUSES)[number]

/**
 * The scopes of part 1. `all` — the Ticket's branch against the merge-base with the base, the files not in git
 * yet too; `uncommitted` — the work tree against HEAD, with the new files (only a Ticket with a worktree);
 * `commit` — one commit of the Ticket; `compare` — `all` with another branch in place of the base. A pull request
 * (worfy-pr-review ticket 06) has `all` (its base ↔ its head), `commit`, and `compare` with a commit as `ref`: Since
 * my review, the head against the commit the review was on — a three-dot diff, as GitHub's `compare/{a}...{b}`.
 */
export const SCOPE_KINDS = ['all', 'uncommitted', 'commit', 'compare'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

/** A scope as a request names it. `commit` and `compare` name the repository: a SHA and a branch are one repository's. */
export type ChangesScope =
  | { kind: 'all' }
  | { kind: 'uncommitted' }
  | { kind: 'commit'; repo: string; sha: string }
  | { kind: 'compare'; repo: string; ref: string }

/** Why a file's patch comes folded: more than FOLD_LINES lines or FOLD_BYTES bytes, a lock file, a `linguist-generated` file. */
export const FOLD_REASONS = ['large', 'lock', 'generated'] as const
export type FoldReason = (typeof FOLD_REASONS)[number]

/** One file of a scope, as `changes.list` gives it. */
export interface ChangedFile {
  /** The path from the repository's top folder, with `/`; the new path of a renamed file, the old one of a deleted file. */
  path: string
  /** The path before a rename; null otherwise. */
  oldPath: string | null
  status: ChangeStatus
  /** Lines added and deleted; null for a binary file. */
  additions: number | null
  deletions: number | null
  binary: boolean
  /** The file modes (`100644`, `100755`, `120000`); null on the side the file is not on, and for a file not in git. */
  oldMode: string | null
  newMode: string | null
  /** The blob ids of the two sides; null on the side the file is not on, and on the work-tree side git has not hashed. */
  oldBlob: string | null
  newBlob: string | null
  /** A new file git does not track yet (`ls-files --others --exclude-standard`). */
  untracked: boolean
  /**
   * The file holds what HEAD does not, in the index or the work tree, or git does not track it (worfy-changes-view
   * ticket 09): the lines of its work tree's side are on no commit yet. False for a branch checked out nowhere and for a
   * commit; true for every file of Uncommitted. Absent in an answer of a build before that ticket (a Linked machine)
   * and in the diff of a PR read from GitHub.
   */
  uncommitted?: boolean
  /** A file of the workflow (under the Tickets root of a Project in Full mode): the group Workflow files. */
  workflow: boolean
  /** Why its patch comes folded; null when it comes whole. */
  fold: FoldReason | null
  /** The file at the head on GitHub (`blob_url`): only in the diff of a PR read from GitHub (worfy-pr-review ticket 06). */
  url?: string
}

/** One line of a hunk, with its numbers on the two sides. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  /** The text without the end of line: no `\n`, and no `\r` of a CRLF line. */
  text: string
  /** The line's number on the old side; null for an added line. */
  oldLine: number | null
  /** The line's number on the new side; null for a deleted line. */
  newLine: number | null
  /** The line ended with CRLF. */
  crlf: boolean
  /** «\ No newline at end of file» followed the line: it is the last line of its side and has no end of line. */
  noNewline: boolean
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` line as git printed it. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** The text after the second `@@` (the function git found); empty when none. */
  section: string
  lines: DiffLine[]
}

/** What `changes.file` gives for one file: its hunks, or why there are none. */
export type FileDiff =
  | {
      kind: 'hunks'
      path: string
      oldPath: string | null
      oldMode: string | null
      newMode: string | null
      hunks: DiffHunk[]
      /** The hunks hold the whole file («Show whole file»). */
      whole: boolean
    }
  /** «Large diff · N lines · Show»: `lines` is the lines added and deleted. */
  | { kind: 'folded'; path: string; reason: FoldReason; lines: number }
  /** «Binary file · 12 KB → 14 KB»: the sizes in bytes; null on the side the file is not on. */
  | { kind: 'binary'; path: string; oldSize: number | null; newSize: number | null }
  /**
   * «Large diff · Open on GitHub»: GitHub sent the file of a PR without its patch — too large, or binary (worfy-pr-review
   * ticket 06). `url` is the file on GitHub; null when GitHub named none.
   */
  | { kind: 'no-patch'; path: string; url: string | null }

/** One commit of the Ticket (`git log <merge-base>..HEAD`). */
export interface ChangesCommit {
  sha: string
  short: string
  author: string
  /** The author date, ISO 8601. */
  date: string
  subject: string
}

/** The Ticket a Changes screen shows: its `Branch:` and `Repo:` lines, when it has them. */
export interface ChangesTicketRef {
  kind: 'ticket'
  epic: string
  num: number
  branch?: string | null
  repos?: string[]
}

/**
 * A pull request a Changes screen shows (worfy-pr-review ticket 06): its repository `owner/name`, its number, and the
 * two commits of its diff — the head and the base as GitHub names them (`headRefOid`, `baseRefOid`).
 */
export interface ChangesPrRef {
  kind: 'pr'
  repo: string
  number: number
  headOid: string
  baseOid: string
}

/** What `changes.*` read: a Ticket, or a pull request. */
export type ChangesSubjectRef = ChangesTicketRef | ChangesPrRef
