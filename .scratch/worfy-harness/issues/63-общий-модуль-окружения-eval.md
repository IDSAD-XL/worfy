# 63 — Общий модуль окружения для `eval:harness` и `eval:outcome`

Type: task
Status: open
Blocked by: 29, 52
Source: ревью PR #697 (инфраструктура worfy-harness 52), линза границ модулей, 2026-10-21. `scripts/eval-outcome-lib.mjs`
повторяет из `scripts/eval-harness.mjs` закреплённые модели, очистку окружения, `claudeBinary`, `checkVersion`,
`pluginCopy` и `gitCopy` (комментарий `shortcut:`), потому что PR #690 (worfy-harness 29) в это время менял
`eval-harness.mjs`.

## Что происходит

- Две копии одного кода. Test равенства в `test/contract/harness-evals-outcome.test.ts` сверяет только константы; тела
  функций могут разойтись молча.
- `eval-outcome-lib.mjs` — два модуля в одном файле: окружение запуска (его использует только обёртка) и разбор trace,
  проверки, метрики.

## Что делаем

1. `scripts/eval-run-env.mjs`: константы моделей и версии, `cleanEnv`, `claudeBinary`, `runClaude`, `checkVersion`,
   `pluginCopy(source)` (исключает папки результатов обоих eval), `gitCopy`. Оба скрипта импортируют его.
2. Test равенства удалить; test-ы обоих eval — на общий модуль.
3. Оставшуюся часть `eval-outcome-lib.mjs` не трогать, кроме импортов.

## Готово, когда

- [ ] Ни одной копии функций окружения в `scripts/eval-*.mjs`; `grep` по именам функций находит одно определение.
- [ ] `test/contract/harness-evals.test.ts` и `test/contract/harness-evals-outcome.test.ts` — exit 0; lint, typecheck — 0.

## Где в коде

- `scripts/eval-harness.mjs`, `scripts/eval-outcome.mjs`, `scripts/eval-outcome-lib.mjs`.

## Итог

Заполняется при закрытии.
