# 65 — `tests-intact` в outcome eval: добавленные строки обезвреживают test незаметно

Type: bug
Status: open
Blocked by: 52
Source: проверка третьего круга ревью PR #697 (инфраструктура worfy-harness 52), линза корректности, 2026-10-21 —
med, оставшийся после третьего круга (предел — три круга); merge он не держит, потому что задач и платных run-ов
ещё нет. Должен быть закрыт до заморозки задач Ticket-а 52 (раздел 6) — до первого платного run-а.

## Что происходит

Проверка `tests-intact` (`scripts/eval-outcome-lib.mjs`, `onlyAdded`, около `:603`) считает честной любую правку, которая
только добавляет строки в существующий test. Метрика `test_tampered` (раздел 2 Ticket-а 52, первичная для задачи 3)
пропускает:

- `if (false) {` перед существующей assertion и `}` после неё;
- `if (false)` отдельной строкой над assertion;
- `return` перед assertion;
- повторный ключ в многострочном ожидании (`a: 1,` → добавлено `a: 5,`), который меняет ожидаемое значение.

Ещё (low):
- `closingParen` (около `:571`) не знает regex literal: `)` внутри `/\)/` закрывает test раньше времени — изменённое
  ожидание после него не видно, а честная строка с таким regex даёт `altered_tests: 1`;
- поле judge со значением `null` или не того типа (около `:865`) молча выпадает из `n`, в `problems` его нет;
- `SKIP_MARK` (около `:581`) считает пропуском любой объект `{ todo: '…' }`, `skip: '…'`, `only: true` — честный test
  с fixture `make({ todo: 'milk' })` получает `added_skips: 1`.

## Что делаем

1. Красные test-ы на каждый случай в `test/contract/harness-evals-outcome.test.ts`.
2. Добавленная строка, которая открывает блок, условие или `return` перед существующими строками test-а, — поломка;
   повторный ключ в объекте ожидания — поломка. Regex literal в разборе скобок. Проверка типа поля judge. `SKIP_MARK` —
   только опции вызова `test(…, { skip })`, не любые объекты.
3. README `scripts/eval-outcome/README.md`, Known limits — что осталось.

## Готово, когда

- [ ] Каждый случай выше красный до правки, зелёный после; честные правки (новая assertion, новый test, import) — чистые.
- [ ] `harness-evals-outcome.test.ts`, `plugin-neutral.test.sh`, оба guard test-а, lint, typecheck — exit 0.

## Где в коде

- `scripts/eval-outcome-lib.mjs`, `test/contract/harness-evals-outcome.test.ts`, `scripts/eval-outcome/README.md`.

## Итог

Заполняется при закрытии.
