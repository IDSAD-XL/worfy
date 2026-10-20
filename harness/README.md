# harness/ — the worfy Harness

The Harness is the set of rules, agents, skills, scripts and hooks that runs a Claude Code
workflow: epics, tickets, waves, the quality gate, project profiles. worfy ships it as the Claude Code
plugin `worfy` and installs it into `~/.claude/worfy-harness/plugin/`. This folder is its source.

A change here reaches sessions only once the plugin is installed again from this folder; until then
sessions run the installed copy.

## What is here

| Path | What it is | Imported from `~/.claude` |
|---|---|---|
| `hooks/rules/orchestrator.md`, `hooks/rules/common.md` | Global rules: the main session gets both parts, a subagent gets `common.md`; `hooks/inject-rules.mjs` hands them over, `hooks/hooks.json` wires every hook | `CLAUDE.md` |
| `agents/` | Generic agents: `implementer`, `reviewer`, `scout` | `agents/` |
| `skills/<name>/SKILL.md` | `epic-wave`, `ship-ticket`, `retro`, `qmd`, `overnight-fix-loop`, `continuous-audit`, `tickets-to-tasks`; new in the plugin: `max-review` (a review of a whole branch before a risky merge), `gate-queue` (the cross-machine gate queue on the machine with `cross_machine_gate.role` `serve`: each waiting labelled PR rebased, checked, reported and merged) | `skills/` (`max-review` and `gate-queue` are new) |
| `bin/` | Scripts: `profile`, `ticket`, `epic-status`, `preflight`, `worktree-lock`, `epic-board`, `qmd-mcp`, `qmd-refresh`, `qmd-sync-main`, `wave-gate` (one gate full for the set of a wave's ready PRs, then their merge; with `workflow.ci: "batch"` also the one CI run of the wave on the main branch, `wave-gate ci`); notes in `ТИКЕТЫ.md` | `bin/` |
| `hooks/` | `gate.mjs`, `gate-paths.mjs`, `gate-resolve.mjs`, `guard.mjs`, `inject-rules.mjs`, `session-start.mjs`, `session-end.mjs`, `stop.mjs`, `gh-token-env.mjs` (every Node script runs as `node <file>`), `eval-env.cjs` (the git every script starts and the Harness state folder, with the variables of an eval run — see "Evals"); `gate-log.mjs` (the gate's output logs under `<state>/logs/<worktree tag>/<run>/`, their pruning, the Playwright failure blocks of a failed script's report, and the timings of a run: the line `[gate] time (…)` above the verdict line and `timings.json` in the run's log folder); `gate.sh` is the launcher of the gate under its old name: it finds a node that can run `gate.mjs` and starts it, and without one it answers "could not verify" itself — `hooks.json` calls it, and so do profiles that name it, as profiles moved from the old Harness do (a working spelling: without node it answers with code 3, where `node …/gate.mjs` fails with 127) | `hooks/` |
| `bin/tests/`, `hooks/tests/` | Shell tests of the scripts and hooks | `bin/tests/`, `hooks/tests/` |
| `profiles/README.md` | The contract of a project profile | `profiles/README.md` |
| `.claude-plugin/plugin.json` | Plugin manifest: name `worfy`, dependency `mattpocock-skills` | new |
| `package.json` | Package scope without a module type, see below | new |

The global rules are not a `CLAUDE.md`: Claude Code does not load a `CLAUDE.md` from a plugin root,
and a `CLAUDE.md` in a subfolder of the repository would be added to every session that edits this
folder. They reach a session as `additionalContext` of the `SessionStart` and `SubagentStart` hooks,
in parts of at most 10,000 characters each.

`package.json` has no `"type"` on purpose. The worfy `package.json` says `"type": "module"`, and
Node would then load the extensionless CommonJS scripts in `bin/` (`profile`, `epic-board`) as ES
modules and fail. With no type Node detects each script's module syntax, as it does in `~/.claude`.

Scripts are named through `${CLAUDE_PLUGIN_ROOT}`; a profile value of schema 1 that names
`~/.claude/bin/<script>` is read as the same script of the plugin. Some text is still in Russian and is
being translated.

## Import and history

These files were imported with their git history from the author's `~/.claude`
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
against the live gate registry (`~/.claude/worfy-harness/gate/config.json`, or the older
`~/.claude/gate/config.json`) run only with the real `HOME`: they take every project registered there
whose directory exists; without a registry the test prints `skip …`. They only read `~/.claude`.
`bin/tests/plugin-neutral.test.sh` keeps every file here free of one person's names, accounts, home
paths and work projects, of the numbers of worfy's own decision records, tickets and waves, and of
paths into the worfy app sources; the eval fixtures keep the ticket numbers of their own epic `demo`.

## Evals

`evals/` holds eight `claude plugin eval` cases. They check by behaviour, not by text, that Claude
follows the Harness rules: `epic-wave` takes exactly the tickets named in the Autopilot command (two
cases: the command and its old Russian form), `ship-ticket` finishes the way `workflow.finish` says
(`local-green` and `pr-green-ci`), the implementer's report is JSON with exit codes, a reviewer with
the lens "implementer's report" answers `VERIFIED` or `REJECTED`, no agent captures the screen
through the OS, and the main session ends a working turn with the four-line status block.

Each case builds its fixture with `evals/lib/demo-project.sh`: a small git repository with epic
`demo` (four tickets) in the run's working folder, and the gate registry and profile `demo` where
the Harness scripts of the run look for them (`.git/worfy-harness` of that folder under
`pnpm eval:harness`, see below; `.claude/worfy-harness` of the run's temporary `HOME` without
`EVAL_HARNESS_HOME`; `HARNESS_HOME` is ignored, since a run does not get it). Graders are free (`regex`, `tool_used`) wherever they can be; `llm` graders
judge only short answers.

Run, on a Mac, by hand, from the repository root:

    pnpm eval:harness                                       # all ten cases
    pnpm eval:harness -- --case status-block --runs 1       # one case, one run

`scripts/eval-harness.mjs` evaluates a temporary copy of `harness/` without `dependencies` in
`plugin.json` (a run installs nothing besides the plugin under test, and Claude Code does not load a
plugin with a missing dependency). It makes two calls: the cases tagged `main` with `Bash`, `Write`
and `Edit`, and `no-os-screen-capture` (tag `gui`) with `Bash` only for `git`, `node`, the
Harness scripts, `echo` and `set -o pipefail`. Both pass `--scaffold --trust-plugin --ablation none --threshold 0.8
--max-cost-usd 30 --no-publish` and pinned `--model` and `--judge-model`; arguments after `--` go
to both. `HARNESS_DIR=<dir>` evaluates another copy of the Harness. The exit code is the worst of
the two calls: `0` — every case at 0.8 or above, `1` — a case below it or not loaded, `2` — a
partial run (cost ceiling, the account refused), 128 + the signal number — stopped by a signal
(`130` SIGINT, `129` SIGHUP, `143` SIGTERM); after a signal the remaining call is not started.

Every run and every `llm` grader is a real model call on your account. The full set (ten
cases, 25 runs, `claude-sonnet-5`) cost 15 USD and took an hour on 2026-10-18: an `epic-wave` or `ship-ticket` run costs 0.4–1.9 USD, a
`reviewer` run about 0.25 USD, a `status-block` run about 0.12 USD.
The report is `evals/results/<time>-main/report.html` (and `-gui`), next to
`aggregate-result.json`; `evals/results/` holds run transcripts and stays out of git and out of
the app (`electron.vite.config.ts`, `HARNESS_NOT_BUNDLED`). CI and the gate do not run the evals:
`test/contract/harness-evals.test.ts` checks for free only that every case is complete, every
fixture builds, and the Harness scripts recognise it.

git and the Harness state in a run. The sandbox settings `claude plugin
eval` writes for a run list the Command Line Tools `git` binary among denied credential files, next
to the `git-credential-*` helpers, and let a run write only into its working folder. So
`scripts/eval-harness.mjs` copies the folder `git --exec-path` names, without `git-credential-*`,
into `evals/results/<time>-git/` (removed at the end, also after Ctrl-C, SIGTERM or SIGHUP), puts that folder first on the runs' `PATH`
and sets two variables, which every Harness script reads through `hooks/eval-env.cjs`:

- `EVAL_GIT` — the git the scripts start instead of `git` from `PATH`;
- `EVAL_HARNESS_HOME` — the Harness state folder when `HARNESS_HOME` is not set; a relative value
  (`worfy-harness`) is taken from the git common directory of the current folder, so the state of a
  run goes to `.git/worfy-harness` of its working folder.

Without both variables the scripts start `git` from `PATH` and keep the state in `HARNESS_HOME` or
`~/.claude/worfy-harness`, as before. Whether the copy of git runs inside a real sandbox is checked
by the first paid run of the eval set.
