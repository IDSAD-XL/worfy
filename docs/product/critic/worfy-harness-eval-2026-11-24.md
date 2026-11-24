# Critic: worfy-harness-eval — 2026-11-24

Plan: `docs/product/harness-eval/drafts/worfy-harness-eval.md`
Verdict: Reorder — the tickets are the right ones, but the pilot runner (08) is not blocked by the tickets that set its billing and its models (01, 02), and three tickets plan as new the scoring and statistics the repository already has.

## Objections

### 1. Tickets 03, 08 and 10 rebuild the scoring, the free reference check and the Wilson interval that `scripts/eval-outcome*.mjs` already provide

Fact: `scripts/eval-outcome-stats.mjs:13` is `export function wilson(k, n, z = Z95)`, used per metric at `scripts/eval-outcome-lib.mjs:958`; `scripts/eval-outcome/README.md:5` says "Everything about scoring lives here, outside the plugin copy a run loads", and lines 52–68 define custom-code checks (`command` with hidden tests copied in after the run, `tests-intact`, `origin-has`, `files-kept`, `judge`) and the metrics `false_done` and `test_tampered`; `scripts/eval-outcome-check.mjs:4-8` is "The free check of an outcome task against its reference solutions". The draft never names any of these scripts: ticket 03 (line 314) lists "«k из n» с интервалом Wilson", the test decisions (line 281) plan "Интервал Wilson — чистая функция", line 128 plans the free reference check as new, and line 205 justifies a new runner with "В `claude plugin eval` нет custom-code grader-ов".

Judgement: `claude plugin eval` indeed has no permission-mode option (`claude plugin eval --help`, 2.1.323), so a new launcher on `claude -p` is justified for auto mode and the Autopilot branch, but the scoring after a run is already custom code outside the plugin and covers two of the four headline metrics. Without a line in tickets 03, 08 and 10 that says "score with `eval-outcome-score.mjs`, check with `eval-outcome-check.mjs`, take `wilson` from `eval-outcome-stats.mjs`", an implementer of the already largest ticket (08: container, three branches, two kinds of login, limits, secret scan) is likely to write a second scorer and a second statistics module next to the first.

Owner decision: accepted — «все да»

### 2. Ticket 08 needs the billing switch of 01 and the model split of 02, yet neither blocks it and wave 1 runs them side by side

Fact: the ticket table (draft lines 312–313) gives 01 "Блокирует 05, 07, 14–17" and 02 "Блокирует 05, 14", while 08 (line 319) is "подписка или API key" and the pilot model is set by 02 ("пилот и judge `claude-opus-5-5`"); wave 1 (line 333–334) puts 08 beside 01 and 02. Today one pair of constants serves every eval script: `scripts/eval-run-env.mjs:32-33` `MODEL = 'claude-sonnet-5'`, `JUDGE_MODEL = 'claude-haiku-4-5'`, imported by `scripts/eval-harness.mjs:81`, `scripts/eval-outcome.mjs:58` and the judge of `scripts/eval-outcome-lib.mjs:33`.

Judgement: 02 has to split that single constant into a regular model and a pilot model, and 01 decides where the key lives and how it reaches the child `claude`; 08 written in parallel either picks its own answers to both (two key paths, two model settings to keep in step) or collides with them in `eval-run-env.mjs`. Adding 01 and 02 to the `Blocked by:` line of 08 costs nothing in calendar time, since wave 2 waits for 08 anyway.

Owner decision: accepted — «все да»

### 3. The draft rejects SWE-bench Verified as contaminated but takes 8 tasks from the ImpossibleBench SWE part, which is built from SWE-bench Verified

Fact: the topic's own note `docs/product/harness-eval/research-примеры-задач-для-пилота.md:27` says ImpossibleBench is "349 task из SWE-bench Verified и 103 из LiveCodeBench" (arXiv 2510.20270); the draft at line 249 says "SWE-bench Verified не берётся: OpenAI перестал по нему отчитываться, потому что набор «increasingly contaminated»", and at line 236 takes "8 задач SWE-части ImpossibleBench".

Judgement: for the test-editing metric contamination matters less (the mutated test fails even a memorised fix), but the report is meant for an outside reader, who will spot the same source rejected in one paragraph and used in the next. The spec should either say why contamination does not bias that family or record the source of each family next to its rule, before the freeze commit makes it final.

Owner decision: accepted — «все да»

## Alternative

Keep the four families and the branches, but cut ticket 08 to a launcher: it starts a container per run with the right flags and login, and hands each kept working folder to `scripts/eval-outcome-score.mjs`, whose check kinds gain the Python and git checks the new families need (in ticket 10). Ticket 03 takes `wilson` from `eval-outcome-stats.mjs` instead of writing it. 08 is blocked by 01 and 02. The plan as drafted is still better than reusing `claude plugin eval` as the runner, because that command cannot run auto mode or the Autopilot branch.

## What the critic cannot know

- Whether `claude -p` inside a container emits `rate_limit_event` with the weekly utilisation often enough for the 80 % stop: the app reads it from the SDK (`src/main/agent/limits.ts:5-6`) and also polls usage every 30 minutes because the events do not always come (`src/main/agent/limits-usage.ts`); the critic ran no model.
- How much of a weekly limit one Opus run of these tasks costs, and whether the x86_64 images of the SWE families build under emulation on the owner's Mac.
- Whether the owner's Console organisation bills `claude plugin eval` with an API key to credits or to the subscription; the draft names this as the first check of ticket 01.
