# Critic: worfy-plan-lint — 2026-11-28

Plan: `.scratch/worfy-plan-lint/spec.md`
Verdict: Defer — the template defect behind part 1 was fixed hours after the draft was written, and no new ticket since then has the defect. Part 2 is still ahead of the condition the roadmap set for it. The one live fault in the plan is a one-line `waves.ts` change that can ship alone.

## Objections

### 1. The main premise of part 1 is gone: `/worfy:to-tickets` writes `## Done when` since #1871, and none of the 207 tickets added after that fix has a missing `Blocked by:` line or an empty "Done when"

Fact: The spec says (`spec.md:19`) "Шаблон `/worfy:to-tickets` пишет пункты-checkbox без заголовка секции", and risk 10 (`spec.md:643`) says "пока шаблон не исправлен, каждый Ticket `/worfy:to-tickets` получит `done-when-missing`". PR #1871 (commit 3fdf6e902, 2026-11-14 22:31, about 19 hours after the draft landed in #1856) added `## Done when` to the template (`harness/skills/to-tickets/SKILL.md:62`, `:89`). Of the 207 ticket files added to `.scratch/*/issues/` since that commit, none lacks a `Blocked by:` line and none has zero checkbox items under "Готово, когда"/"Done when". Of the 45 not-done tickets in the repository, only product-session 28, 30 and 31 (status `blocked` since 2026-11-09) have the defect. Polish 112, the spec's fourth example, has been `done` since 2026-11-16.

Judgement: Part 1 is ten tickets, four of them platform tickets that wait for a Windows verdict (`spec.md:578-580`). Its strongest evidence was a defect in a template that no longer exists, and today it would catch three old tickets an orchestrator can fix by hand in minutes. The remaining checks (`repo-unknown`, `blocked-by-unknown`, cycles) have no measured case in the spec. Wait until a defect is seen again, or until `worfy-harness-standalone` runs a real wave in another project. The spec's Q3(a) already sets that order.

Owner decision: 2026-11-28: принято — Defer

### 2. Part 2 (`plan-readings`, tickets 06–08) still runs ahead of the roadmap condition, because `worfy-product-session` is open at 26/37

Fact: `docs/roadmap.md:415-416` keeps "#1580/2 (реестр неоднозначностей черновика spec) — работа советника, не отдельный gate; кандидат после первого Epic-а". The re-evaluation of 2026-11-07 also places it "как шаг режима советника (#1580/12), не отдельный gate" (`docs/research/2026-11-07-оценка-идей-pr-1580.md`, section 8.2 table, row #1580/2). Today `epic-status` prints "/implement · worfy-product-session 26/37 · ticket 08 … · blocked". The spec says itself (`spec.md:58-59`) "Сколько `REJECTED` выросло из разного прочтения, никто не мерил".

Judgement: Nothing changed since the review of 2026-11-14 (`docs/product/critic/worfy-plan-lint-2026-11-14.md`, objection 1), and that objection's `Owner decision:` line is still empty. Part 2 adds a new agent, an eval and up to five more owner questions on every acceptance, with no measured case of the defect it targets. Q2(в) is the option that follows the roadmap. Part 2 belongs in its own draft once `worfy-product-session` closes.

Owner decision: 2026-11-28: принято — часть 2 после worfy-product-session, как шаг советника

### 3. The one live fault in the plan, the missing `Blocked by:` line that `waves.ts` reads as "no blockers", is still bundled into ticket 04 behind ticket 01

Fact: `src/shared/workflow/waves.ts:130` still reads `if (!ticket.blockedParsed && ticket.blockedRaw !== null) return { kind: 'unparsed', raw: ticket.blockedRaw }`. The launch button refuses on `!ticket.blockedParsed` alone (`src/shared/actions/render-template.ts:163`). Ticket 04 is "Blocked by: 01" and lists this fix next to the `plan` field and the Needs attention column (`spec.md:581`).

Judgement: The fix is one condition and one unit test in `test/unit/waves.test.ts`, and it needs nothing from `epic-lint`. Product-session 28, 30 and 31 have no `Blocked by:` line today, so worfy's own wave and the Harness's wave disagree on them as soon as they are unblocked. As a `worfy-polish` ticket the fix ships now, whatever happens to the rest of this epic.

Owner decision: 2026-11-28: принято — отдельный Ticket worfy-polish 169

## Alternative

Now: one `worfy-polish` ticket for the `waves.ts:130` condition with its unit test. In the same docs PR, the orchestrator adds `Blocked by:` lines to product-session 28, 30 and 31 by hand. Later: bring back a smaller part 1 (`epic-lint`, its place in the wave and `preflight`, worfy and Autopilot) once a form defect is seen again in a new ticket, or after the first wave of `worfy-harness-standalone` in another project. Leave out ticket 03, or fold it into the existing hook. A `PostToolUse` hook already runs on every tool call: `harness/hooks/calls.mjs` from #1947 (2026-11-17), whose header says it "starts no process". The spec still calls `PostToolUse` new (`spec.md:369`), and its hook would start `epic-lint` on every ticket write. Part 2 gets its own draft after `worfy-product-session` closes. The spec's plan is still better in one respect: it writes down the checks and their ids once, and a later part 1 can reuse them as they are.

## What the critic cannot know

There is no product analytics. It is not known how often worfy users in other projects write tickets by hand, outside `/worfy:to-tickets`, and get them wrong. Only this repository was counted, and only for two defects: a missing `Blocked by:` line and an empty "Done when". `repo-unknown`, unknown blockers and cycles were not counted. Tickets that live only on unmerged branches were not seen. The spec header has two `Critic:` lines that contradict each other ("— Split." and "ещё не запускался"). The orchestrator should keep one when it links this review.
