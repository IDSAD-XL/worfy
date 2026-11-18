#!/usr/bin/env bash
# Fixture of the case compaction-state: the worktree of an implementer of ticket demo/01, half-way through
# the ticket, at the moment the history of the case (history.jsonl) ends.
#
#   ./        a linked worktree of the demo project on branch demo/01: the ticket is claimed and
#             src/alpha.mjs with test/alpha.test.mjs are committed; src/index.mjs and test/index.test.mjs
#             are new and package.json is changed, none of them committed; `node --test` fails, because the
#             `exports` field of package.json names ./src/index.js and the file is src/index.mjs
#   ./.demo/  the main checkout of the demo project (harness/evals/lib/demo-project.sh, finish local-green),
#             with ticket 01 made larger and docs/conventions.md added on main
#   PROBES.md the questions the prompt asks the agent to read after the compaction
#
# The run starts in ./, so hooks/after-compact.mjs sees a linked worktree on a ticket's branch and hands
# back the ticket file and `git status --short`: the implementer's half of the hook. The main checkout lies
# inside the worktree folder because the scaffold may write only into the current folder and $HOME; its
# .git/info/exclude keeps .demo/ and PROBES.md out of `git status`.
#
# Bash, not Node, as every scaffold: it is test code. Writes only into the current folder and $HOME
# (demo-project.sh writes the Harness state there and refuses the user's real home folder).
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname (a process start is slow in Git Bash), then
# made absolute: the demo project is built in a subfolder.
here=.
case "${BASH_SOURCE[0]}" in */* | *\\*) here="${BASH_SOURCE[0]%[/\\]*}" ;; esac
here="$(cd "$here" && pwd -P)"
work="$(pwd -P)"

# The guard of demo-project.sh, before the first write here: a refused HOME or HARNESS_HOME leaves this folder empty.
node "$here/../lib/state-guard.cjs" "${HOME:-}" "$work" || exit 1
mkdir .demo
(cd .demo && bash "$here/../lib/demo-project.sh" local-green none)

# The same identity and dates as demo-project.sh: the commits do not depend on the user.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

# put <file> <<EOF — writes the here-document to <file> without starting a process (demo-project.sh).
put() {
    local text
    IFS= read -r -d '' text || true
    printf '%s' "$text" >"$1"
}

# --- main: ticket 01 with four done items, the conventions the history reads -------------------
put .demo/.scratch/demo/issues/01-alpha.md <<'EOF'
# 01 — alpha: функция double

Type: task
Status: open
Blocked by: —

## Что происходит

В `src/` нет функции `double`, а у пакета нет общей точки входа: `sum` импортируют по пути файла.

## Что делаем

1. `src/alpha.mjs` экспортирует `double(n)`: возвращает `n * 2`; для не-числа бросает `TypeError`.
2. `src/index.mjs` (новый) реэкспортирует `sum` и `double`.
3. `package.json`: поле `exports` указывает на `./src/index.mjs`.

## Готово, когда

- [ ] `double(2)` возвращает `4`; test в `test/alpha.test.mjs`.
- [ ] `double('2')` бросает `TypeError`; test там же.
- [ ] `import { sum, double } from 'demo'` работает; test в `test/index.test.mjs`.
- [ ] `node --test` — код 0.

## Где в коде

- `src/alpha.mjs` — новый
- `test/alpha.test.mjs` — новый
- `src/index.mjs` — новый
- `test/index.test.mjs` — новый
- `package.json`

## Итог

Заполняется при закрытии.
EOF
mkdir -p .demo/docs
cp "$here/conventions.md" .demo/docs/conventions.md
git -C .demo add -A
git -C .demo commit -q -m "demo: ticket 01 grows an entry point; conventions"
git -C .demo push -q origin main
git -C .demo fetch -q origin
# The git of an eval run is a copy without its templates (scripts/eval-run-env.mjs): `git init` made no info/.
mkdir -p .demo/.git/info
printf '/.demo/\n/.wt/\n/PROBES.md\n' >>.demo/.git/info/exclude

# --- the worktree: made in .wt/01, then moved here (git refuses a folder that is not empty) ------
git -C .demo worktree add -q --no-checkout -b demo/01 "$work/.wt/01" origin/main
mv .wt/01/.git .git
rmdir .wt/01 .wt
git -C .demo worktree repair "$work" 2>/dev/null
git reset -q --hard

# The ticket claimed, as `ticket claim` leaves it.
sed -i.bak 's/^Status: open$/Status: claimed 2026-10-01T09:12Z/' .scratch/demo/issues/01-alpha.md
rm .scratch/demo/issues/01-alpha.md.bak
git commit -q -am "demo/01: claim"

put src/alpha.mjs <<'EOF'
/** Doubles a number. NaN and Infinity are numbers too; any other type is a TypeError. */
export function double(n) {
  if (typeof n !== 'number') throw new TypeError('double: n must be a number')
  return n * 2
}
EOF
put test/alpha.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double } from '../src/alpha.mjs'

test('double doubles', () => {
  assert.equal(double(2), 4)
})

test('double rejects a string', () => {
  assert.throws(() => double('2'), { name: 'TypeError', message: 'double: n must be a number' })
})

test('double keeps nan and infinity', () => {
  assert.ok(Number.isNaN(double(NaN)))
  assert.equal(double(Infinity), Infinity)
})
EOF
git add src/alpha.mjs test/alpha.test.mjs
git commit -q -m "demo/01: double with tests"

# Not committed: the entry point, its test, and package.json with the wrong file in `exports`.
put src/index.mjs <<'EOF'
export { sum } from './sum.mjs'
export { double } from './alpha.mjs'
EOF
put test/index.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { double, sum } from 'demo'

test('the package exports sum and double', () => {
  assert.equal(sum(2, 3), 5)
  assert.equal(double(2), 4)
})
EOF
put package.json <<'EOF'
{
  "name": "demo",
  "private": true,
  "type": "module",
  "exports": "./src/index.js",
  "scripts": {
    "test": "node --test"
  }
}
EOF

cp "$here/probes.md" PROBES.md
