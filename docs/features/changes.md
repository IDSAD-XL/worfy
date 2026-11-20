# Changes

Changes shows what a Ticket changed in its repositories: the files, their lines and the commits, read from git on
the Machine of the Project. worfy writes nothing into the repository while it reads, so the reading is safe next to
an agent that commits in the same worktree at the same moment. New to the terms: start with [Concepts](concepts.md).

## Reading the changes

### Behaviour

#### What is read

The subject is a Ticket. In each repository of the Project, Changes reads the Ticket's worktree: the worktree whose
branch names the Ticket (`<epic>/<NN>`, or the branch of its `Branch:` line). It may be the checkout itself, when the
Ticket's branch is checked out there (`parallel: single`). Without a worktree, Changes reads the Ticket's branch: a
local branch that names the Ticket and is checked out nowhere. A Project over several repositories gives one answer
per repository, and the repository is the top level of every answer. A repository where the Ticket has neither a
worktree nor a branch is left out.

#### The base

The changes are counted from the merge-base of the Ticket with a base branch, never from the tip of the base: a
commit that reached the main branch after the Ticket's branch was made is not part of the Ticket's changes. The base
comes from the Project's Profile, in the order the Harness preflight uses:

1. `worktree.base` (`origin/main`), when that branch exists;
2. else `origin/<default branch>`, the branch `origin/HEAD` points to, then `origin/main`;
3. in a repository without `origin`, in a Project whose Tickets end with `local-green`, the local branch: the value of
   `worktree.base` without `origin/`, then the default branch, `main`, `master`.

When no branch of these exists, the local `main` or `master` is tried in any Project. When there is none, the
repository's answer says there is no base and lists no files.

#### Scopes

| Scope | What it shows | Who has it |
|---|---|---|
| All changes (the default) | The Ticket against the merge-base: its commits, what is not committed yet, and the new files git does not track. Ignored files are not shown | every Ticket |
| Uncommitted | The work tree against `HEAD`, with the new files | a Ticket with a worktree |
| Commit | One commit of the Ticket, from the list of the commits since the merge-base (newest first, at most 500); a merge commit against its first parent | every Ticket |
| Compare against | All changes with any local or remote branch in place of the base | every Ticket |

A branch checked out nowhere has no work tree, so it has no Uncommitted scope, and its All changes are its commits.
Which scopes a repository has is part of its answer.

#### Files and limits

The list of files is always whole: for each file its status (A, M, D, R, T — added, modified, deleted, renamed, type
changed), the lines added and deleted, the modes and the blob ids of the two sides. A file whose modification time
changed but whose text did not is not a change.

The patch of a file is read only when it is asked for. It comes folded, as «Large diff · N lines», when the file has
more than 2 000 lines added and deleted, when its patch is larger than 1 MB, for a lock file of a package manager
(`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock` and the like) and for a file with the git attribute
`linguist-generated`. A folded patch can still be asked for in full, up to 64 MB. A binary file has no lines: its
answer is the sizes of the two sides. «Show whole file» gives the file's every line as context. A type change (a
file that became a link, or a link that became a file) shows both sides: the old side's lines deleted, then the new
side's lines added.

Each line of a patch carries its number on the old side and on the new side. A line that ended with CRLF comes
without the `\r` and is marked CRLF; the last line of a side without an end of line is marked so («\ No newline at
end of file»). Hide whitespace leaves out changes of spaces and of line endings.

In Full mode the files under the Tickets root (`.scratch/`) are marked as the group Workflow files. In Silent mode the
workflow files are not in the repository, so there is no such group.

#### What can be asked for

