# Critic: worfy-plan-lint — 2026-11-14

Plan: `.scratch/worfy-plan-lint/spec.md`
Verdict: Split — the script that checks ticket form (part 1) rests on defects the repository shows, but the model-read ambiguity pass (part 2, tickets 06–08) brings back an idea rejected on 2026-11-07 before the condition the roadmap set for it is met, and ticket 04 carries a worfy bug fix that needs nothing from the new script.

## Objections

### 1. Part 2 (`plan-readings`, tickets 06, 07, 08) reverses a recorded decision before the condition for revisiting it is met, and the spec itself has no measured case of the defect it targets

Fact: `docs/research/2026-11-07-оценка-идей-pr-1580.md:113` gives the 2026-11-07 verdict on the same idea, "Вердикт: не берём", because owner questions before acceptance, «решено без владельца» marks and `Waits: owner` already cover it; `docs/roadmap.md:415-416` keeps it as advisor work and a "кандидат после первого Epic-а" of the Product Session direction, and that first Epic, `worfy-product-session`, is open at 21/32 in the epic-status lines; the spec's own problem 5 says (`spec.md:58-59`) "Сколько `REJECTED` выросло из разного прочтения, никто не мерил. Круги `REJECTED`, просмотренные для этого черновика, были о дефектах кода."

Judgement: Part 1 has hard evidence (four open tickets with broken form, refusals with exit 2), but part 2 has none: no review round is shown to have failed because two readers understood a "Done when" item differently. Keeping part 2 in this Epic adds a new agent, an eval, three model readers on every spec and up to five more questions per acceptance. The owner is also asked to reverse the decision through Q2 while the spec recommends (а), not (в). Cut tickets 06–08 and the part-2 half of 07 and 10 into a separate draft, to come back after `worfy-product-session` closes, as the roadmap says.

Owner decision:

### 2. Ticket 04 bundles an independent worfy bug fix with reading `epic-lint`, so a known Autopilot fault waits behind ticket 01

Fact: `src/shared/workflow/waves.ts:125` reads `if (!ticket.blockedParsed && ticket.blockedRaw !== null) return { kind: 'unparsed', … }`, so a ticket with no `Blocked by:` line counts as having no blockers. Meanwhile the launch button refuses it on `!ticket.blockedParsed` alone (`src/shared/actions/render-template.ts:135`), and the Harness wave refuses it too ("with `blockedParsed: false`, fix `Blocked by` first", `harness/skills/epic-wave/SKILL.md:260-261`). Ticket 04 in the spec (`spec.md:581`) is "Blocked by: 01" and lists this fix next to the `plan` field and the Needs attention column.

Judgement: The one-line `waves.ts` change and its unit test do not touch `epic-lint` at all. Today it is the cause the spec gives for Autopilot sending a ticket the Harness refuses and then stopping with `no-progress` (`src/shared/autopilot/cycle.ts:274`). In this plan it waits for Wave 2 and for a ticket reviewed at depth `high`. Moving it into a `worfy-polish` ticket now removes a live fault and makes ticket 04 smaller.

Owner decision:

### 3. A second draft written the same day also adds the Harness's first `PostToolUse` hook, so two Node processes would start on every tool call unless the two drafts share one hook

Fact: `.scratch/worfy-stuck-agents/spec.md:105` reads "Новый PostToolUse hook ведёт call log агента", and `:323-324` puts "новые PostToolUse (все tools) и PostToolUseFailure … → новый `harness/hooks/calls.mjs`" into `harness/hooks/hooks.json`. This spec's ticket 03 adds `harness/hooks/plan-lint.mjs` as a separate `PostToolUse` entry with matcher `Write|Edit|MultiEdit` (`spec.md:367-369`). Its own risk 5 (`spec.md:632-634`) says "Node стартует на каждый Write и Edit в каждой Session, на Windows — дольше".

Judgement: Each draft measures the cost of its own hook alone. If both are accepted, every Write and Edit pays for two Node starts, and the startup cost on Windows that risk 5 already worries about doubles. Whichever Epic goes second has to rework `hooks.json` and the timing in its "Итог" section. Either one `PostToolUse` dispatcher should be agreed before both specs are accepted, or ticket 03 should be dropped: the spec says (`spec.md:633-634`) that the lint still runs in `preflight`, the Wave and worfy without it.

Owner decision:

## Alternative

Part 1 only, in two steps. First, a `worfy-polish` ticket that makes `/worfy:to-tickets` write "Done when". The 2026-11-09 decision ordered that ticket and it is still not filed. Add a second polish ticket for the `waves.ts:125` fix. Then a smaller Epic: `epic-lint` (01), its place in the wave, `preflight` and `ticket` (02), worfy and Autopilot (04, 05), docs and acceptance (09, 10). Ticket 03, the hook, follows only after a shared `PostToolUse` hook is agreed with `worfy-stuck-agents`. Part 2 becomes its own draft after `worfy-product-session` closes. The spec's plan is still better in one respect: the stories and the costs of both parts are written once, and Q2 already gives the owner this cut as option (в).

## What the critic cannot know

There is no product analytics, so it is not known how often owners of other projects hit the form defects that `epic-lint` catches. Only this repository's 1005 tickets were counted. The token cost of part 2 (0.3–0.5 M per run) is the spec's estimate, not a measurement. The brief named the review file with the date 2026-11-13, but today is 2026-11-14 and the file carries today's date.
