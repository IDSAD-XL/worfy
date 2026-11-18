---
name: pr-fix
description: Fix the failing checks, the conflict with the base or the review comments of the person's pull request in a worktree of its branch, commit, and push only when the person answers "Push". Use on "/worfy:pr-fix <checks|conflicts|comments> <owner>/<repo>#<N> [<sha>]", worfy's actions "Fix checks", "Resolve conflicts" and "Address comments", or when the person asks to fix the red CI, the merge conflict or the review comments of their pull request.
---

# Fix the checks, the conflict or the review comments of a pull request

This skill takes one pull request of the person, makes the change its failing checks (mode `checks`), its conflict with
the base (mode `conflicts`) or its review comments (mode `comments`) ask for in a worktree of its branch, runs the
project's checks there with their exit codes and commits there. The person's checkout keeps its branch, its index and
its files. worfy's actions "Fix checks", "Resolve conflicts" and "Address comments" start a Session with this command;
the person can also type it.

**Push only on the answer "Push".** The commits reach GitHub only when the person answers "Push" to the question of
step 8, in Full mode and in Silent mode alike. A "Push" the person wrote in the request, before the question, is no
answer; a "Not now" written there is one. No answer, a refused question, or a session with no person to answer (an
unattended run): nothing is pushed.

**Nothing else is written to GitHub**, in any session:

- no `gh pr merge`, `gh pr comment`, `gh pr review`, `gh pr edit`, `gh pr close`, `gh pr ready`, `gh pr update-branch`,
  `gh pr revert`, `gh pr lock`, `gh repo sync`, `gh issue comment`, and no `gh` command but the reads of the steps
  below and the rerun of step 3;
- no `gh api` call with a write method (`-X`/`--method` `POST`, `PATCH`, `PUT`, `DELETE`), with `-f`, `-F`, `--field`,
  `--raw-field` or `--input` on a REST path, and no GraphQL `mutation`;
- no resolving of a thread, no request of a review, no reaction, no label;
- no rerun of a check, except on the person's answer in step 3.

**No push rewrites the branch, but one.** No `git push --force`, `-f`, `+<refspec>`, `--force-with-lease` without
its expected commit, or `--force-if-includes` alone. The one push that rewrites the branch of the pull request is the
push of a rebase in mode `conflicts` in Full mode (step 8), `--force-with-lease=<headRefName>:<headRefOid>`: GitHub
refuses it when the branch is no longer at the head this run started from.

Replies to review comments are drafts (step 7): the person sends them. In every folder, the person's checkout and the
worktree alike, there is no `git checkout`, `git switch`, `git stash`, `git reset` or `git pull`; in the person's
checkout the only git commands that write are `git fetch` and `git worktree add`, and a rebase or a merge runs only in
the worktree (step 4).

## 1. The arguments, the profile and the pull request

The arguments: the mode, one pull request — `<owner>/<repo>#<N>` or its link `https://github.com/<owner>/<repo>/pull/<N>`
— and maybe `<sha>`, the head commit the person saw. A missing or malformed argument: ask the person; with no person to
answer, stop and say why.

