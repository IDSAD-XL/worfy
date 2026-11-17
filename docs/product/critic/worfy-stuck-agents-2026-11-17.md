# Critic: worfy-stuck-agents — 2026-11-17

Plan: `.scratch/worfy-stuck-agents/spec.md`
Verdict: Split — the ladder for `wave-unfinished`, the `main-red` stop and the quiet-turn watchdog stand, but ticket 08 (a continuation for `background-stalled`) treats a stop that the project's own records show only once, as a false stop that is already fixed, and it should leave this Epic.

## Objections

### 1. Ticket 08 builds a continuation ladder for `background-stalled`, a stop that the project has recorded only once, as a false stop since fixed

Fact: The Autopilot run journals on the owner's Mac (`<WORFY_DATA_DIR>/autopilot/*.jsonl`, `src/main/autopilot/journal.ts:1`) hold 42 runs from 2026-10-06 to 2026-11-05. Their `run-stopped` reasons are `blocked-tickets` 17, `wave-unfinished` 9, `user-stop` 8, `no-ready-wave` 4, `no-progress` 2, `turn-error` 1, `app-quit` 1 and `background-stalled` 0, although the reason has existed since 44bd98e0d (2026-10-06). The one `background-stalled` the tickets record is the PC run of 2026-11-06, a live gate full taken for a stalled task (`.scratch/worfy-polish/issues/61-run-не-считает-живую-долгую-фоновую-задачу-зависшей.md:11–17`), fixed by #1531. Today `tasks-timeout` decides on `event.tasks > 0` alone and names no Ticket (`src/shared/autopilot/cycle.ts:322–324`), yet tickets 01 (`issues/01-…md:34`) and 08 count its continuations per Ticket.

Judgement: The `wave-unfinished` ladder answers 9 real stops, but ticket 08 costs a review at `high` depth, a Codex fault scenario and an Amendment to ADR-0029, all for a stop that has not happened for real. It also needs a per-Ticket cap for an event that has no Ticket: a stalled gate task after every Ticket of the Wave is done has no counter to spend. As written, ticket 09 waits behind 08 (`issues/09-…md:5`) only because both edit `run.ts`, so the quiet-turn stop comes a Wave later than it has to. Cut 08 and the `tasks-timeout` branch of ticket 01; `background-stalled` stays a stop as today. Bring the ladder back for it if the journals show a real one, the same revisit rule the spec already applies to the loop detector.

Owner decision:

### 2. Ticket 02 deletes the `main-red` marker while `land` waits on a rerun of a red push run, which is a step every red `main` goes through

Fact: In `harness/bin/land:485–487` a push run on `main` that is not completed and has `attempt > 1` sets `mainRed = null` and throws the wait "is being rerun (attempt N): code PRs wait for its verdict". `harness/skills/epic-wave/SKILL.md:1554` says "A red run is first repeated once: `gh run rerun <run> --failed` … by the orchestrator". Ticket 02 knows three states only: red → write, "main не красный → удаляет файл", gh failed → keep (`issues/02-маркер-красного-main.md:28–31`).

Judgement: An implementer who maps the in-memory `mainRed` to the file removes the marker during the rerun. `main` is still red then and code PRs still wait. A Run whose settle time or task timeout runs out in that window does not see `main-red`. It continues the held Tickets and then sets them aside with `Waits: owner`, which is the case user story 4 and the `main-red` rule promise to prevent. The fix is cheap and belongs to ticket 02: while a rerun of a red run is in progress, keep the marker, and add one more shell test to `land.test.sh`.

Owner decision:

### 3. Ticket 11 holds the owner's acceptance open for two weeks with a measurement that has nothing to do with it

Fact: `issues/11-приёмка-владельцем.md:32` says "Через две недели после merge Ticket-а 07 Orchestrator запускает `loop-log` …", and its "Готово, когда" (`:42`) lists "`loop-log` через две недели — число случаев записано", beside the owner's manual checks and "Epic закрыт" (`:45`).

Judgement: The owner can accept the ladder, the quiet marks and the Code story as soon as Wave 5 lands, but ticket 11 cannot close for 14 days after Wave 1, so the Epic stays open in `epic-status` for no reason in the work itself. The count is a separate decision input: it starts the second Epic or not. A dated ticket 12, `Blocked by: 07`, that runs `loop-log` on both machines would let ticket 11 close on the acceptance and keep the count from being lost.

Owner decision:

## Alternative

Ten tickets instead of eleven. Ticket 08 leaves the Epic, and ticket 01 loses its `background-stalled` branch. Ticket 09 becomes `Blocked by: 03, 05` and joins ticket 06 in Wave 3, so `turn-hung` reaches the owner one Wave sooner. Ticket 02 keeps the marker during a rerun. Ticket 11 closes on the owner's checks, and a dated ticket 12 (`Blocked by: 07`) records the `loop-log` count two weeks after 07. The spec as written is still the better plan if the owner expects long background tasks on the PC to stall for real now that polish 61 no longer stops on live ones: then a stalled implementer would end a queue night, and ticket 08 would turn that stop into two messages to the Orchestrator and a set-aside.

## What the critic cannot know

There is no product analytics. The run journals read are only those on the Mac, and the newest is from 2026-11-05, so no Autopilot run has been recorded on this Mac in the 12 days since. The PC's journals were not read: the 2026-11-06 `background-stalled` stop is known only from polish 61. The critic cannot tell whether an Orchestrator ends its turn while a rerun of a red `main` is in flight, which decides how often the window in objection 2 opens. The causes behind the 9 `wave-unfinished` stops (an implementer that died, red `main`, an Orchestrator waiting for the owner) were not traced, so how many of them the ladder would have saved is not known. Premises checked at 6cdbc2a42: `cycle.ts`, `epic-queue.ts`, `waves.ts`, `render-template.ts`, `run.ts:14–22`, `land:450–560`, `session.ts:805–845`, `claude/events.ts:162` and the checkout-over-branch rule for `blocked` (`src/main/workflow/reader.ts:771–797`) say what the spec says they do.
