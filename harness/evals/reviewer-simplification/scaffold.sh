#!/usr/bin/env bash
# Fixture of the case: project demo, finish local-green, no variant (harness/evals/lib/demo-project.sh),
# and on top of it a ticket whose change holds two things a simplification review looks at:
#
#   main, pushed to origin   src/duration.mjs exports formatDuration; src/report.mjs calls it
#                            directly. Ticket 01 asks for two export lines, CSV and TSV, in a new
#                            src/export.mjs.
#   demo/01, checked out     src/export.mjs adds durationText, a function that only passes its
#                            argument on to formatDuration — a thin wrapper, a finding; and csvLine
#                            and tsvLine, two near-copies under a comment
#                            `shortcut: <limit>, <when to redo>` — the author's decision, not a
#                            finding: the diff has two formats, and the comment postpones the merge
#                            to the third.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

bash "$(dirname "$0")/../lib/demo-project.sh" local-green none

# The run's HOME is empty: git has no identity there, and the fixture must not depend on one.
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z

# --- main: the existing helper, its caller, and the ticket --------------------------------
cat >src/duration.mjs <<'EOF'
/** A duration in milliseconds as text: 65000 is "1m 05s". */
export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
EOF
cat >src/report.mjs <<'EOF'
import { formatDuration } from './duration.mjs'

/** One line of the report: "build took 1m 05s". */
export function reportLine(task) {
  return `${task.name} took ${formatDuration(task.ms)}`
}
EOF
cat >test/duration.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDuration } from '../src/duration.mjs'

test('formatDuration shows minutes and seconds', () => {
  assert.equal(formatDuration(65000), '1m 05s')
})
EOF
cat >test/report.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportLine } from '../src/report.mjs'

test('reportLine names the task and its duration', () => {
  assert.equal(reportLine({ id: 7, name: 'build', ms: 65000 }), 'build took 1m 05s')
})
EOF
cat >.scratch/demo/issues/01-alpha.md <<'EOF'
# 01 — alpha: строки экспорта задачи в CSV и TSV

Type: task
Status: open
Blocked by: —

## Что происходит

Задачу (`{ id, name, ms }`) можно показать только строкой отчёта (`src/report.mjs`). Выгрузить
список задач в таблицу нечем.

## Что делаем

Новый `src/export.mjs` экспортирует две функции:

- `csvLine(task)` — `id`, `name` и длительность текстом через запятую;
- `tsvLine(task)` — те же три поля через табуляцию.

Длительность текстом уже умеет `formatDuration` (`src/duration.mjs`). Экранирование не нужно: имя
задачи — только латинские буквы, цифры и дефис, это проверяется при создании задачи.

## Готово, когда

- [ ] `csvLine({ id: 7, name: 'build', ms: 65000 })` возвращает `7,build,1m 05s`; test в
  `test/export.test.mjs`.
- [ ] `tsvLine` той же задачи возвращает те же поля через табуляцию.
- [ ] `node --test` — код 0.

## Где в коде

- `src/export.mjs` — новый
- `test/export.test.mjs` — новый

## Итог

Заполняется при закрытии.
EOF
sed -i.bak 's#| 01 | src/alpha.mjs, test/alpha.test.mjs | 1 |#| 01 | src/export.mjs, test/export.test.mjs | 1 |#' .scratch/demo/spec.md
rm .scratch/demo/spec.md.bak
git add -A
git commit -q -m "demo: formatDuration, its report line and ticket 01"
git push -q origin main
git fetch -q origin

# --- demo/01: the implementer's change ----------------------------------------------------
git checkout -q -b demo/01
sed -i.bak 's/^Status: open$/Status: claimed 2026-10-01T09:00Z/' .scratch/demo/issues/01-alpha.md
rm .scratch/demo/issues/01-alpha.md.bak
cat >src/export.mjs <<'EOF'
import { formatDuration } from './duration.mjs'

/** The duration of a task as text. */
function durationText(ms) {
  return formatDuration(ms)
}

// shortcut: no more than two formats with a copy of the join each, redo when a third format appears
/** One task as a line of a CSV file. */
export function csvLine(task) {
  return [task.id, task.name, durationText(task.ms)].join(',')
}

/** One task as a line of a TSV file. */
export function tsvLine(task) {
  return [task.id, task.name, durationText(task.ms)].join('\t')
}
EOF
cat >test/export.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvLine, tsvLine } from '../src/export.mjs'

const task = { id: 7, name: 'build', ms: 65000 }

test('csvLine joins the fields with commas', () => {
  assert.equal(csvLine(task), '7,build,1m 05s')
})

test('tsvLine joins the fields with tabs', () => {
  assert.equal(tsvLine(task), '7\tbuild\t1m 05s')
})
EOF
git add -A
git commit -q -m "demo/01: export lines of a task, CSV and TSV"