Run in the project root:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --json; echo "EXIT=$?"
```

Take `_resolved.dir` (the profile folder), `_resolved.mode`, `language.team`, `attribution`, `commands.verify`,
`commands.prepare_tree` and `worktree.root`. Exit 3 means the project is not connected: say so, suggest `/worfy:connect-project`, and stop.

The checkout is the folder of the project whose `git remote get-url origin` names `<owner>/<repo>` on github.com: the
project root, or, in a project of several repositories, the repository folder below it that does. No such folder: stop
and say the pull request is not of this project.

Read the pull request, the person's login and the checks:

```bash
gh pr view <N> --repo <owner>/<repo> --json number,url,state,author,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid,mergeStateStatus; echo "EXIT=$?"
gh api user; echo "EXIT=$?"
gh pr checks <N> --repo <owner>/<repo> --json name,state,bucket,workflow,link,description; echo "EXIT=$?"
```

A command that does not exit 0: show its one line and stop. One exception, in mode `conflicts`: a pull request with no
check at all, as one in conflict may be (GitHub starts no CI run for it), makes `gh pr checks` exit 1 with
`no checks reported on the '<headRefName>' branch`; that is no error, go on with no checks. Stop with the reason when the pull request is not `OPEN`,
when its `author.login` is not the `login` of `gh api user` (not the person's pull request), or when
`isCrossRepository` is true (a fork: its branch is not in this repository). `<sha>` given and not `headRefOid`: say
"The head moved from <sha> to <headRefOid>; working on <headRefOid>", and go on with `headRefOid`.

**Agent marks are not CI.** In the checks, an entry with an empty `workflow` named `review`, `deploy` or `check/<name>`
is a mark an agent set on the head commit, not a CI check: never fix it, and leave it out of steps 3 and 9.

## 2. The worktree

```bash
git -C "<checkout>" worktree list --porcelain; echo "EXIT=$?"
```

- **The Ticket's worktree**: a linked worktree of the list — not its first entry, the main checkout, and not the
  checkout — whose `branch` is `refs/heads/<headRefName>`, whose `HEAD` is `headRefOid` and whose
  `git -C "<it>" status --porcelain` prints nothing. Work there. A detached worktree, or one on another branch, is
  never taken, even at `headRefOid`: it may be another agent's copy for a review.
- **Otherwise a new worktree** at `<root>/<repo>-pr-<N>`: `<root>` is `worktree.root` of the profile, or
  `<checkout>/.claude/worktrees` when the profile has none. When that path is already in the list, clean, and its
  `HEAD` is `headRefOid` or a commit after it (`git -C "<it>" merge-base --is-ancestor "<headRefOid>" HEAD` exits 0:
  the commits of an earlier run of this skill) — in mode `conflicts` also a commit after `baseRefOid`, the rebase of
  an earlier run — work there; when something else is at that path, stop and say what is
  there, removing nothing. In mode `conflicts` that may be the rebase or the merge commit of an earlier run on an older
  base: then also say that `git -C "<it>" reset --hard "<headRefOid>"` puts that worktree back at the head of the pull
  request, so the next run starts over there — a command for the person; this skill does not run it.

```bash
git -C "<checkout>" cat-file -e "<headRefOid>^{commit}"; echo "EXIT=$?"
git -C "<checkout>" worktree add --detach "<worktree>" "<headRefOid>"; echo "EXIT=$?"
```

When the head commit is missing, fetch it once, `git -C "<checkout>" fetch origin "pull/<N>/head"`; when that fails
too, stop and say why. A new worktree has none of the files git does not track (installed dependencies, a build):
when `commands.prepare_tree` is not null, run it there before any other command, and stop with its line when it does
not exit 0:

```bash
cd "<worktree>" && <commands.prepare_tree>; echo "EXIT=$?"
```

The new worktree is detached: no local branch is made or moved, and the push of step 8 names
the branch of the pull request. Every command of steps 3–8 runs in `<worktree>`, as `git -C "<worktree>" …` or
`cd "<worktree>" && …`.

## 3. Mode `checks`: the failing checks

A check is failing when its `bucket` is `fail` or `cancel`. No failing check: say whether CI is green or still
running, and stop. `mergeStateStatus` `DIRTY`: the pull request conflicts with its base and CI does not run on it;
say so, name mode `conflicts` (worfy's action "Resolve conflicts"), and stop.

Read which checks are red on the head of the base branch:

```bash
gh api "repos/<owner>/<repo>/commits/<baseRefName>/check-runs?per_page=100" --jq '.check_runs[] | [.name, .conclusion] | @tsv'; echo "EXIT=$?"
```

A failing check whose name is `failure` there too is **red on the base too**: its cause is outside this pull request.
Name it in the report and leave it. For each other failing check, read the log of its failed job — the `link` of a
GitHub Actions check is `https://github.com/<owner>/<repo>/actions/runs/<run>/job/<job>`:

```bash
gh run view --job <job> --repo <owner>/<repo> --log-failed; echo "EXIT=$?"
```

A check with a link of another CI has no log here: name it with its link and leave it. When the log shows a failure
outside the code — a runner that went away, a download that timed out — ask with AskUserQuestion "Rerun the failed
jobs of <check>?" with the options "Rerun" and "Not now"; only on "Rerun" run
`gh run rerun <run> --repo <owner>/<repo> --failed`. Otherwise fix the cause in the worktree: run the command the log
shows failing (the test, the lint), see it fail the same way, and make the smallest change that turns it green.

## 4. Mode `conflicts`: the conflict with the base

`mergeStateStatus` is what GitHub last computed; `git merge-tree` says whether the head conflicts with the head of the
base now. Name the files in conflict before any change:

```bash
git -C "<worktree>" cat-file -e "<baseRefOid>^{commit}"; echo "EXIT=$?"
git -C "<worktree>" merge-tree --write-tree --name-only "<baseRefOid>" HEAD; echo "EXIT=$?"
```

