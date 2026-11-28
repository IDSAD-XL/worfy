# Critic: worfy-harness-guarantees — 2026-11-28

Plan: `.scratch/worfy-harness-guarantees/spec.md`
Verdict: Reorder — the four parts and the thirteen tickets still hold. But the spec has not changed since the review of 2026-11-14. Ticket 04 still waits for an `owner` status that only ticket 10 writes, the guard and `land` still read the trail at different commits, and the spec does not know the worfy-harness-eval epic, accepted on 2026-11-24, which plans paid cases for the same guard and Stop hook.

## Objections

### 1. Ticket 04 makes `land` wait for an `owner` commit status that nothing can write until ticket 10, yet 04 runs a wave earlier and no `Blocked by:` line joins them

Fact: `.scratch/worfy-harness-guarantees/spec.md:364-365` says "При Q3 (а) или (б) нужная отметка — commit status `owner` на head PR. Её пишет только worfy по кнопке владельца (Ticket 10)"; ticket 04 ends "Blocked by: 02." (`:509`), ticket 10 ends "Blocked by: 03." (`:529`); the waves table puts 04 in wave 2 (`:545`) and 10 in wave 3 (`:546`); the 2026-11-14 review raised this as objection 1, and its `Owner decision:` line is still empty (`docs/product/critic/worfy-harness-guarantees-2026-11-14.md`).

Judgement: Q3 (a) is the recommended answer. Under it, once 04 merges, every documents PR that adds a verification path to a trail waits for an `owner` status that no button writes yet. That covers the ticket PRs of any epic whose trail names `guard.mjs`, `hooks.json` or `scripts/check-*`. The owner is left typing `gh api …/statuses` by hand until 10 lands. Move the `owner` requirement from 04 into 10, or give 10 "Blocked by: 04" and run it in the wave right after 04.

Owner decision: 2026-11-28: принято — 04 без требования owner, требование переходит в 10

### 2. The guard reads the trail at the tip of `origin/main` and `land` reads it at the PR's merge-base, so the owner's own walk-through stops at step 4

Fact: the guard reads the ticket by "`git show <worktree.base>:<путь>`" (`spec.md:341`), and `bin/profile --field worktree.base` prints `origin/main` for this project; `land` reads it by "`git show <merge-base>:<путь>`" (`spec.md:358`); the owner path says "3. Orchestrator дописывает путь в trail documents PR-ом … 4. После merge implementer правит файл, guard пропускает" (`spec.md:169-171`).

Judgement: The implementer's branch exists before the documents PR that extends its trail, so its merge-base still holds the old trail. The guard allows the edit, and then `land` answers "waits — verification paths outside the trail". Every trail extension in the middle of a wave then costs a rebase and a new CI run on top of the owner's mark. Ticket 04 should read the trail at the tip of the base branch, as the guard does. That protects just as well, because the PR's own changes are not on the base branch.

Owner decision: 2026-11-28: принято — guard и land читают trail на вершине base branch

### 3. The spec does not name worfy-harness-eval, accepted on 2026-11-24, whose ticket 15 plans paid eval cases for the same guard and Stop hook that ticket 08 checks for free

Fact: `docs/product/harness-eval/drafts/worfy-harness-eval.md:352` lists "15 | Case-ы: hook guard, hook-и stop и gate, subagent scout", and `:363-364` prices tickets 15–17 at "около 100–200 USD"; its `:326` keeps "Eval на каждой новой версии Claude Code" out of scope as "идея черновика `worfy-harness-guarantees`". This spec's contract set has the cases "(4) `git reset --hard` при незакоммиченной правке отказан; (5) Stop hook держит ход при красном gate" (`spec.md:420-421`). `grep harness-eval .scratch/worfy-harness-guarantees/spec.md` finds nothing, and the "Зависит от" header (`:24-29`) names five epics without it.

Judgement: Two accepted or proposed epics will check the same hook decisions twice. One check is deterministic and free: a stand-in Messages API plus the real binary. The other is paid, with a model, and its graders have to follow every new deny rule that tickets 03, 05 and 06 add. The free contract set should own the question "does the guard refuse and does Stop hold". Paid case 15 should keep only what needs a model: what the agent does after a refusal. Q6 should also say that the run history of worfy-harness-eval is the record a paid per-version run would join. Without this line, case 15 will spend part of its 100–200 USD on facts that `pnpm test` already proves.

Owner decision: 2026-11-28: принято — case-ы guard и Stop в 08 — бесплатная половина worfy-harness-eval 15

## Alternative

Do the deterministic part first and the lexical part second. Wave 1: 01 and 02. Wave 2: 04 without the `owner` requirement and with the trail read at the base-branch tip, plus 07 and 08. In 08, the guard and Stop cases are named as the free half of worfy-harness-eval ticket 15. Wave 3: 10 (the owner button and the `owner` status in `land`) and 03. Last: 06 and then 05, the guard sections that any agent script can bypass (the risk "Лексический guard обходится", `spec.md:558-561`).

The closest other plan is the spec's own Q1 (b): close only draft in `land` and `--admin` in the guard. The plan here is still better than Q1 (b). Q1 (b) also drops 07–09, and those are the only tickets that tell the owner the Harness hooks did not load or broke on a new Claude Code version. That one failure breaks every guarantee at once.

## What the critic cannot know

- Whether the PreToolUse input on Claude Code tells a Subagent from the main thread by `agent_type`. The SDK type in `node_modules` (0.3.289, older than the pinned 0.3.322) says `agent_type` is also present on the main thread of a `--agent` session, and that `agent_id` is the field that separates the two. Spike 01 is meant to answer this on the real binary.
- How often a trail is extended in the middle of a wave. There is no product analytics. The figure of 24 out of 300 commits is the spec's own, and it is not a count of trail extensions.
- How long `land --check` takes inside the 30 s hook limit. It was not timed.
- The line references of the spec have drifted since 2026-11-13. For example, the PreToolUse matcher is now `harness/hooks/hooks.json:187`, not `:157`, and `PR_FIELDS` is `harness/bin/land:356`, not `:280`. The critic checked only the lines its objections rely on.
- Objection 3 of the 2026-11-14 review is resolved and is not repeated here. That objection was the clash with worfy-stuck-agents over the PreToolUse matcher. That epic built its call log as a PostToolUse hook instead (`harness/hooks/hooks.json:197`, `.scratch/worfy-stuck-agents/issues/07-call-log-harness-только-запись.md`), and the matcher is still `Bash|apply_patch`.
