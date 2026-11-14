# Critic: worfy-stuck-agents — 2026-11-14

Plan: `.scratch/worfy-stuck-agents/spec.md`
Verdict: Split — the Run ladder and the silence watchdog rest on observed failures and should ship alone, while the Harness loop detector beyond its record-only call log and the model escalation are built for cases that this project has not yet seen, and both should be cut off into a later step.

## Objections

### 1. The loop detector (tickets 08–11) is built in full for a class the project's own analysis counted at zero

Fact: `docs/research/2026-10-15-застрявшие-ticket-ы.md:113–115` counts 0 cases each of "the same failing command repeats", "oscillation between two approaches" and "test evidence does not change from round to round", and `:198` names the condition to come back to this: "three or more cases without progress (the same failing command, the same test evidence two rounds in a row)". The spec cites that condition for Memento (spec.md:413–415), yet its tickets 09, 10 and 11 (spec.md:439–444) build the deny, the `blocked: loop` report field, the `epic-wave` block rule, the Stop hook fingerprint and Codex parity. It gives no count of such cases since 2026-10-15, and its own question 4 (spec.md:512–515) says "the share of false positives is unknown".

Judgement: The analysis set that revisit condition for this very class, and the spec does not show it is met. So five Harness tickets (01, 08, 09, 10, 11) and three Codex fault scenarios go to a mechanism whose need is unmeasured. These hooks run on every tool call of every agent. Question 4(a) already records the deny before enforcing it. The cheaper cut is ticket 08 in record-only form (call log plus `would-deny` counts, no hint, no deny), and tickets 09–11 wait until that log shows three cases. That cut also removes an ordering defect: in Wave 1, ticket 10 tells the agent to "report blocked: loop" (spec.md:349–350), but that report field and the `epic-wave` rule that acts on it come only in ticket 09, in Wave 3 (spec.md:439–440, :461).

Owner decision:

### 2. Model escalation (ticket 13) is for Eco mode, which the owner kept off for worfy while its measurement waits

Fact: `.scratch/worfy-throughput/issues/43-замер-эффекта-eco-против-full.md:4–6` is `Status: blocked` with "owner 2026-10-30: worfy's profile stays full, a friend tests eco on their own tasks; step 3 waits for those results", `Waits: owner`. The spec's escalation acts "in Eco mode" only (spec.md:110–112), and spec.md:518 admits "on the worfy Profile it has no effect while it is off".

Judgement: Ticket 13 changes the rule "Opus only by an explicit per-Ticket choice", touches the Profile, the Modes menu, `epic-wave`, `ship-ticket` and Run history, and adds a fifth Wave-4 dependency. All of that is for a mode this project does not run, and the measurement that decides whether Eco needs a stronger fallback has not reported. Option 5(b) in the spec, deferring until throughput 43 reports, fits the recorded decision better than the recommended 5(a). The Eco results would then also show which failure events are worth paying Opus for.

Owner decision:

### 3. Ticket 14 puts the English feature-page updates in a separate final Wave, against the project's own implementer rule

Fact: `harness/skills/ship-ticket/SKILL.md:157–161` says that when a change alters behaviour a page in `docs.feature_pages` describes, the implementer must "update that page in this same PR … even if the ticket's file list does not name it". `docs/adr/0088-feature-pages-in-english.md:13–14` says "a PR that changes the behaviour of a Feature edits it". The spec still lists `autopilot.md`, `autopilot-faults.md`, `sessions.md`, `gate-and-github.md`, `orchestrator-modes.md` and `flight-recorder.md` under ticket 14, in Wave 5 (spec.md:449–451, :463).

Judgement: Each of tickets 02–13 will edit those English pages anyway, because the skill makes it do so and the reviewer's `documentation` lens checks it. Ticket 14 as written then either does the same work a second time or invites implementers to skip it. Ticket 14 should keep only what has no owning behaviour PR: the Russian translations, `CONTEXT.md` terms, the Guide texts and the ADR-0024/0029/0046 Amendments. Each ticket's "Done when" should name the English page it changes.

Owner decision:

## Alternative

Epic `worfy-stuck-agents` holds tickets 02–07 and 12: the per-Ticket continuation and set-aside ladder, the `main-red` marker and the silence watchdog with `turn-hung`. Each ticket edits its own English feature page. A slim ticket 14 holds the translations, CONTEXT, the Guide and the ADR Amendments, and 15 is the acceptance. Spike 01 and ticket 08, cut down to a record-only call log, join it with no deny, no hint and no `blocked` field. Tickets 09–11 become a follow-up Epic that starts when the call log shows three repeat cases, the revisit condition of 2026-10-15. Ticket 13 waits for throughput 43. The spec as written still gives a stronger first night: an agent that loops is refused at once rather than only recorded. The price is building and approving on Codex (`/hooks`) a mechanism with an unknown false-positive rate.

## What the critic cannot know

There is no product analytics. The critic cannot tell how many overnight Runs stopped with `wave-unfinished`, `no-progress` or `background-stalled` since the autopilot queue shipped, or how often an agent repeated a failing call. The Run history and transcripts on the owner's machines were not read. The critic did not check whether Claude Code's PostToolUseFailure input carries an exit code or `agent_id` inside a Subagent; the spec leaves that to spike 01. The worktree read is at 04fc90f3a, one commit behind `origin/main` (f926e9bad). The cited lines matched there.
