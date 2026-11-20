# Critic: worfy-pr-review — 2026-11-20

Plan: `.scratch/worfy-pr-review/spec.md`
Verdict: Reorder — the tickets are the right ones, but three `Blocked by:` lines miss a result another ticket produces, one of them in the unfinished worfy-changes-view epic, whose ticket 05 is being implemented now on the same files.

## Objections

### 1. Tickets 06 and 09 build on worfy-changes-view ticket 05 (line comments in Changes), which is unmerged and in flight on the same files, and neither names it in `Blocked by:`

Fact: `epic-status worfy-changes-view` prints `/implement · worfy-changes-view 4/7 · … · ticket 05 — Комментарии к строкам в Changes`; its commit `071c6186e` on branch `worfy-changes-view/05` (not in `main`) changes `src/renderer/changes/DiffPane.tsx` (+158), `src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts` and adds `src/renderer/changes/LineComment.tsx`; the spec puts ticket 06 (which rewrites `DiffPane`/`FileTree` props to `subject` and edits `src/shared/ipc/changes.ts`) in Wave 1 with `Blocked by: —` (`spec.md:594-597`, `:625`), and ticket 09 reuses "тот же popover и те же клавиши" of that ticket 05 (`spec.md:63`) with `Blocked by: 07, 08` (`spec.md:609`).

Judgement: Started today, ticket 06 would rewrite `DiffPane.tsx` and the `changes.*` channels under a 2,500-line branch that lands on the same lines; one of the two PRs gets a large rebase, and the line references the spec gives for `DiffPane.tsx:17-23` and `:229` go stale as soon as 05 lands. Ticket 09 cannot reuse a popover that is not in `main`. Both tickets need `worfy-changes-view` 05 named in `Blocked by:` (the form `Blocked by: 02, 03, \`worfy-multi-repo-ticket\` 06` is already used in the repository), and Wave 1 holds 01, 02, 04 and 08 until it lands.

Owner decision:

### 2. Ticket 04 (search in main) returns rows with the approvals fields that ticket 02 adds, yet both sit in Wave 1 with "no shared files"

Fact: section 1 says search results carry "поля строки списка: те же, что у строки inbox, плюс поля одобрений (раздел 3)" and `prSearch.pull` reads with `PULL_FIELDS` (`spec.md:303-304`, `:337-338`); `PULL_FIELDS` and the row builder live in `src/main/github/inbox.ts:71` and `src/main/github/inbox.ts:697` (`function rowOf`, not exported); ticket 02 changes `PULL_FIELDS` and adds `approvals` to `PrInboxRow` (`spec.md:378-380`, `:579-580`); the waves table lists ticket 04's files only as `pr-search.ts`, `src/shared/pr-search/`, `src/shared/ipc/pr-search.ts` and says "общих файлов нет" (`spec.md:625`).

Judgement: Ticket 04 must either export and reuse `rowOf` and the field list from `inbox.ts`, the file ticket 02 edits in the same wave, or copy them and drift from the inbox row. Either way it needs 02's `approvals` shape to meet its own spec. `Blocked by: 02` on ticket 04 costs nothing on the critical path, since ticket 05 already waits for 03, which waits for 02.

Owner decision:

### 3. Ticket 08's contract test races against `bin/pr-review-draft`, a script that only ticket 10 creates, and 10 is blocked by 08

Fact: ticket 08 tests "гонка с `bin/pr-review-draft`" (`spec.md:603`); ticket 10 lists `harness/bin/pr-review-draft` among its own deliverables with `Blocked by: 08, 09` (`spec.md:610-613`); `git ls-files` finds no `pr-review-draft` today, and `harness/bin` holds only `review-draft-lint` and `review-history` with "review" in the name.

Judgement: Ticket 08 cannot meet its own definition of done without either writing ticket 10's script early or testing against a stand-in that 10 may later contradict. If the owner answers Q4 "no", ticket 10 disappears (`spec.md:636`) and the test refers to a writer that never exists. The race test and the agent-writer rule belong to ticket 10; ticket 08 should test only main's own writes and the Linked machine refusal.

Owner decision:

## Alternative

Keep the twelve tickets, and change three blocker lines: 06 and 09 also wait for `worfy-changes-view` 05, 04 waits for 02, and the `bin/pr-review-draft` race test moves from 08 to 10. Wave 1 becomes 01, 02, 08 (and 06 once changes-view 05 is merged). Wave 2 becomes 03 and 04, Wave 3 is 05 and 06, and the order after that is unchanged. The first visible result for the owner is still the approvals chip in Wave 2. A closer alternative would also split ticket 09 into "line comments, the Your review bar and Discard" (review depth `medium`) and "the Finish review dialog and `pr-review-submit.ts`" (review depth `max`). Then only the GitHub write gets the most expensive review. The plan as written keeps them together, which is defensible because the dialog shows exactly the comments the UI part creates.

## What the critic cannot know

The critic cannot know whether the unmerged `worfy-changes-view/05` branch will land as it is or change its `DiffPane` props in review. There is no product analytics, so how often users would search beyond This Project, or review others' PRs at all, is not known. The GitHub API facts of the spec (rulesets visible to readers, the `null` classic protection, the unverified pending-review behaviour) were not re-queried against GitHub.
