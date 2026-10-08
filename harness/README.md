# harness/ — the worfy Harness

The Harness is the set of rules, agents, skills, scripts and hooks that runs the owner's Claude Code
workflow: epics, tickets, waves, the quality gate, project profiles. It becomes the Claude Code plugin
`worfy` (ADR-0019, ADR-0040). This folder is its source.

**Not live yet.** Until ticket `worfy-harness/16` (the owner's machine switches to the plugin,
ADR-0047), sessions run the frozen copy in `~/.claude`, not this folder. Changes here do not affect
any session before then; the waves of epic E3 (`worfy-harness`) run on the frozen `~/.claude`.

## What is here

| Path | What it is | Imported from `~/.claude` |
|---|---|---|
| `hooks/rules/orchestrator.md`, `hooks/rules/common.md` | Global rules: the main session gets both parts, a subagent gets `common.md`; `hooks/inject-rules.sh` hands them over, `hooks/hooks.json` wires every hook (ticket 05) | `CLAUDE.md` |
| `agents/` | Generic agents: `implementer`, `reviewer`, `scout` | `agents/` |
| `skills/<name>/SKILL.md` | `epic-wave`, `ship-ticket`, `retro`, `qmd`, `overnight-fix-loop`, `continuous-audit`, `tickets-to-tasks` | `skills/` |
| `bin/` | Scripts: `profile`, `ticket`, `epic-status`, `preflight`, `worktree-lock`, `epic-board`, `qmd-mcp`, `qmd-refresh`, `qmd-sync-main`; notes in `ТИКЕТЫ.md` | `bin/` |
| `hooks/` | `gate.sh`, `gate-resolve.mjs`, `guard.mjs`, `session-start.sh`, `session-end.sh`, `stop.sh` | `hooks/` |
| `bin/tests/`, `hooks/tests/` | Shell tests of the scripts and hooks | `bin/tests/`, `hooks/tests/` |
| `profiles/README.md` | The contract of a project profile | `profiles/README.md` |
| `.claude-plugin/plugin.json` | Plugin manifest: name `worfy`, dependency `mattpocock-skills` | new |
| `package.json` | Package scope without a module type, see below | new |

The global rules are not a `CLAUDE.md`: Claude Code does not load a `CLAUDE.md` from a plugin root,
and a `CLAUDE.md` in a subfolder of the repository would be added to every session that edits this
folder. They reach a session as `additionalContext` of the `SessionStart` and `SubagentStart` hooks,
in parts of at most 10,000 characters each (ADR-0041).

`package.json` has no `"type"` on purpose. The worfy `package.json` says `"type": "module"`, and
Node would then load the extensionless CommonJS scripts in `bin/` (`profile`, `epic-board`) as ES
modules and fail. With no type Node detects each script's module syntax, as it does in `~/.claude`.

The script paths still point at `~/.claude` (`$HOME/.claude/bin/profile` and the like); ticket 08
moves them onto the plugin. The text is still partly in Russian; tickets 05–08 translate it
(ADR-0044).

## Import and history

Ticket `worfy-harness/02` imported these files with their git history from the owner's `~/.claude`
repository at commit `2e3b274cc2eacdc25fd3a5f46f24d4da422fa225` (the import base). Only the files
above were kept, moved under `harness/` from the first commit on
(`git filter-branch --index-filter … --msg-filter … --prune-empty`); commits left with no change
were dropped. `git log --follow harness/<path>` goes back to "Snapshot of Claude Code workflow
before generalization".

Every imported commit ends with a trailer naming its SHA in `~/.claude`:

    Imported-from: ~/.claude <full SHA>

Lessons and ADRs cite the old SHAs. To find the imported commit of one:

    git log --grep='Imported-from: ~/.claude 364070b'

## Tests

`pnpm test` runs every `bin/tests/*.test.sh` and `hooks/tests/*.test.sh` through
`test/contract/harness-scripts.test.ts`: one case per file, `bash <file>` with `HOME` in an empty
temporary folder, exit code 0 expected. So they run in CI on Linux and in the gate. They need
`bash`, `zsh`, `git`, `jq` and `node`.

By hand, from the repository root:

    bash harness/bin/tests/profile.test.sh

Each test checks the scripts next to it (`harness/bin`, `harness/hooks`); `BIN_DIR` and `HOOKS_DIR`
point it at another copy. Registries, gate state and profiles are temporary folders. The checks
against live repositories (Auction, Atakama, worfy) run only with the real `HOME`, when both the
repository and the live gate registry (`~/.claude/gate/config.json`) exist; otherwise the test
prints `skip …`. They only read `~/.claude`.

## Evals

`evals/` holds eight `claude plugin eval` cases. They check by behaviour, not by text, that Claude
follows the Harness rules: `epic-wave` takes exactly the tickets named in the Autopilot command (two
cases: the command and its old Russian form), `ship-ticket` finishes the way `workflow.finish` says
(`local-green` and `pr-green-ci`), the implementer's report is JSON with exit codes, a reviewer with
the lens "implementer's report" answers `VERIFIED` or `REJECTED`, no agent captures the screen
through the OS, and the main session ends a working turn with the four-line status block.

Each case builds its fixture with `evals/lib/demo-project.sh`: a small git repository with epic
`demo` (four tickets) in the run's working folder, and the gate registry and profile `demo` in the
run's temporary `HOME`. Graders are free (`regex`, `tool_used`) wherever they can be; `llm` graders
judge only short answers.

Run, on a Mac, by hand, from the repository root:

    pnpm eval:harness                                       # all eight cases
    pnpm eval:harness -- --case status-block --runs 1       # one case, one run

`scripts/eval-harness.mjs` evaluates a temporary copy of `harness/` without `dependencies` in
`plugin.json` (a run installs nothing besides the plugin under test, and Claude Code does not load a
plugin with a missing dependency). It makes two calls: the cases tagged `main` with `Bash`, `Write`
and `Edit`, and `no-os-screen-capture` (tag `gui`) with `Bash` only for `git`, `node` and the
Harness scripts. Both pass `--scaffold --trust-plugin --ablation none --threshold 0.8
--max-cost-usd 30 --no-publish` and pinned `--model` and `--judge-model`; arguments after `--` go
to both. `HARNESS_DIR=<dir>` evaluates another copy of the Harness. The exit code is the worst of
the two calls: `0` — every case at 0.8 or above, `1` — a case below it or not loaded, `2` — a
partial run (cost ceiling, the account refused), `130`/`143` — interrupted.

Every run and every `llm` grader is a real model call on the owner's account. A full run costs
COST_PLACEHOLDER. The report is `evals/results/<time>-main/report.html` (and `-gui`), next to
`aggregate-result.json`; `evals/results/` holds run transcripts and stays out of git and out of
the app (`electron.vite.config.ts`, `HARNESS_NOT_BUNDLED`). CI and the gate do not run the evals:
`test/contract/harness-evals.test.ts` checks for free only that every case is complete, every
fixture builds, and the Harness scripts recognise it.
