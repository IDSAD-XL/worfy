# Critic: worfy-acceptance — 2026-11-14

Plan: `.scratch/worfy-acceptance/spec.md`
Verdict: Defer — the owner's accepted plan for the month allows one new Epic at a time and names `worfy-harness-standalone` as that Epic, which has not started yet. The two cheap parts of this spec are worth doing now without the Epic: the `(manual)` label fix and carrying the owner's 2026-11-06 triage into the tickets.

## Objections

### 1. The spec starts a second new Epic, against the owner's one-at-a-time rule for this month, while the Epic accepted for that slot has not started

Fact: `docs/product/roadmap-worfy/drafts/roadmap-section.md:21-22` (accepted by the owner 2026-11-09, «19 да») says "Новый Epic — не больше одного за раз", and its order item 4 (`:32`) names that one Epic: `worfy-harness-standalone`. `docs/product/roadmap-worfy/issues/04-как-развивается-сам-worfy-в-этом-месяце.md:19-20` records the same owner answer, and `:27` gives "Revisit when: пользователи пришлют замечания или идеи; почти законченные Epic-и закрыты; 2026-12-08". The status line of `drafts/worfy-harness-standalone.md` reads "принят владельцем 2026-11-09 … Orchestrator переносит его в Epic", but `.scratch/` has no `worfy-harness-standalone` folder. The `bin/epic-status` lines given with the brief list 11 Epics that are not closed. A second draft from the same research, `.scratch/worfy-changes-view/spec.md`, is also waiting for acceptance.

Judgement: Accepting this spec now means either jumping ahead of the Epic the owner already accepted for the slot or running two new Epics at once. The owner explicitly rejected the second option ("прежняя скорость с несколькими новыми Epic-ами сразу", `issues/04…md:25`), and none of the three revisit conditions is met. The plan has 11 tickets in 6 waves, and its first usable result is the view in Wave 3. By then the open acceptances it is meant to help with (`worfy-mcp-live` 08, `worfy-ui-kit` 19, `worfy-multi-vendor` 43) will most likely have gone through the existing guides file.

Owner decision:

### 2. The 107-ticket backlog includes manual items the owner already removed on 2026-11-06, and Q5(a) deletes the only record of that decision

Fact: `.scratch/owner-acceptance-guides.md:3` quotes the owner's request: «приёмки оформи в виде списка пошаговых гайдов по каждому нужному эпику, исключи все действия которые можешь сделать сам». `:16` says the owner confirmed the list's contents and its «Убрано» section on 2026-11-06. `:272` moves the Stable copy checks of `worfy-week` and `worfy-harness` 18–25 to the Orchestrator over CDP, and `HANDOFF.md:63` gives the Orchestrator `worfy-week` 05, 08–12, 15, 17, 18 and `worfy-harness` 18, 19, 21, 24, 25. Those items are still unchecked in the tickets, for example `.scratch/worfy-harness/issues/21-harness-в-main-новее-чем-в-stable-copy.md:86` and `.scratch/worfy-week/issues/16-wheel-над-node-ом-после-клика.md:104`. The spec counts them in "118 Ticket-ов … 107 из этих Ticket-ов уже `done`" (`spec.md:35-36`). None of the Q1 options mentions the 2026-11-06 decision, and Q5(a) deletes the guides file (`spec.md:426`).

Judgement: The rule in Ticket 02 (manual, not `[x]`, not `verified`) would put work the owner already handed to the Orchestrator into the owner's own queue. That goes against the 2026-11-06 instruction to leave out everything an agent can do. The real owner-only list is the 13 steps under «Ручные проверки вне приёмок» plus a handful of acceptances, not 166 items, so the size of the problem, and Q1's framing, is overstated. If the spec goes ahead, a docs pass before Ticket 02 should copy the 2026-11-06 triage into the tickets. Q5 should also say that it replaces a format the owner asked for, not one the Orchestrator chose.

Owner decision:

### 3. Ticket 01 is a bug fix that stands on its own and affects open acceptances today; it should not wait for the Epic

Fact: The Profile sets `tickets.manual_mark` to `вручную`. `src/shared/workflow/doc-headings.ts:20` makes `manual` the default and `:30` makes `вручную` the old value, and `accepted()` (`:46`) returns `[value]` alone when the value equals the old one. So with this Profile, `(manual)` is never read as a manual mark. Open tickets that use `(manual)` include the owner acceptances `.scratch/worfy-mcp-live/issues/08-приёмка-владельцем.md:37` and `.scratch/worfy-ui-kit/issues/19-приёмка-владельцем.md:31-32`, plus `worfy-product-session` 08, 21 and 23, which `HANDOFF.md:37` lists as waiting for the owner.

Judgement: Today the Evidence chip, the manual-check rows of the Command palette and Harness `ticket evidence` all miss these items on the very acceptances now in progress. Fixing that is a `worfy-polish` ticket of one or two files per parser copy, plus the shared `grammar.json` cases. Keeping it as Ticket 01 of an Epic that is not accepted holds back a fix that has value whatever happens to the view.

Owner decision:

## Alternative

Take two small pieces now, outside the Epic. First, a `worfy-polish` ticket for the `(manual)` label in both parsers (this spec's Ticket 01). Second, a docs PR that writes the 2026-11-06 «Убрано» and Orchestrator-via-CDP decisions into the tickets they cover; this is close to Q1(б), but it applies a decision the owner already made rather than asking a new one. Keep `owner-acceptance-guides.md` as the owner asked. Bring the Acceptance view back at the 2026-12-08 review of the month plan, or once `worfy-harness-standalone` is done, with the cleaned-up count. The spec as written is still better on one point: the view gives each item one place with its Evidence and the Stable copy line, which the file cannot do. If the owner wants that now and lifts the one-at-a-time rule, the spec should go ahead with the triage pass placed before Ticket 02.

## What the critic cannot know

- Whether the owner lifted the one-new-Epic-at-a-time rule out loud when asking for the competitor research on 2026-11-13. The repository records only the 2026-11-08/09 rule.
- How long the owner actually spends finding and walking through manual checks today. There are no product analytics, so how much time the view would save is unknown.
- The counts of unchecked manual items were taken with `grep` on the current checkout (117 files matched a `- [ ] (вручную|manual` line, close to the spec's 118); items with unusual indentation may be missed.
- No web sources were needed for these objections.
