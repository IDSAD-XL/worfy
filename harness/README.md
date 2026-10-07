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
| `rules/global.md` | Global rules of every session | `CLAUDE.md` |
| `agents/` | Generic agents: `implementer`, `reviewer`, `scout` | `agents/` |
| `skills/<name>/SKILL.md` | `epic-wave`, `ship-ticket`, `retro`, `qmd`, `overnight-fix-loop`, `continuous-audit`, `tickets-to-tasks` | `skills/` |
| `bin/` | Scripts: `profile`, `ticket`, `epic-status`, `preflight`, `worktree-lock`, `epic-board`, `qmd-mcp`, `qmd-refresh`, `qmd-sync-main`; notes in `ТИКЕТЫ.md` | `bin/` |
| `hooks/` | `gate.sh`, `gate-resolve.mjs`, `guard.mjs`, `session-start.sh`, `session-end.sh`, `stop.sh` | `hooks/` |
| `bin/tests/`, `hooks/tests/` | Shell tests of the scripts and hooks | `bin/tests/`, `hooks/tests/` |
| `profiles/README.md` | The contract of a project profile | `profiles/README.md` |
| `.claude-plugin/plugin.json` | Plugin manifest: name `worfy`, dependency `mattpocock-skills` | new |
| `package.json` | Package scope without a module type, see below | new |

The global rules are `rules/global.md`, not `CLAUDE.md`: Claude Code does not load a `CLAUDE.md`
from a plugin root, and a `CLAUDE.md` in a subfolder of the repository would be added to every
session that edits this folder.

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
