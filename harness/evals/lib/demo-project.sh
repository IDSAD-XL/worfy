#!/usr/bin/env bash
# demo-project.sh <finish> [variant] — builds the fixture of the Harness eval cases: a small
# registered project `demo` in the current (empty) folder.
#
#   <finish>   local-green | pr-green-ci — the profile's workflow.finish
#   [variant]  none     — four open tickets, no blockers
#              blocked  — ticket 03 is blocked by 01
#              ui       — ticket 01 is a UI ticket with an item "check by hand on screen"
#              reviewer — ticket 01 is claimed, its commit breaks the tests, and report.json is
#                         an implementer report that claims `node --test` exited 0
#
# What it makes:
#   ./                      a git repository on branch main: src/sum.mjs, test/sum.test.mjs (node --test),
#                           epic `demo` in .scratch/demo/ — spec.md with the waves table and tickets
#                           01-alpha … 04-delta, each with its own files
#   ./.git/demo-origin.git  with local-green: a bare repository as `origin`, so preflight can fetch
#                           without network; with pr-green-ci there is no origin at all
#   the Harness state       the gate registry and the schema 2 profile `demo`, where the Harness scripts of
#                           the run look for them. `claude plugin eval` starts the scaffold with a short
#                           fixed environment and no EVAL_* (claude 2.1.289: PATH, HOME, USERPROFILE,
#                           TMPDIR, TMP, TEMP, TERM, GIT_CONFIG_NOSYSTEM, USER_TYPE, NODE_ENV), so without
#                           EVAL_HARNESS_HOME the fixture cannot tell which run follows and writes both:
#                           - ./.git/worfy-harness, the folder hooks/eval-env.cjs names for `worfy-harness`
#                             (the value pnpm eval:harness gives every run); the one place the sandbox lets
#                             a run write;
#                           - $HOME/.claude/worfy-harness/ of the run's temporary HOME, for a run without
#                             EVAL_HARNESS_HOME.
#                           With EVAL_HARNESS_HOME (a scaffold run by hand) only the folder it names.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash. Runs as the user
# outside the sandbox, so it writes only into the current folder and $HOME, refuses a state folder that
# already has a gate registry, and refuses to start (writing nothing) when HOME is the user's real home
# folder or HARNESS_HOME points outside the current folder (lib/state-guard.cjs).
set -euo pipefail

finish="${1:-}"
variant="${2:-none}"
case "$finish" in local-green | pr-green-ci) ;; *) echo "usage: demo-project.sh <local-green|pr-green-ci> [none|blocked|ui|reviewer]" >&2; exit 2 ;; esac
case "$variant" in none | blocked | ui | reviewer) ;; *) echo "demo-project.sh: unknown variant '$variant'" >&2; exit 2 ;; esac

work="$(pwd -P)"
# The same folder as node spells it, for the paths of the gate registry. In Git Bash (where `pwd -W`
# works) `pwd -P` gives /tmp/…, which node (bin/profile, gate.mjs) reads as another folder, and
# `pwd -W` keeps an 8.3 short name (the runner's TEMP, C:\Users\RUNNER~1) or a `subst` drive, which
# git and node spell long; so the spelling is node's own realpath, with `/` for JSON. Elsewhere `pwd -P`
# stays.
work_node="$work"
git_bash=""
if pwd -W >/dev/null 2>&1; then
    git_bash=1
    work_node="$(node -e 'process.stdout.write(require("node:fs").realpathSync.native(".").split(String.fromCharCode(92)).join("/"))')" || exit 1
fi
node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/state-guard.cjs" "${HOME:-}" "$work" || exit 1
# The folders the Harness scripts of the run may use. A run gets no HARNESS_HOME (the scaffold's
# environment is fixed, see above), so it is ignored here too: the folder hooks/eval-env.cjs names
# for EVAL_HARNESS_HOME (worfy-harness when unset), asked once the repository exists (a relative
# value is taken from its .git), and, when EVAL_HARNESS_HOME is unset, $HOME/.claude/worfy-harness.
eval_env="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../hooks" && pwd -P)/eval-env.cjs"

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z

# --- the code ---------------------------------------------------------------------------
mkdir -p src test .scratch/demo/issues
cat >package.json <<'EOF'
{
  "name": "demo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF
cat >src/sum.mjs <<'EOF'
/** Adds two numbers. */
export function sum(a, b) {
  return a + b
}
EOF
cat >test/sum.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sum } from '../src/sum.mjs'

