# 02: Модели: регулярная `claude-sonnet-5-5` и пилота `claude-opus-5-5` вместо одной, judge Opus

Type: task
Status: claimed 2026-11-28T02:59Z
Branch: worfy-harness-eval/02
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 02; «Решения владельца», «Модели» (Ticket 06 темы, «да»); «Решения по
реализации» («Модели»); critic 2026-11-24, возражение 2 (одна константа `MODEL` делится на две, 02 блокирует 08);
«Волны», Wave 1

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Одна пара констант служит всем скриптам eval-ов: `MODEL = 'claude-sonnet-5'` и `JUDGE_MODEL = 'claude-haiku-4-5'`
  (`scripts/eval-run-env.mjs:32-33`). Их берут `scripts/eval-harness.mjs:81` (флаги `:96-97`),
  `scripts/eval-outcome.mjs:58` (`:305`, `:327-329`) и judge scorer-а `scripts/eval-outcome-lib.mjs:33` (`:719`).
- За 30 дней на `claude-sonnet-5` пришлось 0,1 % сообщений владельца, на `claude-opus-5-5` — 85 %. Judge
  `claude-haiku-4-5` трижды ошибался так, что grader переписывали.

## Что строить

- Две модели агента вместо одной: модель регулярных прогонов — `claude-sonnet-5-5`; модель пилота и замера расхода —
  `claude-opus-5-5`. Имена констант выбирает Ticket, например `REGULAR_MODEL` и `PILOT_MODEL`.
- Judge — `claude-opus-5-5` везде: у `claude plugin eval` (`--judge-model`) и в scorer-е `eval-outcome-lib.mjs`.
- `pnpm eval:harness` и `pnpm eval:outcome` берут модель регулярных прогонов. Модель пилота берёт runner Ticket-а 08.
- Строки запуска (`eval:harness: claude …, model …, judge …`) называют новые модели.
- Платный прогон этой смены — точка отсчёта, Ticket 05. `harness/README.md` («When to run the evals», `:247-250`)
  требует полного прогона при смене `MODEL` или `JUDGE_MODEL`. Решение советника, принятое владельцем: точка отсчёта —
  первый полный прогон после смены моделей. PR этого Ticket-а называет 05 своим полным прогоном и идёт с `--dry-run`.
- В `harness/README.md` строка «a change of `MODEL` or `JUDGE_MODEL` in `scripts/eval-harness.mjs`» называет новое
  место констант (они живут в `eval-run-env.mjs`).

## Где в коде

- `scripts/eval-run-env.mjs:32-33` — константы
- `scripts/eval-harness.mjs:81`, `:96-97`, `:397`
- `scripts/eval-outcome.mjs:58`, `:305`, `:327-329`
- `scripts/eval-outcome-lib.mjs:33`, `:719` — judge scorer-а
- `harness/README.md:163-165` (цена полного набора на `claude-sonnet-5`), `:247-250`
- `test/contract/harness-evals-run.test.ts`, `test/contract/harness-evals-outcome.test.ts`

## Test-ы

- Contract test-ы со stub-ом `claude`: `eval:harness` передаёт `--model claude-sonnet-5-5` и
  `--judge-model claude-opus-5-5`; judge scorer-а зовёт `claude-opus-5-5`; константа модели пилота экспортирована и
  равна `claude-opus-5-5`.
- Сначала падающий test: ожидание новых флагов против нынешних констант.
- Без моделей в CI; настоящий binary Codex не запускается.

## Готово, когда

- [ ] Две константы модели агента и judge `claude-opus-5-5`; все импорты переведены; contract test-ы это проверяют.
- [ ] `pnpm eval:harness -- --dry-run` печатает `--model claude-sonnet-5-5` и `--judge-model claude-opus-5-5`; вывод
      в «Итог».
- [ ] `harness/README.md` называет место констант и новые модели.
- [ ] PR называет Ticket 05 своим полным прогоном.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
