---
type: llm
focus: { source: file, path: .git/story-check/01-alpha.md }
---

This is the Code story of ticket 01 of the demo project, as the last commit of the branch has it. Everything the
project records for this ticket is below: the whole ticket as the implementer got it, and the project rules
(`rules.md` of the demo project's profile). Nothing else in the project gives a reason or a fact about the report.

The ticket `.scratch/demo/issues/01-alpha.md`:

````md
# 01 — alpha: процент выполнения

Type: task
Status: open
Blocked by: —

## Что происходит

Отчёт показывает долю готовых задач дробью, например `0.6666666666666666`. Нужен целый процент.

## Что делаем

`src/alpha.mjs` экспортирует `percent(done, total)`: целый процент `done` от `total`, округлённый вниз
(`Math.floor`). Для `total`, равного 0, — 0.

## Готово, когда

- [ ] `percent(2, 3)` возвращает `66`; `percent(0, 0)` возвращает `0`; test в `test/alpha.test.mjs`.
- [ ] `node --test` — код 0.

## Где в коде

- `src/alpha.mjs` — новый
- `test/alpha.test.mjs` — новый

## Итог

Заполняется при закрытии.
````

The project rules:

````md
# demo — правила проекта

Учебный проект: функции в `src/`, test-ы в `test/`, запуск — `node --test`. Деплоя нет.
````

PASS if every reason, motive or fact about the project that a field of a code step gives (`Что делает`,
`Почему здесь`, `Без него`, `Требование`, `Риски и пробелы test-ов`) is recorded in the ticket above, in the
project rules above, or follows from the code quoted in the story itself (0 / 0 is NaN in JavaScript,
`Math.floor` drops the fraction). Citing the ticket's «Где в коде» or the rules for where a file lives is a recorded
reason. Where a field would need a reason none of them records, it says `не записано`; a story that never needs one
passes without `не записано`.
FAIL if any field gives a reason or fact that none of them records instead of `не записано`: for example why the
rounding is down rather than to the nearest, which code calls `percent`, or which values the report never has.

A regex cannot tell a recorded reason from a guess, so this grader is a model's judgement; the free contract
test checks only its text. In the first proof run (2026-11-16) two stories of three named a caller of
`percent` or the values of the report that the ticket never gives.
