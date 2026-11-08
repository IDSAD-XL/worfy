# Critic: export — 2026-11-08

Plan: `.scratch/export/spec.md`
Verdict: Reorder — ticket 02 imports `formatRow` of ticket 03, so it cannot start in wave 1.

## Objections

### 1. Ticket 02 waits for ticket 03 and does not say so

Fact: `.scratch/export/issues/02-export-command.md:5` (`Blocked by: —`), `.scratch/export/issues/02-export-command.md:10` (`formatRow` imported from `src/row.mjs`), `.scratch/export/spec.md:18` (02 in wave 1)

Judgement: Ticket 02 needs `src/row.mjs`, which only ticket 03 adds in wave 2, so 02 cannot start in wave 1. An implementer of 02 either stops on a missing module or writes its own `formatRow`, and 03 then collides with it.

Owner decision:

## Alternative

Move ticket 02 to wave 3 with `Blocked by: 03`: wave 1 — 01, wave 2 — 03, wave 3 — 02.

## What the critic cannot know

How often the export is used and by whom: the project has no product analytics, so the plan's
value is not judged here, only its order and its facts.
