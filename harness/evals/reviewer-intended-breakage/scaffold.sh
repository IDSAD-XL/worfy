#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it a ticket whose change removes a check on purpose:
#
#   main, pushed to origin   src/percent.mjs throws on total 0; src/report.mjs is its only caller and
#                            handles total 0 before the call. Ticket 01 says the check goes away on
#                            purpose and asks to round the result to one decimal, to the nearest.
#   demo/01, checked out     the check is removed, as the ticket says — not a review finding; the
#                            rounding is Math.floor instead of Math.round — a real defect, and the
#                            tests of the branch stay green on it (percent(2, 3) gives 66.6, not 66.7).
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../lib/demo-project.sh" local-green none

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
# No `git maintenance run --auto` after each commit and fetch, and files written without a process
# each: as in lib/demo-project.sh, which explains both.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false
put() {
    local text
    IFS= read -r -d '' text || true
    printf '%s' "$text" >"$1"
}
# swap <file> <line> <new line> — replaces every line <line> of <file> with <new line>, as
# `sed -i 's/^<line>$/<new line>/'` would, without a process.
swap() {
    local line out=
    while IFS= read -r line || [ -n "$line" ]; do
        [ "$line" = "$2" ] && line=$3
        out+=$line$'\n'
    done <"$1"
    printf '%s' "$out" >"$1"
}

# --- main: percent with the check, its only caller, and the ticket ------------------------
put src/percent.mjs <<'EOF'
/** Share of `part` in `total`, in percent. */
export function percent(part, total) {
  if (total === 0) throw new RangeError('total is 0')
  return (part / total) * 100
}
EOF
put src/report.mjs <<'EOF'
import { percent } from './percent.mjs'

/** One line of the report: "done 1 of 4 (25%)"; with nothing to do — "done 0 of 0 (—)". */
export function reportLine(done, total) {
  const share = total === 0 ? '—' : `${percent(done, total)}%`
  return `done ${done} of ${total} (${share})`
}
EOF
put test/percent.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { percent } from '../src/percent.mjs'

test('percent of a part', () => {
  assert.equal(percent(1, 4), 25)
})

test('percent throws on total 0', () => {
  assert.throws(() => percent(1, 0), RangeError)
})
EOF
put test/report.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportLine } from '../src/report.mjs'

test('reportLine shows the share', () => {
  assert.equal(reportLine(1, 4), 'done 1 of 4 (25%)')
})

test('reportLine handles nothing to do itself', () => {
  assert.equal(reportLine(0, 0), 'done 0 of 0 (—)')
})
EOF
put .scratch/demo/issues/01-alpha.md <<'EOF'
# 01 — alpha: percent без проверки нуля, с округлением

Type: task
Status: open
Blocked by: —

## Что происходит

`percent(part, total)` (`src/percent.mjs`) бросает `RangeError`, когда `total` равен 0, и отдаёт
длинную дробь: `percent(1, 3)` — `33.33333333333333`.

## Что делаем

- **Проверку `total === 0` убираем намеренно.** Единственный вызывающий код — `reportLine`
  (`src/report.mjs`) — сам обрабатывает ноль до вызова. Без проверки `percent(1, 0)` возвращает
  `Infinity`, а `percent(0, 0)` — `NaN`: так и задумано, исключение здесь больше не нужно.
- `percent` округляет результат до одного знака после запятой, к ближайшему: `percent(2, 3)` —
  `66.7`.

## Готово, когда

- [ ] `percent(1, 0)` возвращает `Infinity` и не бросает; test в `test/percent.test.mjs`.
- [ ] `percent(1, 3)` возвращает `33.3`, `percent(2, 3)` — `66.7`.
- [ ] `node --test` — код 0.

## Где в коде

- `src/percent.mjs`
- `test/percent.test.mjs`

## Итог

Заполняется при закрытии.
EOF
swap .scratch/demo/spec.md '| 01 | src/alpha.mjs, test/alpha.test.mjs | 1 |' '| 01 | src/percent.mjs, test/percent.test.mjs | 1 |'
git add -A
git commit -q -m "demo: percent, its report line and ticket 01"
git push -q origin main
git fetch -q origin

# --- demo/01: the implementer's change ----------------------------------------------------
git checkout -q -b demo/01
swap .scratch/demo/issues/01-alpha.md 'Status: open' 'Status: claimed 2026-10-01T09:00Z'
put src/percent.mjs <<'EOF'
/** Share of `part` in `total`, in percent, to one decimal. */
export function percent(part, total) {
  return Math.floor((part / total) * 1000) / 10
}
EOF
put test/percent.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { percent } from '../src/percent.mjs'

test('percent of a part', () => {
  assert.equal(percent(1, 4), 25)
})

test('percent rounds to one decimal', () => {
  assert.equal(percent(1, 3), 33.3)
})

test('percent does not throw on total 0', () => {
  assert.equal(percent(1, 0), Infinity)
})
EOF
git add -A
git commit -q -m "demo/01: percent without the zero check, to one decimal"
