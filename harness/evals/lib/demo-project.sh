#!/usr/bin/env bash
# demo-project.sh <finish> [variant] — builds the fixture of the Harness eval cases (ticket
# worfy-harness/27): a small registered project `demo` in the current (empty) folder.
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
#   $HOME/.claude/worfy-harness/
#                           the gate registry and the schema 2 profile `demo` — the Harness state of
#                           the run's temporary HOME (`claude plugin eval` sets HOME for the scaffold)
#
# Bash, not Node: it is test code (ADR-0055). Runs as the owner outside the sandbox, so it writes
# only into the current folder and $HOME, and refuses a HOME that already has a gate registry.
set -euo pipefail

finish="${1:-}"
variant="${2:-none}"
case "$finish" in local-green | pr-green-ci) ;; *) echo "usage: demo-project.sh <local-green|pr-green-ci> [none|blocked|ui|reviewer]" >&2; exit 2 ;; esac
case "$variant" in none | blocked | ui | reviewer) ;; *) echo "demo-project.sh: unknown variant '$variant'" >&2; exit 2 ;; esac

work="$(pwd -P)"
state="$HOME/.claude/worfy-harness"
[ ! -e "$state/gate/config.json" ] || { echo "demo-project.sh: $state already has a gate registry" >&2; exit 1; }

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

# --- the Harness state of the temporary HOME ----------------------------------------------
mkdir -p "$state/gate" "$state/projects/demo"
cat >"$state/gate/config.json" <<EOF
{
  "repos": [
    {
      "key": "demo",
      "match": "$work",
      "profile": "demo",
      "pm": "npm",
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
