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

Not written yet.
