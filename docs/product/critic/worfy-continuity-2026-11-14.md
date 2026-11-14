# Critic: worfy-continuity — 2026-11-14

Plan: `.scratch/worfy-continuity/spec.md`
Verdict: Reorder — the tickets are right, but the guard against repeating a half-run `git push` or `gh pr merge` lands one wave after the automatic continuation it guards, and the two continuation tickets omit their dependency on the spike.

## Objections

### 1. The "unknown side effects" guard (ticket 07) lands after the automatic continuation it guards (tickets 05 and 06)

Fact: `.scratch/worfy-continuity/spec.md:517–518` puts 05 (Session continuation) and 06 (Run continuation) in Wave 3, and 07 ("Unknown side effects", `07 — 05, 06`) in Wave 4. Lines 354–355 make 07 the ticket that stops a Session with an external call without a result from continuing by itself. The existing Auto-continue already refuses this case: `retryDecision` returns `reason: 'in-flight'` for any external call without a result (`src/shared/agent/continue-plan.ts:992–995`). `docs/features/updates.md:75–76` says "Update automatically" is on by default and builds new versions in the background.

Judgement: Between the merges of Wave 3 and Wave 4, `main` resumes a Session or a Wave cut off in the middle of `gh pr merge` with no check at all. That is weaker than today's Auto-continue rule, and a Stable copy built in that window carries the gap. The detection is a pure function over the events and the Subagent transcripts. It needs only the record from ticket 03, so it can come before 05 and 06, with 05 and 06 blocked by it. The alternative is to fold the refusal into 05 and 06 and leave 07 only the label, the toast and "Checked, include".

Owner decision:

### 2. Tickets 05 and 06 depend on spike 01 but do not name it in `Blocked by`

Fact: The spike's question 6 asks how Claude Code continues a transcript cut off in the middle of a call (`tool_use` without `tool_result`), and says "это нужно Ticket-ам 05 и 06" (`.scratch/worfy-continuity/spec.md:389–390`). Risk 8 says the spike answers this "до Ticket-ов 05 и 06" (`:546–547`). Yet the Waves table gives `05 — 03, 04; 06 — 02, 04` (`:517`). It also says the Wave is recomputed at launch and the table is only a forecast (`:522`). The spike is run by hand with a real model, outside CI (`:380–381`).

Judgement: Only the forecast keeps 01 ahead of 05 and 06. If the manual spike slips, the recomputed Wave 3 starts both continuations without knowing whether a transcript cut mid-call can be resumed at all. That answer decides the design of `restartText` and of the continuation path. Add `01` to the `Blocked by:` of 05 and 06.

Owner decision:

### 3. The epic carries two independent results, and the compaction half closes only with the restart half's manual acceptance on two machines

Fact: The spec says "Epic делает две вещи" (`.scratch/worfy-continuity/spec.md:85`). The compaction chain 01 → 10 → 11 → 12 → 13 has no `Blocked by` edge to the restart tickets 02–09 (`:515–519`). Of the spike's six questions, only question 6 serves the restart half (`:382–390`). Yet 14 is blocked by 02–12 and 15 by 01–14 (`:519–520`). The acceptance in ticket 15 lists only restart checks: "Update посреди Run-а, выход посреди Wave с `git push`, kill worfy) и Windows" (`:509`).

Judgement: The compaction work (Harness rules, a hook, an eval) is measured by its own eval. Its acceptance does not need a Mac Stable Update or a Windows run, but the epic stays open until both halves pass. Splitting it into two epics, with spike question 6 moved into the restart epic, lets compaction close after eval 13 and keeps each spike focused. If the owner keeps one epic, this objection does not change the order. It only decides when the compaction half counts as done.

Owner decision:

## Alternative

Keep the 15 tickets, but change the graph in two places. First, move the side-effect detection (the pure part of 07) into Wave 2, blocked by 03. Then make 05 and 06 blocked by it and by 01. 07 then carries only the label, the toast and "Checked, include" and runs alongside 08. Optionally, split compaction (10–13 plus spike questions 1–5) into its own epic with its own short acceptance. The spec's own order is close behind this one. It is still worse because it ships automatic continuation one wave before the rule that keeps it from repeating a merge.

## What the critic cannot know

There is no product analytics. How often a restart actually cuts off a Run or a Session, and how often compaction hits a long Orchestrator or implementer Session, is not known. So the critic cannot weigh the two halves of the epic against each other. Whether a Stable copy really gets built between Waves 3 and 4 depends on when the owner presses Update, which the repository does not record. The critic did not run the spike's questions against the SDK `0.3.322` types. ADR-0010 (`docs/adr/0010-orchestrator-state-session-id-and-cost-only.md`) says Session state lives only in memory. The spec does not name it among the decisions that ticket 14 amends. That looks like an omission, but it is not an objection, because ADR-0010 rejected only copying transcript facts, and `live-sessions.json` holds non-transcript state. The review is dated 2026-11-14, the date of the run, not the 2026-11-13 date in the brief.
