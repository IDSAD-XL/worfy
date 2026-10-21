#!/usr/bin/env bash
# plugin-state/worfy.sh — the state the worfy plugin reads to recognise the fixture as a project of
# its own: a gate registry entry and the profile `fixture`. A task's scaffold.sh runs every script of
# plugin-state/ after lib/fixture.sh, in the working folder. The scaffold cannot know the arm, so
# the arm without the plugin gets the same files, and nothing there reads them. Another plugin under
# test brings its own script here, or none.
#
# Where: `claude plugin eval` starts a scaffold with a short fixed environment and no EVAL_*, so the
# state goes to both places the plugin's scripts look, as harness/evals/lib/demo-project.sh does:
#   - ./.git/worfy-harness, the folder hooks/eval-env.cjs names for EVAL_HARNESS_HOME=worfy-harness
#     (what pnpm eval:outcome gives the runs);
#   - $HOME/.claude/worfy-harness of the run's temporary HOME.
# With EVAL_HARNESS_HOME set (a scaffold run by hand) only the folder it names. Nothing of it is in
# the working tree.
#
# It runs as the user outside the sandbox, so it writes only into the current folder and $HOME,
# refuses a state folder that already has a registry, and refuses to start (writing nothing) when
# HOME is the user's real home folder or HARNESS_HOME points outside the current folder
# (harness/evals/lib/state-guard.cjs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
plugin="$here/../../.."
work="$(pwd -P)"
node "$plugin/evals/lib/state-guard.cjs" "${HOME:-}" "$work" || exit 1
[ -d "$work/.git" ] || { echo "plugin-state/worfy.sh: $work is not the fixture's repository (run lib/fixture.sh first)" >&2; exit 1; }

# The folder as node spells it, for the paths of the registry (Git Bash: see demo-project.sh).
work_node="$work"
git_bash=""
if pwd -W >/dev/null 2>&1; then
    git_bash=1
    work_node="$(node -e 'process.stdout.write(require("node:fs").realpathSync.native(".").split(String.fromCharCode(92)).join("/"))')" || exit 1
fi

state="$(EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" env -u HARNESS_HOME node "$plugin/hooks/eval-env.cjs" harness-home)"
home_state="$state"
[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"
for dir in "$state" "$home_state"; do
    [ -n "$dir" ] && [ ! -e "$dir/gate/config.json" ] || { echo "plugin-state/worfy.sh: $dir already has a gate registry" >&2; exit 1; }
done

# The package manager the gate starts (`<pm> run test`): npm may not be readable in a run's sandbox.
pm="$work/.git/fixture-pm"
cat >"$pm" <<'EOF'
#!/bin/sh
# The package manager of the outcome fixture for the gate: `run test` starts the test script of package.json.
# shortcut: knows only `run test`, redo when the registry entry of the fixture names another script.
[ "$#" -eq 2 ] && [ "$1" = run ] && [ "$2" = test ] || { echo "fixture-pm: only 'run test' is known, got: $*" >&2; exit 2; }
exec node --test
EOF
chmod +x "$pm"
if [ -n "$git_bash" ]; then
    cat >"$pm.cmd" <<'EOF'
@echo off
rem The package manager of the outcome fixture on Windows, as fixture-pm next to it: only `run test`.
if not "%~1"=="run" goto unknown
if not "%~2"=="test" goto unknown
if not "%~3"=="" goto unknown
node --test
exit /b %ERRORLEVEL%
:unknown
echo fixture-pm: only 'run test' is known, got: %* 1>&2
exit /b 2
EOF
fi
mkdir -p "$state/gate" "$state/projects/fixture"
cat >"$state/gate/config.json" <<EOF
{
  "repos": [
    {
      "key": "fixture",
      "match": "$work_node",
      "profile": "fixture",
      "pm": "$work_node/.git/fixture-pm",
      "root": { "fast": ["test"], "full": ["test"] },
      "workspace": {},
      "root_if": "\\\\.(mjs|js)\$|(^|/)package\\\\.json\$"
    }
  ]
}
EOF
cat >"$state/projects/fixture/profile.json" <<'EOF'
{
  "schema": 2,
  "name": "fixture",
  "title": "textkit",
  "mode": "full",
  "attribution": "off",
  "language": { "reports": "en", "team": "en", "docs": "en" },
  "layout": { "summary": "one Node package: src/*.mjs and their tests in test/, run by node --test", "packages": ["."], "repos": null },
  "stack": ["Node.js, ES modules", "node --test"],
  "commands": {
    "install": null,
    "lint": null,
    "typecheck": null,
    "test": "node --test",
    "test_one": "node --test <file>",
    "contract": null,
    "e2e": null,
    "build": null,
    "verify": "node --test",
    "prepare_tree": null,
    "requires": [],
    "package": null
  },
  "modules": null,
  "tests": null,
  "parallel": "single",
  "worktree": { "root": null, "base": "origin/main", "implementer": null, "reviewer": null },
  "tickets": {
    "root": ".scratch/",
    "path": ".scratch/<epic>/issues/NN-*.md",
    "trail_section": "## Where in the code",
    "spec": ".scratch/<epic>/spec.md",
    "branch": "<epic>/<NN>"
  },
  "workflow": {
    "ticket_skill": "ship-ticket",
    "implementer_steps": "failing test → implementation → node --test with the exit code → gate fast",
    "finish": "local-green",
    "merge": "orchestrator"
  },
  "numbering": { "adr": null, "migrations": null },
  "deploy": null,
  "github": null,
  "serial_merge": null,
  "docs": { "context": null, "handoff": null, "adr_dir": null },
  "lessons": null,
  "session": { "inject_rules": false },
  "qmd": { "collections": [], "covers": "no qmd index: search the repository with grep" },
  "review": { "lenses": ["correctness"], "ticket_lenses": ["correctness"] },
  "dev_stack": null,
  "audit_lenses": null
}
EOF
cat >"$state/projects/fixture/rules.md" <<'EOF'
# fixture — project rules

A small Node package: code in `src/`, tests in `test/`, run with `node --test`. No deploy, no network.
EOF
if [ "$home_state" != "$state" ]; then
    mkdir -p "$home_state"
    cp -R "$state/." "$home_state/"
fi