When the base commit is missing, fetch it once, `git -C "<checkout>" fetch origin "<baseRefName>"`; when that fails
too, stop and say why. `merge-tree` writes no file, no index and no ref: it prints the tree of the merge on its first
line and, on exit 1, the files in conflict, one per line. Another exit code: show its line and stop (git before 2.38
has no `--write-tree`).

- **Exit 0 — no conflict.** When `git -C "<worktree>" merge-base --is-ancestor "<baseRefOid>" HEAD` exits 0, the
  worktree holds the rebase or the merge of an earlier run: go on with step 6. Otherwise say that `<headRefName>` does
  not conflict with `<baseRefName>`, that nothing was changed, and stop: a base that moved on is no reason to rebase
  or merge, and a pull request whose checks are green merges as it is.
- **Exit 1 — a conflict.** Name each file of the list. `git -C "<worktree>" show "<tree>:<file>"`, with `<tree>` the
  first line of the output, shows a file with its conflict markers, and
  `git -C "<worktree>" log --oneline "HEAD...<baseRefOid>" -- <file>` the commits of both sides that changed it.

**A conflict that needs a decision.** Both sides change the same behaviour in different ways, one side deletes what the
other changes, or the two cannot both be kept: that is a decision on the design or the scope, not yours. Ask with
AskUserQuestion "<the conflict, in one line>: how should it be settled?", with one option for each way and "Stop". On
"Stop", with no answer, or with no person to answer: change nothing, push nothing, name the conflict and what it needs,
and stop. Both sides kept as they meant — two additions side by side, two entries of a list — needs no decision.

Then settle it by `_resolved.mode`:

- **Full mode — a rebase** onto the head of the base:

  ```bash
  git -C "<worktree>" rebase "<baseRefOid>"; echo "EXIT=$?"
  ```

  The rebase stops at each commit that conflicts. Settle each file in the worktree — keep what both sides meant, remove
  the markers — add them with `git -C "<worktree>" add <files>`, and go on with
  `git -C "<worktree>" -c core.editor=true rebase --continue`, until the rebase exits 0. A commit whose conflict needs
  a decision: `git -C "<worktree>" rebase --abort` puts the worktree back at `<headRefOid>`; then ask as above.
- **Silent mode — a merge commit.** A branch of a team repository may already be in a colleague's hands: no rebase and
  no force-push. `<message>` is "Merge <baseRefName> into <headRefName>" in `language.team`; check it first with
  `"${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C "<worktree>" "<message>"`:

  ```bash
  git -C "<worktree>" merge -m "<message>" "<baseRefOid>"; echo "EXIT=$?"
  ```

  The merge stops with the conflict. Settle each file as above, add them with `git -C "<worktree>" add <files>`, and
  `git -C "<worktree>" commit --no-edit --cleanup=strip` makes the merge commit with that message: `--cleanup=strip`
  drops the `# Conflicts:` lines git adds to it, which would otherwise reach the team's repository.

The rebase or the merge commit is the commit of this mode: go on with step 6, which checks it.

## 5. Mode `comments`: the review comments

Read `${CLAUDE_PLUGIN_ROOT}/skills/pr-reply/SKILL.md` now: its steps 2–6 apply here as written there, with the
checkout of step 1, except one rule: its step 3 says which threads wait, but its stop when nothing waits does not
apply here. A review that requests changes, a `REJECTED` verdict or a `fixPlan` is fixed with no thread waiting. Run
its three reads of step 2, and also:

```bash
gh pr view <N> --repo <owner>/<repo> --json reviews; echo "EXIT=$?"
```

What asks for a change:

- a review thread that waits for an answer (pr-reply, step 3) and asks for a change the head commit does not have;
- the latest review of each reviewer whose `state` is `CHANGES_REQUESTED`;
- each item of the list in a comment of the conversation whose first line starts with `REJECTED`;
- each reply with a `fixPlan` in the draft file of pr-reply, `<_resolved.dir>/state/pr-inbox/drafts/<owner>-<repo>-<N>.json`,
  when it exists, unless its `state` is `discarded`.

Check each one against the code in the worktree. A request the code proves wrong gets no change, and its reply says
why. Before a change of the design, of the scope of the work or of what a user sees, ask with AskUserQuestion
"<the change, in one line>?" with the options "Make it" and "Skip"; with no person to answer, skip it and name it in
the report. Make every other change in the worktree. Nothing in the list: say that no comment asks for a change, run
step 7 for the threads that wait, and stop with nothing committed.

