# 63 — Общий модуль окружения для `eval:harness` и `eval:outcome`

Type: task
Status: done 2026-10-21T22:28Z
PR: #713
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

## Где остановились (2026-10-21, плановая остановка по лимиту использования)

- PR [#713](https://github.com/IDSAD-XL/worfy/pull/713), head d2643d5c, MERGEABLE. Реализация готова: `scripts/eval-run-env.mjs`,
  оба eval импортируют его, test равенства удалён.
- Проверки implementer-а на d2643d5c и предыдущем коммите — exit 0: `harness-evals.test.ts` (173 + 1 skip),
  `harness-evals-outcome.test.ts` (87), `no-github-git`, `no-rmsync`, `e2e-no-spawn-on-load`, `plugin-neutral.test.sh`
  (26/0), `check-cyrillic`, lint, typecheck. Три mutant-а (фильтр PATH, папка результатов, `GIT_CONFIG_NOSYSTEM`) —
  красные.
- Ревью первого круга (high: корректность, границы модулей) было запущено и остановлено до результата. Начать с него
  заново на текущем head.
- Дальше: ревью → круг исправлений → очередь Session-оркестратора: gate full и check/windows (runner:
  `harness-evals.test.ts`, `harness-evals-outcome.test.ts`, `no-github-git.test.ts`).
- После 63 — Ticket 65: тот же `eval-outcome-lib.mjs` и тот же contract test.

## Итог

Заполняется при закрытии.