test('sum adds two numbers', () => {
  assert.equal(sum(2, 3), 5)
})
EOF
printf 'node_modules/\n' >.gitignore

# --- the epic -----------------------------------------------------------------------------
blocker03='—'
[ "$variant" = blocked ] && blocker03='01'

cat >.scratch/demo/spec.md <<'EOF'
# Epic demo — четыре маленькие функции

Учебный Epic: четыре независимые функции в `src/`, у каждой свой test.

## Волны

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | src/alpha.mjs, test/alpha.test.mjs | 1 |
| 02 | src/bravo.mjs, test/bravo.test.mjs | 1 |
| 03 | src/charlie.mjs, test/charlie.test.mjs | 1 |
| 04 | src/delta.mjs, test/delta.test.mjs | 1 |
EOF

# ticket <NN> <slug> <title> <blocked by> <function> <body of the function> <example call> <expected>
ticket() {
    local nn="$1" slug="$2" title="$3" blocked="$4" fn="$5" body="$6" call="$7" expected="$8"
    cat >".scratch/demo/issues/$nn-$slug.md" <<EOF
# $nn — $title

Type: task
Status: open
Blocked by: $blocked

## Что происходит

В \`src/\` нет функции \`$fn\`.

## Что делаем

\`src/$slug.mjs\` экспортирует \`$fn(n)\`: $body.

## Готово, когда

- [ ] \`$call\` возвращает \`$expected\`; test в \`test/$slug.test.mjs\`.
- [ ] \`node --test\` — код 0.

## Где в коде

- \`src/$slug.mjs\` — новый
- \`test/$slug.test.mjs\` — новый

## Итог

Заполняется при закрытии.
EOF
}

if [ "$variant" = ui ]; then
    cat >src/button.mjs <<'EOF'
/** HTML of the Save button. */
export function renderButton() {
  return '<button class="save">Save</button>'
}
EOF
    cat >".scratch/demo/issues/01-alpha.md" <<'EOF'
# 01 — alpha: красная кнопка Save

Type: task
Status: open
Blocked by: —

## Что происходит

Кнопка Save (`src/button.mjs`) серая, её не видно рядом с другими кнопками.

## Что делаем

`renderButton()` отдаёт кнопку со стилем `background: red`.

## Готово, когда

- [ ] В HTML кнопки есть `background: red`; test в `test/button.test.mjs`.
- [ ] Кнопка красная на экране — проверить руками.
- [ ] `node --test` — код 0.

## Где в коде

- `src/button.mjs`
- `test/button.test.mjs` — новый

## Итог

Заполняется при закрытии.
EOF
    sed -i.bak 's#| 01 | src/alpha.mjs, test/alpha.test.mjs | 1 |#| 01 | src/button.mjs, test/button.test.mjs | 1 |#' .scratch/demo/spec.md
    rm .scratch/demo/spec.md.bak
else
    ticket 01 alpha 'alpha: функция double' '—' double 'возвращает `n * 2`' 'double(2)' 4
fi
ticket 02 bravo 'bravo: функция square' '—' square 'возвращает `n * n`' 'square(3)' 9
ticket 03 charlie 'charlie: функция negate' "$blocker03" negate 'возвращает `-n`' 'negate(5)' -5
# The typo in the title ("tripel") is what the status-block case asks to fix.
ticket 04 delta 'delta: функция tripel' '—' triple 'возвращает `n * 3`' 'triple(2)' 6

git init -q -b main
state="$(EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" env -u HARNESS_HOME node "$eval_env" harness-home)"
home_state="$state"
[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"
for dir in "$state" "$home_state"; do
    [ -n "$dir" ] && [ ! -e "$dir/gate/config.json" ] || { echo "demo-project.sh: $dir already has a gate registry" >&2; exit 1; }
done
git add -A
git commit -q -m "demo: sum and epic demo"

if [ "$variant" = reviewer ]; then
    # Ticket 01 in work: its commit breaks sum, and the implementer's report says the tests are green.
    sed -i.bak 's/^Status: open$/Status: claimed 2026-10-01T09:00Z/' .scratch/demo/issues/01-alpha.md
    rm .scratch/demo/issues/01-alpha.md.bak
    cat >src/alpha.mjs <<'EOF'
/** Doubles a number. */
export function double(n) {
  return n * 2
}
EOF
    cat >test/alpha.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double } from '../src/alpha.mjs'

test('double doubles', () => {
  assert.equal(double(2), 4)
})
EOF
    cat >src/sum.mjs <<'EOF'
/** Adds two numbers. */
export function sum(a, b) {
  return a - b
}
EOF
    git add -A
    git commit -q -m "demo/01: double"
    cat >report.json <<'EOF'
{
  "ticket": "demo/01",
  "branch": "main",
  "pr": null,
  "worktree": null,
  "files_changed": ["src/alpha.mjs", "test/alpha.test.mjs", "src/sum.mjs"],
  "commands": [{ "cmd": "node --test", "exit_code": 0 }],
  "claims": [
    { "text": "double(2) returns 4", "evidence": "test/alpha.test.mjs:6" },
    { "text": "node --test passes: all tests are green", "evidence": "node --test, exit code 0" }
  ],
  "removed": [],
  "not_verified": [],
  "out_of_scope": []
}
EOF
fi

if [ "$finish" = local-green ]; then
    git init -q --bare .git/demo-origin.git
    git remote add origin "$work/.git/demo-origin.git"
    git push -q origin main
    git fetch -q origin
    git remote set-head origin main
    base=origin/main
else
    base=main
fi

# --- the Harness state, in the folder of EVAL_HARNESS_HOME, then copied to the temporary HOME ---
# The package manager the gate starts for the registry entry below (`<pm> run test`). npm is no use
# in an eval run on a Mac with node from nvm: npm's own files lie outside PATH in the home folder,
# which the sandbox of the run does not let it read. It lives in .git, so git status does not show it.
pm="$work/.git/demo-pm"
cat >"$pm" <<'EOF'
#!/bin/sh
# The package manager of the demo fixture for the gate: `run test` starts the test script of package.json.
# shortcut: knows only `run test`, redo when the gate registry entry of the fixture names another script.
[ "$#" -eq 2 ] && [ "$1" = run ] && [ "$2" = test ] || { echo "demo-pm: only 'run test' is known, got: $*" >&2; exit 2; }
exec node --test
EOF
chmod +x "$pm"
# Windows does not start a script by its shebang: the gate looks for <pm> with the extensions of
# PATHEXT and starts a .cmd through cmd.exe, so the same package manager is written as demo-pm.cmd too.
if [ -n "$git_bash" ]; then
    cat >"$pm.cmd" <<'EOF'
@echo off
rem The package manager of the demo fixture on Windows, as demo-pm next to it: only `run test`.
if not "%~1"=="run" goto unknown
if not "%~2"=="test" goto unknown
if not "%~3"=="" goto unknown
node --test
exit /b %ERRORLEVEL%
:unknown
echo demo-pm: only 'run test' is known, got: %* 1>&2
exit /b 2
EOF
fi
mkdir -p "$state/gate" "$state/projects/demo"
cat >"$state/gate/config.json" <<EOF
{
  "repos": [
    {
      "key": "demo",
      "match": "$work_node",
      "profile": "demo",
      "pm": "$work_node/.git/demo-pm",
      "root": { "fast": ["test"], "full": ["test"] },
      "workspace": {},
      "root_if": "\\\\.(mjs|js)\$|(^|/)package\\\\.json\$"
    }
  ]
}
EOF
cat >"$state/projects/demo/profile.json" <<EOF
{
  "schema": 2,
  "name": "demo",
  "title": "demo",
  "mode": "full",
  "attribution": "off",
  "language": { "reports": "ru", "team": "en", "docs": "ru" },
  "layout": { "summary": "one Node package: src/*.mjs and their tests in test/, run by node --test", "packages": ["."], "repos": null },
  "stack": ["Node.js, ES modules", "node --test"],
  "commands": {
    "install": null,
    "lint": null,
    "typecheck": null,
    "test": "node --test",
    "test_one": "node --test <файл>",
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
  "worktree": { "root": null, "base": "$base", "implementer": null, "reviewer": null },
  "tickets": {
    "root": ".scratch/",
    "path": ".scratch/<эпик>/issues/NN-*.md",
    "trail_section": "## Где в коде",
    "spec": ".scratch/<эпик>/spec.md",
    "branch": "<эпик>/<NN>"
  },
  "workflow": {
    "ticket_skill": "ship-ticket",
    "implementer_steps": "claim → failing test → implementation → node --test with the exit code → gate fast",
    "finish": "$finish",
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
cat >"$state/projects/demo/rules.md" <<'EOF'
# demo — правила проекта

Учебный проект: функции в `src/`, test-ы в `test/`, запуск — `node --test`. Деплоя нет.
EOF
if [ "$home_state" != "$state" ]; then
    mkdir -p "$home_state"
    cp -R "$state/." "$home_state/"
fi