A file is asked for by its path from the repository's top folder: an absolute path or a path with a `..` part is
refused. On Windows `\` separates the parts of a path too and `C:x` is absolute; on macOS and Linux both `:` and `\`
are plain letters of a file name, so `c:notes.md` opens like any other file. A new file is read only when git itself lists it as a new file of the repository: an ignored file, or any
other file on the Machine, is never read through it.

#### Nothing is written

No read writes into the repository: not the index, not a ref, not an object, not a lock file. Changes never fetches,
stages, stashes or refreshes the index; what `origin` has is what the last fetch left.

#### On a Linked machine

A Linked machine reads the changes of a Project on this Machine, with read-only access too: git runs on the Machine
the Project is on.

### How it works

git runs only through one runner that knows a fixed list of reading commands and refuses any other before git
starts; the commands that have forms that write (`worktree`, `ls-files`, `hash-object`, `cat-file`) run only in the
one form Changes uses. Every run has optional locks off, the refresh of the index by `git diff` off (optional locks
alone do not stop that write), the file system monitor off, no terminal prompt, and paths taken literally, never as
patterns. The variables that would point git at another repository or index (`GIT_DIR`, `GIT_INDEX_FILE` and the
like) are dropped. Names come with `-z` and `core.quotePath=false`, so a path with spaces or letters outside ASCII
reads the same on Windows. No external diff and no text conversion runs. One program of the user's git
configuration can still run: a work-tree file whose modification time changed goes through the clean filter its
`.gitattributes` names (git-lfs, for one), as in any `git diff`. A new file's blob id is that of its bytes as they
are, with no filter. Why it is so: [ADR-0110](../adr/0110-changes-reads-git-writes-nothing.md).

The base comes from the facts of the Profile main already keeps for the workflow (`worktree.base` and
`workflow.finish`), so Changes runs no `bin/profile` of its own.

### Implementation

- `src/main/changes/git.ts` — the reading runner: the list of commands, the settings of every run, the limit of the
  output.
- `src/main/changes/subjects.ts` — the Ticket's worktree or branch in each repository, through the worktree and
  branch readers of `src/main/workflow/reader.ts`.
- `src/main/changes/base.ts` — the base and the merge-base.
- `src/main/changes/scopes.ts` — the scopes: the list of files, one file's patch with the folding, the commits, the
  branches to compare against.
- `src/shared/changes/parse.ts` and `src/shared/changes/types.ts` — the pure reading of git's output and the model.
- The channels `changes.scopes`, `changes.list`, `changes.file` and `changes.commits` (`src/shared/ipc/changes.ts`,
  handled in `src/main/ipc/changes.ts`), all reading.

Tests: `test/unit/changes-parse.test.ts` (the reading of git's output), `test/unit/changes-base.test.ts` (the order of
the base), `test/unit/changes-git.test.ts` (the commands the runner refuses, the settings of every run, the output and
time limits; a refused command starts no process), `test/contract/changes-read.test.ts` (the scopes over real
repositories in a temporary folder, a Ticket in two repositories, a Ticket on the checkout itself with the edge cases
— a staged file, Hide whitespace, type changes, a merge commit, a patch past 1 MB, paths outside the repository — and
the check that the files of `.git` are the same after every read). The contract test runs on the Windows runner of
CI too; the type changes are skipped there, as making a link on Windows needs a privilege the runner does not have.

## The Changes Node

### Behaviour

#### Opening it

A Ticket card has the button **Changes** when the Ticket has something to read: the worktree branch its status came
from, a `Branch:` line, or work on it (a claimed Ticket). A worktree alone, with neither of these marks, shows no button:
the card is laid out from the Ticket before the worktrees are read. Such a card has room for a second line of actions,
and its action buttons wrap onto it, right-aligned, when they do not fit one line. The button carries no count of
lines. The first
click puts a Changes Node right of the strip of Epic frames, at the Ticket's height, on the nearest place that covers
no other Node, and centers the Canvas on it. A second click goes to the Node already there: a Ticket has one Changes
Node, and a hidden or archived one is shown again first.

**Open changes** in the Command palette does the same for a Ticket with a branch or in work: it centers the Canvas on
the Ticket's card and opens the Node next to it. When the card is not drawn within two seconds (its frame is
collapsed), the Node goes right of everything on the Canvas.

A Ticket that turns out to have neither a worktree nor a branch shows that in the Node. Focus mode shows the Node as on
the Canvas: select a Session and the Changes Node and press Focus.

#### The screen

| Part | What it holds |
|---|---|
| Title | `Changes · Ticket 03 · <epic>`; «Read only» on the read-only screen of a Linked machine |
| First row | The scope menu, then for each repository the base and the head (`origin/main ← <epic>/03`), the merge-base, the number of files (and of workflow files), the lines added and deleted, and Refresh |
| Second row | Inline or Side by side, Wrap, Hide whitespace, and Compare with the branches to compare against |
| Left | The tree of files with its filter |
| Right | The diff of the files of the tree, one under the other |

The scope menu lists what the repository's answer offers: All changes, Uncommitted (only for a Ticket with a
worktree), and the Ticket's commits under Commit. Compare lists the branches; picking one shows All changes against it.
The scope picked is kept in the Node, so it is there after a restart; Inline, Wrap, Hide whitespace and the filter
belong to this screen only. Refresh reads the scopes, the files and the patches again: the screen does not refresh by
itself.

Counts are digits alone, without a separator of thousands (`+1243`). Added lines take the colours of ready, deleted
lines those of blocked; there is no syntax highlighting.

#### The tree

The files stand by folder, each with its status letter (A, M, D, R, T) and its lines added and deleted, or «binary». A
Ticket in several repositories has the repositories as the top level. The files under the Tickets root (`.scratch/`)
stand last as the group **Workflow files (N)**, folded; the diff shows them only while the group is open. With more
than 300 files every folder comes folded.

The filter keeps the files whose path, or old path, holds its text in any case. It opens the folders and the workflow
group that keep a match, says «N of M files», and the diff shows the same files. A filter that keeps none says so.

#### The diff

Each file has a header with its status, its path (`old → new` for a rename), its counts and a button that folds the
file. Inline draws one row per line with the numbers of both sides. Side by side draws the old side on the left and the
new side on the right: a run of deleted lines stands beside the run of added lines that follows it, and the longer run
goes on with the other side empty. Wrap wraps long lines; without it a line wider than the diff is cut at its edge.
Hide whitespace reads the files and the patches again without changes of spaces and line endings.

A large file, a lock file and a generated file come folded: «Large diff · N lines · Show» (or «Lock file», «Generated
file»), and Show reads the whole patch. A binary file shows the sizes of its two sides: «Binary file · 12 KB → 14 KB».
A file whose text did not change shows its change of mode.

#### Keys

With the focus in the Node (a click anywhere in it): `j` and `k` select the next and the previous file and scroll to
it, `n` and `p` scroll to the next and the previous hunk, `c` comments on the lines picked ([Comments on
lines](#comments-on-lines)). The keys do nothing while typing in the filter.

#### Size

A file's patch is read only when the file comes within reach of the screen. The diff draws only the blocks — a
file's header, a hunk, a note — on the screen and two screens above and below it; the rest stand as empty space of
their height, so a Ticket of 300 files or a file of 2 000 lines draws a few screens.

#### On a Linked machine

The Node reads the diff on the Machine of the Project, with read-only access too. A read-only screen cannot put a new
Node on the Canvas: the button and the palette row are inactive there until the Node exists, and then go to it. The
scope picked there stays on that screen. A read-only screen takes no comments on lines: it has no «+», no `c` and no
tray.

### How it works

The Node keeps its subject, the Ticket, and its scope in its data in the Layout; its id is `changes:<epic>/<num>`.
Everything it shows comes from the four reading channels above, asked with the Ticket's `Branch:` and `Repo:` lines.
The new Node is placed the way a Session started from the card is, and main corrects any overlap anyway
([ADR-0038](../adr/0038-nodes-never-overlap.md)). The kind has no colour of its own
([ADR-0077](../adr/0077-node-kind-tokens.md)): a new Node type is neutral.

The palette is drawn outside the Canvas and cannot see where a card is, so it leaves a request that the card's
button takes once the card is drawn.

The diff is drawn by windows, without a library: each block has the height its rows give until it is drawn, and its
measured height after.

### Implementation

- `src/renderer/canvas/nodes/ChangesNode.tsx` — the Node: its data, the reads, the keys.
- `src/renderer/changes/ScopeBar.tsx`, `src/renderer/changes/FileTree.tsx`, `src/renderer/changes/DiffPane.tsx` — the
  head, the tree and the diff; `src/renderer/changes/changes.css` — their look.
- `src/renderer/changes/diff-window.ts` — the window of the diff, the rows of Side by side, the order of the tree, the
  words of sizes and counts.
- `src/renderer/changes/open.ts` — one Node per Ticket, where a new one goes, the palette's request to the card.
- `src/renderer/canvas/actions/Changes.tsx` — the button on the card; Open changes — `src/renderer/palette/commands.ts`.

Tests: `test/unit/changes-view.test.tsx` (the head and its scope menu from the answer, Inline and Side by side, Wrap,
Hide whitespace, a folded large file and a binary file, Workflow files, the filter, the folders of 301 files, the keys,
the window), `test/unit/canvas-actions.test.tsx` (where the button is, where the Node goes, the second click),
`test/unit/palette-commands.test.tsx` (Open changes and the read-only screen), `test/e2e/changes.spec.ts` (the card,
the files and lines against `git diff <merge-base>`, the palette, 300 files and a file of 2 100 lines folded).

## Comments on lines

### Behaviour

#### Making one

A comment is made on one line or on a range of lines of one file and one side of the diff:

- **«+»** in the gutter of the line under the pointer;
- the key **`c`** on the lines picked: a click on a line picks it, a click with Shift or a selection across lines picks
  a range;
- **Comment** in the menu of a right click on a line, next to **Copy line**.

A popover opens over the line. It names the place (`src/cart.ts:13 · new side`), shows the code of the lines and takes
the text and up to three images, pasted or added, as a comment on a quote does
(Comments on quotes, [Sessions](sessions.md)). `⌘↵` (Ctrl+Enter on Windows and Linux) saves it; Esc or a click outside
closes an unchanged popover and keeps a changed one. A changed popover also stays when «+», `c`, Comment or Edit is
used elsewhere: worfy asks to save or cancel it first. The comment then stands under its last line, marked «not sent»,
with Edit and Delete. Delete offers Undo for six seconds.

#### The tray and «To»

The bottom of the Node is the tray: «N comments on M files» (and «K on messages» when the Session in «To» has comments
on its messages too), a chip per comment that scrolls to its line, Clear, the list **To**, a field for a general
message and **Send**.

«To» lists the Sessions of worfy bound to the Ticket (a manual Binding wins over the one a launch made), newest record
first, then the Orchestrator. A Session of any Vendor may be there. The default is the bound Session with the newest
record, however old it is; without a bound Session, the Orchestrator. Once the Session shown holds comments or has
taken a Send, «To» keeps it until you pick another: a later default (after a Refresh, or the list read again after a
Send) does not move «To» away from the comments. With the Orchestrator in «To» while Autopilot runs, the tray says
«Autopilot is running».

A comment belongs to the Session in «To»: it is a draft of that Session, the same one its input field lists in its own
tray. Picking another Session moves this Ticket's comments on code to it; comments on messages stay where they are.
The comments not sent yet survive a reload of the window and a restart of worfy.

#### Send

Send sends one message to the Session in «To»: the section «Comments on lines of the diff (N)» with the branch, then for
each comment its path and lines, its side and commit, its code quoted and its text, then «General:» and the text of the
field. It is the message the Session's own Send would make from the same drafts, comments on its messages included. A
Session that runs no more is started first; one in the middle of a turn keeps the message in its queue. The comments
that went stay dim on their lines, «sent to <Session>». While Send runs, «To», the field, × and Clear in the tray, and
Edit and Delete under a line wait for it: the message goes to the Session it was sent to, with the comments as they
were.

In the Session's chat the message shows each comment as a block with its path and lines. A click on the path opens the
Changes Node of the Ticket and scrolls to the line, which flashes.

#### After a Refresh

Each comment not sent yet is looked for again in its file's lines and moves with them. This happens in the reads of
the scope and Hide whitespace the Refresh was pressed in, and only for a comment on the commit those reads show on its
side (the work tree for uncommitted lines): a comment made in another scope keeps its lines, true at its commit. One
whose lines the read shows and which are gone keeps its place, is marked «Line changed» on the line and in the tray,
and is sent as it was written; lines the read does not show are no news.

### How it works

`changes.targets` reads the list «To» in main: the Session Nodes of the Layout, the stored Bindings, the time of each
transcript's last record and whether Autopilot runs. A Session that runs is named by its live id. A Session that has not
reported its id yet keeps its comments under a placeholder; they move to its id once it reports one.

The comments are kept in the store of comments on quotes, in this window's localStorage, which lives in worfy's data
folder: nothing is written into the repository. The comments that went are kept per Ticket, the newest 200, so they
stay dim after a restart. The commit of a comment is the head of the scope it was made in: the worktree for its
uncommitted lines, the commit of a Commit scope, the merge-base for the old side.

### Implementation

- `src/renderer/changes/line-comments.tsx` — what the diff, the popover, the tray and «To» do together; Send.
- `src/renderer/changes/LineComment.tsx` — the popover and the boxes under the lines; `src/renderer/changes/Tray.tsx` —
  the tray; `src/renderer/changes/sent-lines.ts` — the comments that went.
- `src/renderer/changes/DiffPane.tsx` — the gutter, the lines picked, the boxes under the lines, the scroll to a line.
- `src/renderer/changes/open.ts` — the request that opens the Node on a line; `src/renderer/session/QuotedPrompt.tsx` —
  the block of a comment in the chat.
- `src/main/changes/targets.ts` and `src/main/ipc/changes.ts` — the list «To»; `src/shared/ipc/changes.ts` — its channel.

Tests: `test/unit/changes-tray.test.tsx` («+», `c` and a range open the popover, the tray of the Session in «To»,
another Session takes the comments, «To» keeps a Session with comments, the locks while Send runs, a Refresh in the
comment's own scope, a changed popover stays, Read only), `test/contract/changes-targets.test.ts` (who is in «To» and the
default), `test/e2e/changes-comments.spec.ts` (two comments, a reload, one message to the fake agent, the block in the
chat opens the Node on its line).
