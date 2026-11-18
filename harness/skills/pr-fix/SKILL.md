---
name: pr-fix
description: Fix the failing checks or the review comments of the person's pull request in a worktree of its branch, commit, and push only when the person answers "Push". Use on "/worfy:pr-fix <checks|conflicts|comments> <owner>/<repo>#<N> [<sha>]", worfy's actions "Fix checks", "Resolve conflicts" and "Address comments", or when the person asks to fix the red CI or the review comments of their pull request.
---

# Fix the checks or the review comments of a pull request

This skill takes one pull request of the person, makes the change its failing checks (mode `checks`) or its review
comments (mode `comments`) ask for in a worktree of its branch, runs the project's checks there with their exit codes
and commits there. The person's checkout keeps its branch, its index and its files. worfy's actions "Fix checks" and
"Address comments" start a Session with this command; the person can also type it.

**Push only on the answer "Push".** The commits reach GitHub only when the person answers "Push" to the question of
step 7, in Full mode and in Silent mode alike. A "Push" the person wrote in the request, before the question, is no
answer; a "Not now" written there is one. No answer, a refused question, or a session with no person to answer (an
unattended run): nothing is pushed.

**Nothing else is written to GitHub**, in any session:

- no `gh pr merge`, `gh pr comment`, `gh pr review`, `gh pr edit`, `gh pr close`, `gh pr ready`, `gh issue comment`;
- no `gh api` call with a write method (`-X`/`--method` `POST`, `PATCH`, `PUT`, `DELETE`), with `-f`, `-F`, `--field`,
  `--raw-field` or `--input` on a REST path, and no GraphQL `mutation`;
- no resolving of a thread, no request of a review, no reaction, no label;
- no rerun of a check, except on the person's answer in step 3.

Replies to review comments are drafts (step 6): the person sends them. In every folder, the person's checkout and the
worktree alike, there is no `git checkout`, `git switch`, `git stash` or `git reset`; in the person's checkout the only
git commands that write are `git fetch` and `git worktree add`.

## 1. The arguments, the profile and the pull request

The arguments: the mode, one pull request — `<owner>/<repo>#<N>` or its link `https://github.com/<owner>/<repo>/pull/<N>`
— and maybe `<sha>`, the head commit the person saw. Mode `conflicts`: answer "Mode conflicts is not supported yet:
nothing was changed", and stop. A missing or malformed argument: ask the person; with no person to answer, stop and say
why.

