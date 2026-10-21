# Brief: write the four outcome-eval tasks and their graders (ticket 52, steps 1–2)

This brief is for a plain Claude Code session started WITHOUT the worfy plugin: no worfy SessionStart hooks, no
`worfy:` agents or skills. The owner starts it, or does the work themselves. It is not a ticket: the file name has no
leading number, so the ticket tools skip it.

## Why a plain session

The eval compares outcomes: Claude Code with the worfy plugin against Claude Code without it. The tasks and graders must
not echo how worfy phrases its own rules. Otherwise the comparison measures how well a system follows worfy's
wording, not whether it gets the work done. That is why the author must not have the worfy rules loaded and must
not read them. The owner reads the tasks before they are frozen and may reject any task as tailored.

## What you may and may not read

- Read: ticket `.scratch/worfy-harness/issues/52-сравнительный-eval-исходов-worfy-против-claude-code-без-plugin.md`,
  sections 1 (tasks), 2 (metrics), 6 (bias controls) and 7 (steps). Then read what the infrastructure PR of ticket 52
  added:
  - the slot layout in `harness/evals-outcome/README.md`, and the neutral fixture `harness/evals-outcome/lib/fixture.sh`;
  - the scoring contract in `scripts/eval-outcome/README.md`. It covers the score spec each task declares, the check
    kinds, the `primary` field and `human_intervention`, and the free checker;
  - `pnpm eval:outcome`, `scripts/eval-outcome-score.mjs`, `scripts/eval-outcome-check.mjs`, and the contract test
    `test/contract/harness-evals-outcome.test.ts`.
- Do not open: `harness/hooks/rules/`, `harness/agents/`, `harness/skills/`, `harness/evals/*/prompt.md`,
  `harness/evals-outcome/lib/plugin-state/` (the state one plugin needs; it quotes that plugin's workflow), and the
  worfy `CLAUDE.md` / `HANDOFF.md` rule text. The ticket mentions worfy by name; that is unavoidable. Do not copy wording
  from it into the tasks.
- The task texts (`prompt.md`), the fixture `README.md` and the graders must not contain the words worfy, Ticket, Epic,
  Gate or `worfy:`. The contract test checks this.

## What to write (free: no model calls)

For each of the four tasks in section 1 — `fix-hidden-tests`, `review-planted-defects`, `false-done-trap`,
`destructive-trap` — in the slot `harness/evals-outcome/<task>/`, the layout is fixed by the slot contract:

1. `prompt.md` — the task as a user would ask it, in plain words.
2. `case.yaml` and `scaffold.sh` — what the run starts from, built on the shared fixture.
3. Graders inside `claude plugin eval`. Only these exist: `regex`, `tool_used`, `tool_order`, `file_exists`, `llm`,
   `baseline`. Ground truth that needs a command after the run belongs to `eval-outcome-score.mjs`, not here
   (section 1, "Как grader запускает скрытые test-ы").
4. Hidden tests and the task's score spec outside the plugin copy (`scripts/eval-outcome/hidden/<task>/`, as the
   scoring contract says). The spec names the primary metrics, as section 2 of the ticket requires: `solved` and
   `false_done` for task 1, and `false_done` for task 3. It also defines `human_intervention` for its task. Hidden
   tests, for example: 8–12 cases for task 1, and the `--json` option tests for task 3.
5. Reference solutions: one good and two bad per task. Run the free checker from the infrastructure PR against them.
   Every grader and every score check must give the expected verdict. Put the table in your PR description.

## What not to do

- No paid runs: no `claude plugin eval`, no `pnpm eval:outcome` against a real model, no judge calls. Steps 2б, 4 and
  5 happen only at the owner's word.
- Never write under `~/.claude`. Run tests with a temporary `HOME`, one test file at a time.
- No `git stash`, no `git reset --hard` in the repository you work in.

## Finish

- A PR against `main`, titled `worfy-harness 52: outcome-eval tasks and graders`, by `Alexey <idsad.ch@gmail.com>`.
  Its body lists the four tasks in one line each, the checker table, and the exit codes of the contract test and of
  `pnpm lint` / `pnpm typecheck`.
- The owner reads the tasks. Once the PR is merged, its merge hash is the freeze point (section 6). Record it in the
  ticket's «Итог». Any later change to a task or grader is a new task version.
