#!/usr/bin/env bash
# fixture.sh — builds the shared base repository of the outcome eval tasks in the current (empty)
# folder (harness/evals-outcome/README.md, "The fixture"). A task's scaffold.sh runs it first, then
# adds the task's own files.
#
# What it makes:
#   ./                          a git repository on branch main with one commit: a small Node package
#                               (src/text.mjs, test/text.test.mjs, package.json with `node --test`), a
#                               .gitignore and an ordinary README.md that names the test command; a
#                               repository-local git identity, so commits work in the run's empty HOME
#   ./.git/fixture-origin.git   a local bare repository as `origin`, main pushed: push and fetch need
#                               no network
#   the plugin's state          the gate registry and the profile `fixture` of the plugin under test,
#                               where its scripts look for them. `claude plugin eval` starts a scaffold
#                               with a short fixed environment and no EVAL_*, so the fixture writes both
#                               places, as harness/evals/lib/demo-project.sh does:
#                               - ./.git/worfy-harness, the folder hooks/eval-env.cjs names for
#                                 EVAL_HARNESS_HOME=worfy-harness (what pnpm eval:outcome gives the runs);
#                               - $HOME/.claude/worfy-harness of the run's temporary HOME.
#                               With EVAL_HARNESS_HOME set (a scaffold run by hand) only the folder it names.
#                               None of it is in the working tree; the arm without the plugin gets the
#                               same files and nothing reads them.
#
# Generic on purpose: no task's bug or trap lives here. Runs as the user outside the sandbox, so it
# writes only into the current folder and $HOME, refuses a state folder that already has a registry,
# and refuses to start (writing nothing) when HOME is the user's real home folder or HARNESS_HOME
# points outside the current folder (harness/evals/lib/state-guard.cjs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
work="$(pwd -P)"
node "$here/../../evals/lib/state-guard.cjs" "${HOME:-}" "$work" || exit 1
[ -z "$(ls -A "$work")" ] || { echo "fixture.sh: $work is not empty" >&2; exit 1; }

# The folder as node spells it, for the paths of the registry (Git Bash: see demo-project.sh).
work_node="$work"
git_bash=""
if pwd -W >/dev/null 2>&1; then
    git_bash=1
    work_node="$(node -e 'process.stdout.write(require("node:fs").realpathSync.native(".").split(String.fromCharCode(92)).join("/"))')" || exit 1
fi
eval_env="$here/../../hooks/eval-env.cjs"

export GIT_AUTHOR_NAME="Fixture Author" GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME="Fixture Author" GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z

# --- the package ------------------------------------------------------------------------------------
mkdir -p src test
cat >package.json <<'EOF'
{
  "name": "textkit",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF
cat >README.md <<'EOF'
# textkit

Small text helpers for Node.js scripts.

## Usage

```js
import { capitalize, words } from './src/text.mjs'

capitalize('hello') // 'Hello'
words(' a  b ') // ['a', 'b']
```

## Tests

Node.js 20 or newer; there is nothing to install.

```sh
node --test
```
EOF
cat >src/text.mjs <<'EOF'
/** The text with its first character in upper case. */
export function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

/** The words of the text, split on whitespace, without empty ones. */
export function words(text) {
  return text.split(/\s+/).filter(Boolean)
}
EOF
cat >test/text.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capitalize, words } from '../src/text.mjs'

test('capitalize upper-cases the first character', () => {
  assert.equal(capitalize('hello'), 'Hello')
  assert.equal(capitalize(''), '')
})

test('words splits on any whitespace', () => {
  assert.deepEqual(words(' a  b\tc\n'), ['a', 'b', 'c'])
})
EOF
printf 'node_modules/\n' >.gitignore

git init -q -b main
git config user.name "Fixture Author"
git config user.email fixture@example.invalid

state="$(EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" env -u HARNESS_HOME node "$eval_env" harness-home)"
home_state="$state"
[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"
for dir in "$state" "$home_state"; do
    [ -n "$dir" ] && [ ! -e "$dir/gate/config.json" ] || { echo "fixture.sh: $dir already has a gate registry" >&2; exit 1; }
done

git add -A
git commit -q -m "Initial commit"
git init -q --bare .git/fixture-origin.git
git remote add origin "$work/.git/fixture-origin.git"
git push -q origin main
git fetch -q origin
git branch -q --set-upstream-to=origin/main main
git remote set-head origin main

# --- the plugin's state, in the folder of EVAL_HARNESS_HOME, then copied to the temporary HOME -------
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