Run in the project root:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --json; echo "EXIT=$?"
```

Take `_resolved.dir` (the profile folder), `_resolved.mode`, `language.team`, `attribution`, `commands.verify` and
`worktree.root`. Exit 3 means the project is not connected: say so, suggest `/worfy:connect-project`, and stop.

The checkout is the folder of the project whose `git remote get-url origin` names `<owner>/<repo>` on github.com: the
project root, or, in a project of several repositories, the repository folder below it that does. No such folder: stop
and say the pull request is not of this project.

Read the pull request, the person's login and the checks:

```bash
gh pr view <N> --repo <owner>/<repo> --json number,url,state,author,isCrossRepository,baseRefName,headRefName,headRefOid,mergeStateStatus; echo "EXIT=$?"
gh api user; echo "EXIT=$?"
gh pr checks <N> --repo <owner>/<repo> --json name,state,bucket,workflow,link,description; echo "EXIT=$?"
```

A command that does not exit 0: show its one line and stop. Stop with the reason when the pull request is not `OPEN`,
when its `author.login` is not the `login` of `gh api user` (not the person's pull request), or when
`isCrossRepository` is true (a fork: its branch is not in this repository). `<sha>` given and not `headRefOid`: say
"The head moved from <sha> to <headRefOid>; working on <headRefOid>", and go on with `headRefOid`.

**Agent marks are not CI.** In the checks, an entry with an empty `workflow` named `review`, `deploy` or `check/<name>`
is a mark an agent set on the head commit, not a CI check: never fix it, and leave it out of steps 3 and 8.

## 2. The worktree

```bash
git -C "<checkout>" worktree list --porcelain; echo "EXIT=$?"
```

- **The Ticket's worktree**: a linked worktree of the list — not its first entry, the main checkout, and not the
  checkout — whose `HEAD` is `headRefOid` and whose `git -C "<it>" status --porcelain` prints nothing. Work there.
- **Otherwise a new worktree** at `<root>/<repo>-pr-<N>`: `<root>` is `worktree.root` of the profile, or
  `<checkout>/.claude/worktrees` when the profile has none. When that path is already in the list at `headRefOid` and
  clean, work there; when something else is at that path, stop and say what is there, removing nothing.

```bash
git -C "<checkout>" cat-file -e "<headRefOid>^{commit}"; echo "EXIT=$?"
git -C "<checkout>" worktree add --detach "<worktree>" "<headRefOid>"; echo "EXIT=$?"
```

When the head commit is missing, fetch it once, `git -C "<checkout>" fetch origin "pull/<N>/head"`; when that fails
too, stop and say why. The new worktree is detached: no local branch is made or moved, and the push of step 7 names
the branch of the pull request. Every command of steps 3–7 runs in `<worktree>`, as `git -C "<worktree>" …` or
`cd "<worktree>" && …`.

## 3. Mode `checks`: the failing checks

A check is failing when its `bucket` is `fail` or `cancel`. No failing check: say whether CI is green or still
running, and stop. `mergeStateStatus` `DIRTY`: the pull request conflicts with its base and CI does not run on it;
say so and stop.

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

## 4. Mode `comments`: the review comments

Read `${CLAUDE_PLUGIN_ROOT}/skills/pr-reply/SKILL.md` now: its steps 2–6 apply here as written there, with the
checkout of step 1. Run its three reads of step 2, and also:

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
the report. Make every other change in the worktree.

## 5. Check and commit

Run the project's checks in the worktree; when `commands.verify` is null, the gate:

```bash
cd "<worktree>" && <commands.verify>; echo "EXIT=$?"
cd "<worktree>" && node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"
```

Red: fix it and run again. Still red, or a failure you cannot fix: commit nothing, say what is red, and stop.

Green: commit the change with a message in `language.team` that says what changed and why. In Silent mode the message
carries no epic name, no ticket or decision record number and no path of the Workflow folder; check it first with
`"${CLAUDE_PLUGIN_ROOT}/bin/silent-check" -C "<worktree>" "<message>"`. With `attribution` `off`, no line that names an
AI as author.

```bash
git -C "<worktree>" add <files>; echo "EXIT=$?"
git -C "<worktree>" commit -m "<message>"; echo "EXIT=$?"
```

## 6. Mode `comments`: the drafts of the replies

Draft the replies as pr-reply steps 3–6 say, for every thread that waits — pr-reply-draft takes every reply each time —
and hand them to `"${CLAUDE_PLUGIN_ROOT}/bin/pr-reply-draft"`. A thread the commits of step 5 settle gets the label
`resolved by push`, `fixPlan` null, and a reply that says what changed, with the short sha of the commit. `headOid` is
`headRefOid` of step 1. The person sends the drafts after the push; nothing is posted here.

## 7. Push only on "Push"

```bash
git -C "<worktree>" log --oneline "<headRefOid>..HEAD"; echo "EXIT=$?"
```

First tell the person, also when the answer is already known or no one can answer: each commit (its short sha and
subject), the checks of step 5 with their exit codes, and, when step 1 showed an agent mark `review` with `bucket`
`pass` on the head, that a push moves the head of the pull request: the agents' marks stay on the old commit, and the
Ticket of the pull request goes back to CI and to the agent review.

Then, unless the person already answered "Not now", ask with AskUserQuestion "Push <n> commit(s) to <headRefName>?"
with the options "Push" and "Not now". Only on "Push":

```bash
git -C "<worktree>" push origin "HEAD:refs/heads/<headRefName>"; echo "EXIT=$?"
```

A rejected push (the branch moved on GitHub) is never forced: say so and stop. On "Not now", on no answer, and in a
session with no person to answer, nothing is pushed: say that the commits wait in `<worktree>`, that the push waits for
the person's "Push", and that `git -C "<worktree>" push origin "HEAD:refs/heads/<headRefName>"` pushes them later.

## 8. Tell the person what comes next

Say what was fixed, what was left and why (a check red on the base too, a change the person skipped, a check of
another CI), and which CI to wait for: the checks of step 1 without the agent marks run again on the new head;
`gh pr checks <N> --repo <owner>/<repo> --watch` follows them. When CI is red again or a new comment comes, the action
"Fix checks" or "Address comments" in worfy's Pull requests, or this command with the new head, starts the next round.
In mode `comments`, name the draft file and say the replies are sent from there after the push.
