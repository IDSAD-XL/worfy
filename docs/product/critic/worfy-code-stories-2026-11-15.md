# Critic: worfy-code-stories — 2026-11-15

Plan: `docs/product/code-stories/drafts/worfy-code-stories.md`
Verdict: Reorder — Ticket 07 (the Epic story) is triggered by a signal that only exists after the documents PR it wants to ride in, so it must change `land` next to Ticket 06 and should wait for it rather than run beside it in Wave 4.

## Objections

### 1. Ticket 07's trigger is circular: "every Ticket with a PR is done" becomes true only inside the documents PR that `land` creates and merges on its own

Fact: The draft, lines 196-199: "его даёт `epic-status --json`: все Ticket-ы с PR — `done`. Тогда, до documents PR, Orchestrator запускает агента … Файл уходит в documents PR". `harness/bin/ticket:13`: "ticket done <epic> <NN> [--pr N]   Status: done <time>; with --pr also `PR: #N`". `harness/bin/land:50-58`: after the merges `land` itself makes one documents PR per run, writes `ticket done <epic> <NN> --pr <N>` there, then commits, pushes, runs `gh pr create` and merges it, with no state-file field for an extra file (`land:80-87` lists `prs[].evidence` as the only extra input). The draft, lines 193-194, gives Ticket 06 the same `land` path ("Тем же путём он дописывает этот шаг"), and line 294 puts 06 and 07 in the same Wave 4.

Judgement: On the main branch the last Ticket's `Status: done` and `PR:` line appear only once the documents PR has merged. That documents PR is the one Ticket 07 wants to put `story.md` into, and the Orchestrator has no point "before the documents PR" to step in, because `land` runs the merge and the documents PR in one background run. An open Ticket has no `PR:` line either, so "Ticket-ы с PR" cannot tell an unfinished code Ticket from an owner-acceptance Ticket. Ticket 07 therefore has to change `land`: either the trigger is "this state file holds the Epic's last code PR" plus a new field for extra documents files, or the story goes into a second documents PR. Ticket 06 changes the same file in the same wave. Add 06 to 07's `Blocked by:`, move 07 to Wave 5, and have the ticket name the `land` change rather than `epic-status`.

Owner decision: accepted — 22-25 да

### 2. Ticket 04 plans a new hidden agent and a new progress channel; worfy already has both in the vendor `oneShot`

Fact: The draft, lines 218-223: "Невидимый агент — новый ADR … В отличие от них ему нужны tools на чтение … Готового канала прогресса у скрытых агентов нет; его даёт этот Epic". `src/main/vendors/one-shot.ts:1-15` (ADR-0094 item 2) defines `OneShot`: "a single request that is not a Session … with read-only tools and a structured answer", with `cwd`, `readOnlyTools`, `outputSchema`, `onActivity` ("Told each line of what the request is doing, while it runs (the draft's progress)") and `signal`. `src/main/projects/connect.ts:522-528` already calls it in a repository folder with `readOnlyTools: DRAFT_TOOLS`, `onActivity` and a stop signal. `src/main/vendors/claude/options.ts:72-74` gives that draft Session `allowedTools` Read, Glob, Grep and disallows Bash. A fake-agent path for e2e of the draft exists (`one-shot.ts:9-10`, `src/main/ipc/projects.ts`).

Judgement: A hidden single request with read-only repository tools and a line-by-line progress callback is already in the code, behind a vendor-neutral interface. Ticket 04 shrinks to a call of `vendorDriver(<vendor>).oneShot` with a story schema, a progress bar over `onActivity`, and the contract test "no new Session Node" for a `cwd` inside a Project folder. The `oneShot` of the profile draft runs in a folder that is not yet a Project, so that case is the one new risk. A new ADR is needed only if that test shows `oneShot` cannot be used there. The "git только на чтение" item is the one real gap: `oneShot` disallows Bash. It can be closed by giving the diff in the prompt, as the draft already plans for the story by button (line 224).

Owner decision: accepted — 22-25 да

### 3. The story file cannot name the commit its fragments are checked against, and that commit is not on the main branch after a squash merge

Fact: The draft, line 61, gives the header "Commit: <head PR>". Lines 180-181: `story-check` checks that "каждый фрагмент совпадает с кодом на commit-е из шапки". Line 43 says the story is committed "в тот же PR", and lines 311-312 say "`story-check` идёт на последнем head PR". `harness/bin/land:40` merges with `gh pr merge <N> --squash --match-head-commit <head>`, so the main branch gets a new commit and not the PR head. The draft, lines 228-229, has worfy read the fragment code "из git, когда показывает шаг".

Judgement: A commit's hash covers its own files, so a story committed in the PR can never hold the hash of the PR head. Every review fix in the same branch (decision 12) would also make any hash written there stale. After the squash merge the PR head lives only in GitHub's `refs/pull/N/head`, and a local branch is removed at cleanup. A step that worfy opens later by `path:line@<head>` then has nothing to read. Ticket 01 should drop the commit from the header. `story-check` should compare fragments with the tree of the commit that contains the story file. worfy should find the code through the commit that brought the file to the main branch (`git log -1 -- <story path>`). Settling this in 01 keeps Tickets 02, 08 and 09 from building on a field that cannot be filled.

Owner decision: accepted — 22-25 да

## Alternative

The same 17 Tickets with three changes. Ticket 01 has a header without a commit and anchors fragments to the commit that holds the story. Ticket 04 becomes a thin use of `oneShot` plus the contract test, and stays in Wave 1. Ticket 07 is blocked by 06, moves to Wave 5, and owns the `land` change for the Epic story: the trigger from the state file and a way to add `story.md` to the documents PR. The closest other plan keeps 06 and 07 in parallel and lets the second to merge rebase onto `land`. That saves a wave, but two implementers would design the same new extension of `land` twice. The reordered plan avoids that.

## What the critic cannot know

- There is no product analytics. How often the owner reads diffs of merged PRs, and whether a story changes that, is not known.
- Whether `oneShot` started with a Project folder as `cwd` makes Claude Code register a session that worfy then shows as a Session Node was not run. Only Ticket 04's contract test can show it.
- How `land` behaves in Silent mode for the review step and the Epic story was read only from its header comment (`tickets_root` null means no documents PR). The Orchestrator's own steps there were not traced.
- The cost figures (about 100 thousand tokens per story by button, a few percent per Ticket) come from the draft's research notes and were not measured again.
