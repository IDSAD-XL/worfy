# Critic: worfy-limits-ledger — 2026-11-28

Plan: `.scratch/worfy-limits-ledger/spec.md`
Verdict: Split — the token ledger (Tickets 01, 03–11) stands on its own, but the "≈ % of the week" unit is calibrated from Autopilot Wave journals that are too coarse and have stopped arriving, and Ticket 12 builds an Autopilot rule for a Limits wait that no journal on this Mac has ever recorded.

## Objections

### 1. The share-of-week calibration rests on Autopilot Waves whose 7-day growth is stored in whole percents and that have stopped coming

Fact: The spec takes the growth of the 7-day window per Wave (`waveGrowth`) as the numerator and the median of the last 10 Waves as the estimate (`.scratch/worfy-limits-ledger/spec.md:270-276`); the journal folder `~/Library/Application Support/worfy/autopilot` holds 47 journals, the newest `2026-11-19T18-04-33-119Z-da90c1.jsonl`, and its last 10 Waves (runs of 2026-11-17, 2026-11-17T23 and 2026-11-19) grew by 3, 2, 1, 0, 0, 0, 1, 19, 2 and 0 points, the utilization written as `0.22`, `0.24`, `0.25` (and `used_percentage: 61` in `statusline-limits.json`); `git log --since=2026-11-19T08:00` lists 302 commits with no Autopilot journal after them.

Judgement: Four of the ten samples give a coefficient of zero and most of the rest are ±50 % rounding, so the median that every screen shows as "≈ X % of the week" is mostly rounding noise — and with work done outside Autopilot the sample does not refresh. Ticket 02 is set up to discover this, but it is already readable and it decides Q1, the unit of every screen; the steadier source is the current 7-day utilization divided by this Machine's weighted tokens since the window opened (`resetsAt` minus 7 days), one sample of tens of whole percents with a rounding error near 1–2 %.

Owner decision: 2026-11-28: принято — Split: Epic 1 учёт токенов (01, 03–11; 02 калибрует по текущему 7-дневному окну; замена Cost на долю недели — в 10); Epic 2 позже — правило Autopilot Ticket-а 12, когда Cache losses покажет случай; после worfy-harness-guarantees; здесь — Ticket 02 калибрует долю недели по текущему 7-дневному окну, не по Wave-ам Autopilot

### 2. Ticket 12 and the "after a Limits wait" cause serve a path the journals have never seen

Fact: `grep -l '"kind":"limits-hit"'` and `grep -l '"kind":"resumed"'` over all 47 Autopilot journals of this Mac both find 0 files, the same as on 2026-11-14 with 42 journals; Ticket 12 (`spec.md:414-415`) still adds `fresh-after-wait.ts`, a Settings switch and threshold, new `fresh` and `reread` fields on the `resumed` journal line and an e2e Run in `test/e2e/autopilot.spec.ts`, and the screen mock shows "after a Limits wait ≈3.1%" as the largest cause (`spec.md:158`).

Judgement: Ticket 12 is the only ticket that changes what Autopilot does — it replaces the Orchestrator Session in the middle of a Wave — and it pays a journal-format change and an e2e Run for a case with no recorded occurrence. The ledger's own Cache losses tab (Tickets 04 and 08) will show whether this cause exists on real data; until it does, Ticket 12 belongs in a follow-up Epic, which also takes the only Wave 4 ticket touching `src/main/autopilot/run.ts` (now 4328 lines, its `newSession` at `:3082`, not at the `:2248-2285` the spec cites).

Owner decision: 2026-11-28: принято — Split: Epic 1 учёт токенов (01, 03–11; 02 калибрует по текущему 7-дневному окну; замена Cost на долю недели — в 10); Epic 2 позже — правило Autopilot Ticket-а 12, когда Cache losses покажет случай; после worfy-harness-guarantees; здесь — Ticket 12 уходит в Epic 2

### 3. Owner question Q2 (replace the dollar Cost by the share of the week) still has no ticket

Fact: Q2 recommends "(а) Заменить на оценку доли недели, доллары — в tooltip-е" (`spec.md:472-473`); the dollar Cost lives in `src/renderer/canvas/nodes/OrchestratorNode.tsx:158` (`title="Cost of this Session"`) and in the Session view header (`docs/features/sessions.md:216-218`), yet Tickets 01–14 (`spec.md:393-419`) and "Решения по реализации" name neither file nor the header.

Judgement: If the owner answers Q2 (a) or (c), the change has no ticket, and Ticket 10 (chips on Session and Orchestrator Nodes) will put a share chip next to the dollar figure it was meant to replace. Fold the header and Node Cost change into Ticket 10 with its files named, or drop Q2.

Owner decision: 2026-11-28: принято — Split: Epic 1 учёт токенов (01, 03–11; 02 калибрует по текущему 7-дневному окну; замена Cost на долю недели — в 10); Epic 2 позже — правило Autopilot Ticket-а 12, когда Cache losses покажет случай; после worfy-harness-guarantees; здесь — замена Cost на долю недели входит в Ticket 10

## Alternative

Split in two. Epic one, the token ledger: Tickets 01, 03, 04, 05, 06, 07, 08, 09, 10 and 11, with Ticket 02 rewritten to calibrate from the current 7-day window (utilization against weighted tokens since the window opened) instead of Autopilot Wave samples, the Cost change of Q2 folded into Ticket 10, then docs and acceptance. Epic two, later: the Autopilot rule of Ticket 12, opened when the Cache losses tab shows "after a Limits wait" losses on the owner's data. The spec as written is better only if Autopilot Runs that hit the Limits are about to become the usual way of working; the journals of the last two weeks show the opposite.

## What the critic cannot know

- Only the Autopilot journals of this Mac were read; the owner's PC (the Linked machine) may hold Waves and Limits waits.
- The review of 2026-11-14 (`docs/product/critic/worfy-limits-ledger-2026-11-14.md`) raised objections 1–3 in nearly the same form; its `Owner decision:` lines are empty and the spec has not changed since commit `04ed5aa05`, so whether the owner has already weighed them is not known.
- Whether the Limits endpoint itself returns whole percents or worfy rounds them was not traced; `statusline-limits.json` holds an integer `used_percentage`.
- `node_modules` of this checkout holds Agent SDK 0.3.289 while `package.json:29` pins 0.3.322; the `SessionStart` and `PostModelSwitch` hook fields were checked in 0.3.289 only.
- There is no product analytics: how often users switch models mid-conversation or return to a cold Session, and so the worth of the pre-action lines, is not known.
