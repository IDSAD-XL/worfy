# Critic: worfy-harness-guarantees — 2026-11-14

Plan: `.scratch/worfy-harness-guarantees/spec.md`
Verdict: Reorder — the four parts and the thirteen tickets are right, but `land` (ticket 04) starts waiting for an `owner` commit status that only ticket 10 can write, the guard and `land` read the trail at different commits, and the PreToolUse matcher change collides with the draft worfy-stuck-agents spec, which changes the same matcher.

## Objections

### 1. Ticket 04 makes `land` wait for an `owner` status that nothing can write until ticket 10, yet 04 runs a wave earlier and neither ticket blocks the other

Fact: `.scratch/worfy-harness-guarantees/spec.md:363-364` says "При Q3 (а) или (б) нужная отметка — commit status `owner` на head PR. Её пишет только worfy по кнопке владельца (Ticket 10)". Ticket 04 is "Blocked by: 02." (`:508`) and ticket 10 is "Blocked by: 03." (`:528`). The waves table puts 04 in wave 2 (`:544`) and 10 in wave 3 (`:545`), next to 06. The risks say "при Q3 (б) каждый PR Epic-а ждёт отметки владельца" (`:578`).

Judgement: Once 04 merges, every PR that adds a verification path to a trail waits for an `owner` status with no button to write it. That includes the ticket PRs of other epics whose trails name `hooks.json`, `guard.mjs` or `scripts/check-*`. The only way out is the owner typing `gh api …/statuses` by hand. Under Q3 (b) it is worse: ticket 06, which edits `guard.mjs` (a verification path), sits in the same wave as 10 and cannot merge until 10 lands. The fix is to move the `owner` requirement out of 04 into 10. Or make 10 "Blocked by: 04" and run it right after 04, with 06 and 05 after 10.

Owner decision:

### 2. The guard reads the trail at the tip of `origin/main`, while `land` reads it at the PR's merge-base, so the owner's own walk-through stalls at step 4

Fact: the guard reads the ticket by "`git show <worktree.base>:<путь>`" (`spec.md:340`), and `worktree.base` is `origin/main` in this profile. `land` reads it by "`git show <merge-base>:<путь>`" (`spec.md:357`). The owner path: "3. Orchestrator дописывает путь в trail documents PR-ом … 4. После merge implementer правит файл, guard пропускает" (`spec.md:168-170`).

Judgement: In step 3 the implementer's branch already exists. Its merge-base comes before the documents PR that extended the trail. The guard now allows the edit, but `land` reads the old trail at the merge-base and answers "waits — verification paths outside the trail". Every trail extension in the middle of a wave therefore costs a rebase and a new CI run on top of the owner's mark. Reading the trail at the tip of the base branch, as the guard does, protects just as well, because the PR's own changes are not on the base branch yet. Ticket 04 should say which commit it reads, and the two readers should be the same.

Owner decision:

### 3. The draft worfy-stuck-agents spec also widens the PreToolUse matcher in `hooks.json:157` and adds a deny to `guard.mjs`, and neither spec mentions the other

Fact: `.scratch/worfy-stuck-agents/spec.md:339-341` says "На 4-й такой вызов `guard.mjs` отказывает … matcher PreToolUse расширяется с `Bash|apply_patch` (`hooks.json:157`) на Edit, Write и MultiEdit". This spec's ticket 03 changes the same line to "`Bash|apply_patch|Edit|Write|MultiEdit|NotebookEdit`" (`spec.md:332`). `grep stuck .scratch/worfy-harness-guarantees/spec.md` finds nothing, and its "Зависит от" header lists five epics but not that one.

Judgement: Both are drafts from the same research of 2026-11-13. If both are accepted, two epics edit the same hook entry and the top of the same guard file. They also add two separate deny logs: the stuck-agents call log with `would-deny`, and `WORFY_GUARD_LOG` with the Journal kind `guard-deny`. Whichever epic runs second needs a `Blocked by:` on the other's matcher ticket and one shared deny record. Otherwise the work is a rebase conflict in `guard.mjs` plus two Run history blocks for one kind of event. One of the two specs should own the matcher change and the deny log, and the other should name it.

Owner decision:

## Alternative

Do the deterministic part first and the lexical part second. Wave 1: 01, 02. Wave 2: 04 without the `owner` requirement, with the trail read at the base-branch tip, then 07 and 08. Wave 3: 10 (the owner button and the `owner` status in `land`) and 05. Last: 03 and 06, the guard sections that any agent script can bypass (`spec.md` risk "Лексический guard обходится"), after one spec owns the matcher. The closest other plan is the spec's own Q1 (b): close only draft in `land` and `--admin` in the guard. This plan is still better than Q1 (b). Q1 (b) also drops 07–09, and they are the only part that tells the owner that Harness hooks did not load or broke on a new Claude Code version. That failure breaks every guarantee at once, not only the security ones.

## What the critic cannot know

- Whether the PreToolUse input on Claude Code carries `agent_type: worfy:implementer` for a Subagent of the Agent tool. Today `guard.mjs:64` reads the agent only on Codex. Spike 01 is meant to answer this.
- How often a trail is extended in the middle of a wave. There is no product analytics. The figure of 24 commits out of 300 that touched verification paths is the spec's own, and it is not a count of trail extensions.
- How long `land --check` takes inside the 30 s limit of the hook. It makes several `gh` calls and a fetch, and it was not timed.
- Who has edited the files in the Harness home until now (`rules*.md`, `profile.json`). Commits there carry one git identity for the owner and the agents alike, so the cost of Q2 (a) for the Orchestrator's own writes cannot be measured.
- The brief named the review file with the date 2026-11-13. It is dated 2026-11-14, today's date, by the critic's rule.