## 6. Check and commit

Run the project's checks in the worktree; when `commands.verify` is null, the gate:

```bash
cd "<worktree>" && <commands.verify>; echo "EXIT=$?"
cd "<worktree>" && node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"
```

Red: fix it and run again. Still red, or a failure you cannot fix: commit nothing, say what is red, and stop.

Green: commit the change with a message in `language.team` that says what changed and why. In mode `conflicts` the
rebase or the merge commit of step 4 is already committed: commit only a fix a red check needed. In Silent mode the message
carries no epic name, no ticket or decision record number and no path of the Workflow folder; check it first with
`"${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C "<worktree>" "<message>"`. With `attribution` `off`, no line that names an
AI as author.

```bash
git -C "<worktree>" add <files>; echo "EXIT=$?"
git -C "<worktree>" commit -m "<message>"; echo "EXIT=$?"
```

## 7. Mode `comments`: the drafts of the replies

Draft the replies as pr-reply steps 3–6 say, for every thread that waits — pr-reply-draft takes every reply each time —
and hand them to `"${CLAUDE_PLUGIN_ROOT}/bin/pr-reply-draft"`. A thread the commits of step 6 settle gets the label
`resolved by push`, `fixPlan` null, and a reply that says what changed, with the short sha of the commit. `headOid` is
`headRefOid` of step 1. The person sends the drafts after the push; nothing is posted here.

## 8. Push only on "Push"

```bash
git -C "<worktree>" log --oneline "<headRefOid>..HEAD"; echo "EXIT=$?"
```

In mode `conflicts` the commits to name are, in Full mode, the rebased ones,
`git -C "<worktree>" log --oneline "<baseRefOid>..HEAD"`; in Silent mode the merge commit and a fix,
`git -C "<worktree>" log --oneline --first-parent "<headRefOid>..HEAD"`.

First tell the person, also when the answer is already known or no one can answer: each commit (its short sha and
subject), the checks of step 6 with their exit codes, and, when step 1 showed an agent mark `review` with `bucket`
`pass` on the head, that a push moves the head of the pull request: the agents' marks stay on the old commit, and the
Ticket of the pull request goes back to CI and to the agent review. In mode `conflicts` in Full mode, also that the push
rewrites the branch: it replaces `<headRefOid>` and the commits before it with the rebased ones.

Then, unless the person already answered "Not now", ask with AskUserQuestion "Push <n> commit(s) to <headRefName>?"
with the options "Push" and "Not now" — in mode `conflicts` in Full mode "Force-push (with lease) <n> commit(s) to
<headRefName>?", with the same options. Only on "Push", the first command; in mode `conflicts` in Full mode, the
second one instead, never a bare `--force`:

```bash
git -C "<worktree>" push origin "HEAD:refs/heads/<headRefName>"; echo "EXIT=$?"
git -C "<worktree>" push --force-with-lease="<headRefName>:<headRefOid>" origin "HEAD:refs/heads/<headRefName>"; echo "EXIT=$?"
```

A rejected push is never forced. Without the lease it means the branch moved on GitHub; with the lease it means the
branch is no longer at `<headRefOid>`: someone pushed to it after the head this run started from, and a force-push
would drop their commits. Push nothing else — no second lease on the new head, no `--force` — say so, and stop: whether
their commits stay is the person's decision, and this command with the new head starts over on it.

On "Not now", on no answer, and in a session with no person to answer, nothing is pushed: say that the commits wait in
`<worktree>`, that the push waits for the person's "Push", and which of the two commands above pushes them later. In
mode `conflicts` also say how to undo the rebase or the merge commit: `git -C "<worktree>" reset --hard "<headRefOid>"`
puts that worktree back at the head of the pull request. It is a command for the person, in that worktree, never in
their checkout; this skill does not run it.

## 9. Tell the person what comes next

Say what was fixed, what was left and why (a check red on the base too, a change the person skipped, a check of
another CI, a conflict that needs a decision), and which CI to wait for: the checks of step 1 without the agent marks
run again on the new head; `gh pr checks <N> --repo <owner>/<repo> --watch` follows them. In mode `conflicts`, name the
files that were in conflict and how each was settled. When CI is red again, a conflict or a new comment comes, the
action "Fix checks", "Resolve conflicts" or "Address comments" in worfy's Pull requests, or this command with the new
head, starts the next round. In mode `comments`, name the draft file and say the replies are sent from there after the
push.
