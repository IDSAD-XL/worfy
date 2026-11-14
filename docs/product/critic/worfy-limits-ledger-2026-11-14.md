# Critic: worfy-limits-ledger — 2026-11-14

Plan: `.scratch/worfy-limits-ledger/spec.md`
Verdict: Split — the token ledger stands on its own, but the share-of-week calibration rests on journal data too coarse and too stale to carry it, and Ticket 12 (new Orchestrator Session after a Limits wait) builds an Autopilot rule for a case that has not happened once on this Mac.

## Objections

### 1. The "≈ % of the week" unit is calibrated from Autopilot Wave journals that are too few, too old and too coarse to give a stable coefficient

Fact: The Autopilot journal folder of this Mac (`journalDir`, `src/main/autopilot/journal.ts:40-42`) holds 42 run journals; only 20 Waves have `seven_day` numbers at both ends, all between 2026-11-01 and 2026-11-05 (the newest journal is `2026-11-05T08-31-20-694Z-06024b.jsonl`, while `git log origin/main --since=2026-11-05T09:00` lists 422 merged PRs). `utilization` is stored in whole percents (`0.21`, `0.22`, `0.54`); per-Wave growth is 0 in 7 Waves, 1 in 4, 2 in 5, 3 in 3, 4 in 1, and 4 of the last 10 Waves grew by 0. The spec makes the per-Wave growth the numerator and takes the median of the last 10 samples (`spec.md:269-275`, `ESTIMATE_WAVES` at `src/shared/autopilot/limits-estimate.ts:19`).

Judgement: A sample that grew by 1 whole percent is anywhere between 0.5 and 1.5, and a sample that grew by 0 gives a coefficient of 0, so the median of 10 such samples is mostly rounding; and since nearly all work since 2026-11-05 ran outside Autopilot, the samples will not refresh either. Ticket 02 is meant to find this out, but the answer is already readable today and decides Q1 (the recommended unit on every screen). A cheaper and steadier source needs no Autopilot: the current `seven_day` utilization divided by the weighted tokens of this Machine since the window opened (`resetsAt` minus 7 days) — one sample of about 60 whole percents has a rounding error near 1 %, not 50–100 %.

Owner decision:

### 2. Ticket 12 and the "after a Limits wait" cache-loss cause serve a case the journals have never recorded

Fact: Across all 42 Autopilot journals of this Mac there is no `limits-hit` line and no `resumed` line (`grep '"kind":"limits-hit"'` and `grep '"kind":"resumed"'` over the journal folder both return 0); yet Ticket 12 (`spec.md:413-414`) adds `fresh-after-wait.ts`, a Settings switch and threshold, new optional `fresh` and `reread` fields on the `resumed` journal line, and an e2e Run in `test/e2e/autopilot.spec.ts`, and the screen mock puts "after a Limits wait ≈3.1%" as the largest cause (`spec.md:157`).

Judgement: Ticket 12 is the only ticket that changes what Autopilot does — it closes the Orchestrator Session mid-Wave — and it carries the e2e and journal-format cost of that, for a path with no recorded occurrence. The ledger's own Cache losses tab (Ticket 04 and 08) will show whether this cause matters on real data; until then Ticket 12 belongs in a follow-up, not in this Epic. Cutting it also removes the one Wave 4 ticket that touches `src/main/autopilot/run.ts`.

Owner decision:

### 3. Owner question Q2 (replace the dollar Cost with the share of the week) has no ticket

Fact: Q2 recommends (a) "Заменить на оценку доли недели, доллары — в tooltip-е" for the Cost in the Session header and on the Orchestrator Node (`spec.md:471-472`); the Cost lives in the Session view header (`docs/features/sessions.md:216-218`) and in `src/renderer/canvas/nodes/OrchestratorNode.tsx:158`, but neither file nor the Session header appears in any of Tickets 01–14 (`spec.md:392-418`) or in "Решения по реализации", and `grep -n "Cost\|OrchestratorNode" spec.md` finds them only in the problem section and in Q2.

Judgement: If the owner answers Q2 (a) or (c), the work has no owner ticket and Ticket 10 (chips on Session and Orchestrator Nodes) would add a share chip next to the dollar figure it was meant to replace. Either fold the header and Node Cost change into Ticket 10 with its files named, or drop Q2 from the spec.

Owner decision:

## Alternative

Split into two Epics. First: the token ledger — Tickets 01, 03, 04, 05, 06, 07, 08, 09, 10 and 11 — with calibration from the current 7-day window (utilization against weighted tokens since the window opened) instead of Autopilot Wave samples, the Session header and Node Cost change folded into Ticket 10, docs and acceptance after. Second, later: the Autopilot rule of Ticket 12, opened only when the Cache losses tab shows "after a Limits wait" losses on the owner's data. The spec as written is still better if the owner expects Autopilot Runs with Limits waits to become the usual way of working soon; the journals do not show that.

## What the critic cannot know

- Only the Autopilot journals of this Mac were read; journals of the owner's PC (the Linked machine) were not, and they may hold Waves and Limits waits.
- Whether the usage endpoint itself returns whole percents or worfy rounds them was not traced; the journals show two-decimal fractions only.
- `node_modules` of this worktree holds the Agent SDK 0.3.289 while `package.json:29` pins 0.3.322; the `SessionStart` and `PostModelSwitch` hook fields were checked in 0.3.289 only.
- There is no product analytics: how often users switch models mid-conversation or return to a cold Session, and so the size of the pre-action lines' benefit, is not known.
