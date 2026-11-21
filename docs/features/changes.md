# Changes

Changes shows what a Ticket changed in its repositories: the files, their lines and the commits, read from git on
the Machine of the Project. worfy writes nothing into the repository while it reads, so the reading is safe next to
an agent that commits in the same worktree at the same moment. New to the terms: start with [Concepts](concepts.md).

## Reading the changes

### Behaviour

#### What is read

The subject is a Ticket, or a pull request ([A pull request](#a-pull-request)). In each repository of the Project,
Changes reads the Ticket's worktree: the worktree whose branch names the Ticket (`<epic>/<NN>`, or the branch of its `Branch:` line). It may be the checkout itself, when the
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
answer is the sizes of the two sides. A patch can also be read with the file's every line as context (the option
`whole` of `changes.file`); the screen has no button for it yet. A type change (a
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

## The Changes view

### Behaviour

#### Opening it

A Ticket card has the button **Changes** when the Ticket has something to read: the worktree branch its status came
from, a `Branch:` line, or work on it (a claimed Ticket). A worktree alone, with neither of these marks, shows no button:
the card is laid out from the Ticket before the worktrees are read. Such a card has room for a second line of actions,
and its action buttons wrap onto it, right-aligned, when they do not fit one line. The button carries no count of
lines. A click opens the Changes view of the Ticket over the whole main area of the window, as the Pull requests view
shows a pull request: the toolbar and the sidebar stay, the Canvas is hidden under it. Nothing is put on the Canvas.

**Open changes** in the Command palette does the same for a Ticket with a branch or in work, and a click on the path of
a comment on code in the chat opens the view on that line ([Send](#send)).

The view has no tab in the toolbar: without a Ticket it has nothing to show. **← Canvas** at the left of its title goes
back to the Canvas, and so does Esc, unless a menu or a popover is open (Esc closes that first) or the focus is in a
text field. Opened from a message in the Session view, the button reads **← Session** and goes back there. Picking
another Project in the sidebar goes back to the Canvas.

A Ticket that turns out to have neither a worktree nor a branch shows that in the view.

#### The screen

| Part | What it holds |
|---|---|
| Title | **← Canvas** (or **← Session**), `Changes · Ticket 03 · <epic>`; «Read only» on the read-only screen of a Linked machine |
| First row | The scope menu, then for each repository the base and the head (`origin/main ← <epic>/03`), the merge-base, the number of files (and of workflow files), the lines added and deleted, and Refresh |
| Second row | Inline or Side by side, Wrap, Hide whitespace, and Compare with the branches to compare against |
| Left | The tree of files with its filter |
| Right | The diff of the files of the tree, one under the other |

The scope menu lists what the repository's answer offers: All changes, Uncommitted (only for a Ticket with a
worktree), and the Ticket's commits under Commit. Compare lists the branches; picking one shows All changes against it.
The scope picked is kept for each Ticket while the window is open, and a restart starts at All changes again; Inline,
Wrap, Hide whitespace and the filter belong to this screen only. Refresh reads the scopes, the files and the patches again: the screen does not refresh by
itself.

Counts are digits alone, without a separator of thousands (`+1243`). Added lines take the background of ready, deleted
lines that of blocked; the code on them takes syntax colours ([Syntax colours](#syntax-colours)).

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

#### Syntax colours

The code of the diff is coloured as on GitHub: the colours of the GitHub themes `github-light-default` and
`github-dark-default`, the one of the window's theme (it follows the system's). Added and deleted lines keep their
background. The colours come a moment after a hunk is drawn; until then the hunk is plain text of the same width.

- The language comes from the file's extension or its name (`Dockerfile`, `Makefile`, `.zshrc`): TypeScript and TSX,
  JavaScript and JSX, JSON, Markdown, CSS, HTML, YAML, TOML, shell, Python, Go, Rust, Swift, Kotlin, Java, C, C++, C#,
  Ruby, PHP, SQL, Vue, Svelte and a few more. A file of any other language stays plain text.
- Each side of a hunk is coloured as one text: the old side (context and deleted lines) and the new side (context and
  added lines). A comment or a string of several lines inside a hunk is coloured on each of its lines; a hunk that
  starts inside such a comment is coloured as if it did not.
- Plain text, too: a line longer than 400 characters, a side of a hunk of more than 100 000 characters and a hunk of
  more than 2 000 lines. A folded file (large, lock, generated) is coloured only after Show, and a binary file never.
- The colours change no text: selection, Copy line, a comment's lines and the message to the agent hold the text of
  the line as `git diff` gives it. There is no switch to turn the colours off.

#### Keys

While the view is shown: `j` and `k` (or `↓` and `↑`) select the next and the previous file and scroll to it, `n` and
`p` scroll to the next and the previous hunk, `c` comments on the lines picked ([Comments on
lines](#comments-on-lines)), Esc takes the lines picked away first and goes back when none are picked. The keys do
nothing while typing in a field or while a menu or a popover is open.

#### Size

A file's patch is read only when the file comes within reach of the screen. The diff draws only the blocks — a
file's header, a hunk, a note — on the screen and two screens above and below it; the rest stand as empty space of
their height, so a Ticket of 300 files or a file of 2 000 lines draws a few screens.

#### On a Linked machine

The view reads the diff on the Machine of the Project, with read-only access too: it changes nothing, so the button
and the palette row are active on a read-only screen. A read-only screen takes no comments on lines: it has no «+», no
`c` and no tray.

### How it works

The view is a view of the window, beside Canvas, Session and Pull requests. What it shows — the Ticket, the view to go
back to and the scope picked for each Ticket — lives in the window's memory, not in the Layout: opening it changes no
Layout and needs no operation of main. Everything it shows comes from the four reading channels above, asked with the
Ticket's `Branch:` and `Repo:` lines. The tree and the diff are the same screen as Review mode of a pull request
([Pull requests](pr-inbox.md)): each adds its own head and its own bar around them.

Older versions put a Changes Node on the Canvas. main removes such Nodes when it reads a Layout, with one log line for
the Project; the comments not sent yet are drafts of their Session and stay.

The diff is drawn by windows, without a library: each block has the height its rows give until it is drawn, and its
measured height after.

The syntax colours are Shiki's (ADR-0113) with its JavaScript engine of regular expressions: no WebAssembly, so the
renderer's Content-Security-Policy stays as it is. Shiki, both themes and each grammar are chunks of their own, loaded
with `import()` on the first hunk that needs them: the window starts without them. A hunk is coloured only while it is
drawn, one hunk at a time: each side is read in steps of about 2 000 characters, each step a task of the event loop of
its own, the state of the grammar carried from step to step. A hunk scrolled out of the window stops at its next step.
The tokens of a hunk are kept by language and text for the next time it is drawn, up to 1 000 000 characters of hunks,
the oldest dropped first. Each token carries its colours of both
themes as CSS variables, and `prefers-color-scheme` picks one.

### Implementation

- `src/renderer/changes/ChangesView.tsx` — the view: the reads, the head with the button back, Esc, the focus.
- `src/renderer/changes/DiffScreen.tsx` — the tree and the diff that the view and Review mode share;
  `src/renderer/changes/diff-keys.ts` — the keys of the view.
- `src/renderer/changes/ScopeBar.tsx`, `src/renderer/changes/FileTree.tsx`, `src/renderer/changes/DiffPane.tsx` — the
  head, the tree and the diff; `src/renderer/changes/changes.css` — their look.
- `src/renderer/changes/highlight.ts` — the syntax colours: the language of a file, the tokens of a hunk side by side,
  the limits, the cache and the queue; `src/renderer/changes/highlight.css` — the colour of the window's theme.
- `src/renderer/changes/diff-window.ts` — the window of the diff, the rows of Side by side, the order of the tree, the
  words of sizes and counts.
- `src/renderer/changes/open.ts` — opening the view, the view to go back to, the scope of each Ticket.
- `src/renderer/canvas/actions/Changes.tsx` — the button on the card; Open changes — `src/renderer/palette/commands.ts`.
- `src/renderer/shell/AppShell.tsx` — the view in the window; `src/main/layout/upgrade.ts` — the old Nodes removed.

Tests: `test/unit/changes-view.test.tsx` (the head and its scope menu from the answer, Inline and Side by side, Wrap,
Hide whitespace, a folded large file and a binary file, Workflow files, the filter, the folders of 301 files, the keys,
the window, ← Canvas and Esc, a menu's Esc, the scope of each Ticket), `test/unit/canvas-actions.test.tsx` (where the
button is, the view it opens, the read-only screen), `test/unit/palette-commands.test.tsx` (Open changes and the
read-only screen), `test/contract/layout-store.test.ts` (the old Nodes removed once),
`test/unit/changes-highlight.test.ts` (the language of a file, the colours of both themes, each side on its own, a
comment of several lines, the limits, the cache, a cancelled request), `test/e2e/changes.spec.ts` (the card, the view
over the window, the files and lines against `git diff <merge-base>`, the colour of a keyword in both themes, ← Canvas,
the palette, 300 files scrolled to the end and a file of 2 100 lines folded).

## Comments on lines

### Behaviour

#### Making one

A comment is made on one line or on a range of lines of one file and one side of the diff:

- **«+»** in the gutter of the line under the pointer; dragged up or down over lines, it comments on the range
  ([Picking a range](#picking-a-range));
- the key **`c`**, or the hint under them, on the lines picked: a click on a line picks it; a click with Shift on a
  line or on its «+», or a selection across lines, picks a range;
- **Comment** in the menu of a right click on a line, next to **Copy line**.

A popover opens over the line. It names the place (`src/cart.ts:13 · new side`), shows the code of the lines and takes
the text and up to three images, pasted or added, as a comment on a quote does
(Comments on quotes, [Sessions](sessions.md)). `⌘↵` (Ctrl+Enter on Windows and Linux) saves it; Esc or a click outside
closes an unchanged popover and keeps a changed one. A changed popover also stays when «+», `c`, Comment or Edit is
used elsewhere: worfy asks to save or cancel it first. The comment then stands under its last line, marked «not sent»,
with Edit and Delete. Delete offers Undo for six seconds.

#### Picking a range

As on GitHub: press **«+»** of the first line, drag up or down over the lines of the same file and side, and let go.
The lines light up as the pointer passes them; letting go opens the popover on the whole range. A line of another file,
of the other side or of another hunk does not change the range: a comment covers lines of one hunk. The window losing
the focus with the button held ends the drag and opens nothing. Letting go on the line pressed comments on that line alone, or on the
range picked when the line is in it. **Shift** with a click on «+» stretches the lines picked to its line and opens
nothing; with nothing picked in that file, side and hunk it picks the line alone. Every way of stretching a pick (the
drag, Shift with «+», a click with Shift on a line, a selection of text across lines) keeps it in the hunk it began in:
a line of another hunk is picked alone (a selection across hunks picks the line it ended on), so the hint never names
lines the comment would not get.

While lines are picked and no popover is open, a hint stands under the last of them: «Comment on lines 95–102 (c)», or
«Comment on line 95 (c)» for one line. A click on it opens the popover, as `c` does. A click on a line outside the range
picks that line instead; Esc takes the pick and the hint away, and so does a new read of the diff (Refresh, Hide whitespace, another scope). Without a line picked, `c` says «Click a line first, then
press c». The same picking, hint included, is in Review mode of a pull request ([Pull requests](pr-inbox.md)).

#### The tray and «To»

The bottom of the view is the tray: «N comments on M files» (and «K on messages» when the Session in «To» has comments
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

Send sends one message to the Session in «To»: the section «Comments on lines of the diff (N)» with the worktree and the
branch (a section per worktree and branch), then for
each comment its path and lines, its side and commit, its code quoted and its text, then «General:» and the text of the
field. The side and commit read `(new side, commit f3bcb3e16)` or `(new side, uncommitted)`: «uncommitted» only when the
file has edits not committed (in the index or the work tree) or git does not track it, otherwise the commit HEAD — in a
clean worktree every comment names HEAD. A file that has uncommitted edits makes all its lines on the new side
«uncommitted», even those already in HEAD. It is the message the Session's own Send would make from the same drafts, comments on its messages included. A
Session that runs no more is started first; one in the middle of a turn keeps the message in its queue. The comments
that went stay dim on their lines, «sent to <Session>». While Send runs, «To», the field, × and Clear in the tray, and
Edit and Delete under a line wait for it: the message goes to the Session it was sent to, with the comments as they
were.

In the Session's chat the message shows each comment as a block with its path and lines. A click on the path opens the
Changes view of the Ticket and scrolls to the line, which flashes; from the Session view its button back reads
**← Session**.

#### After a Refresh

Each comment not sent yet is looked for again in its file's lines and moves with them. This happens in the reads of
the scope and Hide whitespace the Refresh was pressed in, and only for a comment on the commit those reads show on its
side (the work tree for uncommitted lines): a comment made in another scope keeps its lines, true at its commit. On the
new side of All changes and Compare against, a comment made on uncommitted lines or on a head of the Ticket this view
read before is looked for too: the agent committed its file after the comment, or edited it again. The heads read are
kept per Ticket next to the comments, so this holds after another Ticket was opened or worfy restarted. It takes the commit
the new read shows, so it is not left behind by the agent's commit. One
whose lines the read shows and which are gone keeps its place, is marked «Line changed» on the line and in the tray,
and is sent as it was written; lines the read does not show are no news.

### How it works

`changes.targets` reads the list «To» in main: the Session Nodes of the Layout, the stored Bindings, the time of each
transcript's last record and whether Autopilot runs. A Session that runs is named by its live id. A Session that has not
reported its id yet keeps its comments under a placeholder; they move to its id once it reports one.

The comments are kept in the store of comments on quotes, in this window's localStorage, which lives in worfy's data
folder: nothing is written into the repository. The comments that went are kept per Ticket, the newest 200, so they
stay dim after a restart. The commit of a comment is the head of the scope it was made in: the work tree for the lines of
a file with uncommitted edits, HEAD for the other files of a worktree and for a branch, the commit of a Commit scope,
the merge-base for the old side. Which files have uncommitted edits main reads once per list with
`git diff --name-only --no-renames -z <head>` against the head the answer names (read only, as every read of this page), and gives each file of the answer of
`changes.list` the field `uncommitted`: true for those files and the new ones git does not track, false on a branch
checked out nowhere and in a Commit scope, true for every file of Uncommitted.

Picking the lines is one hook, `useLinePick`, for this view and Review mode of a pull request. Pressing «+» listens to
`mousemove` and `mouseup` on the window until the button is let go and takes the line under the pointer by the
`data-side` and `data-line` of its cell. A press of a focused «+» from the keyboard opens its line, as before.

### Implementation

- `src/renderer/changes/line-comments.tsx` — what the diff, the popover, the tray and «To» do together; Send.
- `src/renderer/changes/line-pick.tsx` — picking lines: «+» and its drag, Shift, the clicks and the selection, the hint,
  `c` and Esc; shared with `src/renderer/pr-review/review-comments.tsx`.
- `src/renderer/changes/seen-heads.ts` — the heads of a Ticket the view has read, in the window's storage.
- `src/main/changes/scopes.ts` — `uncommitted` of each file (`listChanges`).
- `src/renderer/changes/LineComment.tsx` — the popover and the boxes under the lines; `src/renderer/changes/Tray.tsx` —
  the tray; `src/renderer/changes/sent-lines.ts` — the comments that went.
- `src/renderer/changes/DiffPane.tsx` — the gutter, the lines picked, the boxes under the lines, the scroll to a line.
- `src/renderer/changes/open.ts` — the request that opens the view on a line; `src/renderer/session/QuotedPrompt.tsx` —
  the block of a comment in the chat.
- `src/main/changes/targets.ts` and `src/main/ipc/changes.ts` — the list «To»; `src/shared/ipc/changes.ts` — its channel.

Tests: `test/unit/changes-line-pick.test.tsx` (the drag of «+», Shift with «+», the hint, the keyboard),
`test/unit/changes-tray.test.tsx` («+», `c`, a range and the drag open the popover, the hint and Esc, the commit HEAD of a
committed file, the tray of the Session in «To»,
another Session takes the comments, «To» keeps a Session with comments, the locks while Send runs, a Refresh in the
comment's own scope and after the agent's commit, a changed popover stays, Read only), `test/contract/changes-read.test.ts`
(`uncommitted` of a file committed, edited, staged, new, on a branch), `test/contract/changes-targets.test.ts` (who is
in «To» and the default), `test/e2e/changes-comments.spec.ts` (two comments, a reload, one message to the fake agent, the
block in the chat opens the view on its line; on the Ticket's checkout a range by dragging «+», the hint, the commit HEAD
and «uncommitted» in the message).

## A pull request

### Behaviour

The subject of Changes may be a pull request: its repository `owner/name`, its number, its head commit and its base
commit. [Review mode](pr-inbox.md#review-mode) of the Pull requests tab opens it: the same tree and diff as the
Changes view, which shows a Ticket. A row of the PR inbox without its head or base commit opens no diff.

- **Read locally when it can be.** When the PR's repository is the `origin` of a checkout of the Project and both its
  commits are in that checkout, the diff is read with the same reading git as a Ticket's: the PR is a branch checked
  out nowhere whose base is the PR's base commit. «Show whole file» works. worfy never fetches: a commit that is not
  in the checkout sends the read to GitHub instead.
- **Else read from GitHub.** The files come from GitHub's list of the PR's files, page after page. GitHub lists at
  most 3,000 files of a PR; past that the tree says «GitHub lists the first 3,000 files». A file GitHub sends without
  a patch — too large, or binary — reads «Large diff · Open on GitHub». An added or removed file, a change of mode or
  a rename without a patch and without a line counted reads «No lines changed»: GitHub does not tell an empty file
  from a binary one, so only a modified file without lines is taken for binary. There is no context past the hunks
  GitHub sent, so a file of such a diff has «View file on GitHub» in its header, and Hide whitespace does not change
  it. The answer is kept in memory by the Project that asked, the PR's head and its base: reading it again for the
  same asks GitHub nothing. Another Project asks again — its GitHub account may not see the repository — and so does a
  PR moved to another base without a push. A repository named with a `.` or `..` part is refused.
- **Scopes of a PR.** All changes (the base against the head), Commit (the PR's commits, newest first), and Since my
  review — the scope Compare against with a commit in place of a branch: the head against the commit the review was
  on, a three-dot diff as GitHub's compare. A PR has no Uncommitted and no branches to compare against.
- **Review threads.** The PR's review threads on GitHub, as the PR inbox reads them with their side, stand under
  their line: a thread on a deleted line under that line of the old file, any other under its line of the new file. In
  All changes both sides are placed; in Since my review only the new side (the old side there is the reviewed commit,
  not the PR's base); a Commit numbers its lines of its own, so there every thread is listed. An outdated thread, one
  without a line, and one whose line the scope or the hunks do not show stand in a list under the file's header,
  «N threads not on a line of this diff», each with where it was («outdated», «no line», «line 101», «old line 9»).
  The diff has no Reply under a thread: a reply is drafted under its thread in the pane of the PR
  ([Draft replies and Send](pr-inbox.md#draft-replies-and-send)), and nothing is sent from the diff.

### How it works

GitHub is read only with `gh api <path>` — a GET, never with `--method` or a field — as the GitHub account the
Project's Profile names, and only while an open screen asks for the files, a file or the commits. The paths are the
PR's files (`pulls/{n}/files`), its commits (`pulls/{n}/commits`), one commit (`commits/{sha}`) and Since my review
(`compare/{a}...{head}`). A patch of GitHub is the hunks of a git patch without its headers: it is read by the same
reading of git's output as a local diff. Why: [ADR-0110](../adr/0110-changes-reads-git-writes-nothing.md), its
Amendment of 2026-11-20.

### Implementation

- `src/main/changes/github.ts` — the files of GitHub as the screen lists them, a patch into hunks, the pages, the
  memory by Project, head and base, the `gh api <path>` call itself (`ghApiGet`).
- `src/main/ipc/changes.ts` — where a PR is read: the checkout whose `origin` is its repository and which has both
  commits, else GitHub.
- `src/renderer/changes/DiffPane.tsx` — the threads on their lines by side and scope, and the list of the others,
  «Large diff · Open on GitHub», «View file on GitHub»; `src/renderer/changes/FileTree.tsx` — «GitHub lists the first
  3,000 files».

Tests: `test/unit/changes-github-patch.test.ts` (a patch of GitHub into hunks, a file without patch, a rename, a
binary file), `test/contract/changes-pr.test.ts` (the local path and the GitHub path over the gh stand-in: 3,000 files,
a file without patch, the memory by Project, head and base, Commit, Since my review, no fetch, the index untouched,
no `--method` in the call the app builds), `test/unit/changes-view.test.tsx` (the threads by side, line and scope, the
notes and the links of a PR's diff), `test/contract/pr-inbox.test.ts` (the side of a thread).
