---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

The issue tracker is the ticket folder of the worfy project profile: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field tickets.root`; its format and operations are in `${CLAUDE_PLUGIN_ROOT}/bin/TICKETS.md`, section "Wayfinding operations". If the project has no profile, suggest `/worfy:connect-project`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in the tracker doc.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn both sub-agents in parallel

Issue both sub-agent calls together, in the foreground, and aggregate the reports they return.

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## When worfy runs you for Agent review

worfy runs this skill for an Agent review of someone else's pull request when its first message names the pull
request and says so: `/worfy:code-review <owner>/<repo>#<n> Agent review: …`. worfy has created the review draft of
that pull request on this machine already; the person reads it in worfy, changes it, and submits it there. Then:

1. **The fixed point is the base of the pull request; the commit reviewed is the one the message names.**
   `Review the commit <sha>` names the commit worfy's draft is placed on, `<head>` below; it may be older than the
   head of the pull request now, and every line number of the draft is a line of `<head>`. A message that names none:
   `<head>` is `headRefOid`. In the folder of the repository the pull request belongs to (the one whose
   `git remote get-url origin` names `<owner>/<repo>`), read the pull request and open `<head>` in a new temporary
   folder (`mktemp -d`, below `<tmp>`), outside the person's working tree:

   ```bash
   gh pr view <n> --repo <owner>/<repo> --json number,title,body,baseRefName,baseRefOid,headRefOid,files,closingIssuesReferences; echo "EXIT=$?"
   git cat-file -e "<head>^{commit}"; echo "EXIT=$?"
   git cat-file -e "<baseRefOid>^{commit}"; echo "EXIT=$?"
   git -c core.hooksPath=/dev/null worktree add --detach "<tmp>/pr-<n>" "<head>"; echo "EXIT=$?"
   ```

   When a `cat-file` does not exit 0, the commit is missing: fetch it once before the worktree,
   `git -c core.hooksPath=/dev/null fetch origin "pull/<n>/head" "<baseRefName>"`, and run the `cat-file` again. When
   the fetch fails, or the commit is still missing after the fetch (a force push dropped it), stop and say so.

   Run steps 1 to 5 in `<tmp>/pr-<n>` with the fixed point `<baseRefOid>`: the diff is `git diff <baseRefOid>...<head>`
   there, not `gh pr diff` or the `files` of `gh pr view`, which describe the head of now. Remove the worktree at the end
   (`git worktree remove "<tmp>/pr-<n>"`). The spec is the issue of `closingIssuesReferences`, or one the body links.
   The pull request is its author's code and the shell carries the person's GitHub token: run nothing of it — no
   build, no test, no package manager, no script or hook of the repository — only `git diff`, `git show`, `git grep`,
   `git log` and reading files. Paste this sentence into the brief of each sub-agent.
2. **The lenses of the profile.** `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field review.lenses` lists the project's review
   lenses, when it has them: each is one more question of the Standards sub-agent, in its brief.
3. **Write the draft only through `bin/pr-review-draft`**, in place of the report of step 5: one call for each finding on
   a line of the diff, then the summary, the suggested verdict and the end:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/pr-review-draft" <owner>/<repo>#<n> comment <path> <line> [--start-line <first line>] [--side LEFT] - <<'TEXT'; echo "EXIT=$?"
   <the comment>
   TEXT
   "${CLAUDE_PLUGIN_ROOT}/bin/pr-review-draft" <owner>/<repo>#<n> summary - <<'TEXT'; echo "EXIT=$?"
   <the two axes in a few lines>
   TEXT
   "${CLAUDE_PLUGIN_ROOT}/bin/pr-review-draft" <owner>/<repo>#<n> verdict <comment|approve|request_changes>; echo "EXIT=$?"
   "${CLAUDE_PLUGIN_ROOT}/bin/pr-review-draft" <owner>/<repo>#<n> done; echo "EXIT=$?"
   ```

   `<line>` is the line of the file at `<head>` (`--side LEFT`: at the base, for a removed line). A finding on no
   line of that diff goes into the summary, with its `path:line`. A judgement call is written as a question. Never
   write or create the draft file yourself.
4. **The verdict is only a suggestion**: worfy shows it to the person, who chooses the verdict. Suggest
   `request_changes` only for a hard violation or a requirement the spec asks for that is missing.
5. **The person's comments and summary stay as they are**: the script changes only what the agent wrote, and exit 1
   is such a refusal ("the summary is the person's"); do not try another way. When it says the Agent review was
   stopped, stop: the person took the review over.
6. Nothing goes to GitHub: no `gh api` write, no `gh pr review`, no `gh pr comment`. The person submits the review
   in worfy. End with `done`, also when there is no finding.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
