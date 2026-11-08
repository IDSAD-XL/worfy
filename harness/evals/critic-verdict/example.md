# Critic: export — 2026-11-08

Plan: `.scratch/export/spec.md`
Verdict: Reorder — ticket 02 imports `formatRow` of ticket 03, so it cannot start in wave 1.

## Objections

### 1. Ticket 02 waits for ticket 03 and does not say so

Ticket 02 prints `formatRow(row)` imported from `src/row.mjs`, which only ticket 03 adds; its header
says `Blocked by: —` and the waves table puts it in wave 1, before 03 in wave 2. An implementer of 02
either stops on a missing module or writes its own `formatRow`, and 03 then collides with it.

Fact: `.scratch/export/issues/02-export-command.md:5` (`Blocked by: —`), `.scratch/export/issues/02-export-command.md:10` (`formatRow` imported from `src/row.mjs`), `.scratch/export/spec.md:18` (02 in wave 1)

Owner decision:

## Alternative

Move ticket 02 to wave 3 with `Blocked by: 03`: wave 1 — 01, wave 2 — 03, wave 3 — 02.

## What the critic cannot know

How often the export is used and by whom: the project has no product analytics, so the plan's
value is not judged here, only its order and its facts.
