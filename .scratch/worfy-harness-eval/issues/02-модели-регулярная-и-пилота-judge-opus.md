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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts test/contract/harness-evals.test.ts` exit 0 · mac - · 9598b9dd0
- [ ] `pnpm eval:harness -- --dry-run` печатает `--model claude-sonnet-5-5` и `--judge-model claude-opus-5-5`; вывод
      в «Итог».
  - evidence: test-run pass · `CLAUDE_BIN=test/fixtures/eval-stub/claude.cjs pnpm eval:harness -- --dry-run` exit 0 · mac - · 9598b9dd0
- [ ] `harness/README.md` называет место констант и новые модели.
  - evidence: commit pass · worfy-harness-eval/02: README names the constants' file without a new repository script path · - - · 2e102aaa1ca24934f62842401867b16d827b215b
- [ ] PR называет Ticket 05 своим полным прогоном.
  - evidence: commit pass · PR 2356 description, section Full eval run: ticket 05 is its full run · - - · 9e22c68476d1c3187c4aa9ff0fcf6cd3abbaed66
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

- Одна константа `MODEL` в `scripts/eval-run-env.mjs` стала двумя: `REGULAR_MODEL = 'claude-sonnet-5-5'` (агент
  `pnpm eval:harness` и `pnpm eval:outcome`) и `PILOT_MODEL = 'claude-opus-5-5'` (агент пилота и замера расхода, его
  возьмёт runner Ticket-а 08). `JUDGE_MODEL` — `claude-opus-5-5`: и `--judge-model` у `claude plugin eval`, и judge
  scorer-а (`judgeCommand` в `scripts/eval-outcome-lib.mjs`, импорт не менялся). Импорты `eval-harness.mjs` и
  `eval-outcome.mjs` переведены; строки запуска называют новые модели.
- Сначала падающий test: в `test/contract/harness-evals-run.test.ts` — test констант и test строки запуска и строк
  `--dry-run`; в `test/contract/harness-evals-outcome.test.ts` — литералы моделей у judge и у вызова `eval:outcome`.
  На старых константах красные 6 test-ов (`expected 'claude-haiku-4-5' to be 'claude-opus-5-5'`, `expected
  'claude-sonnet-5' to be 'claude-sonnet-5-5'`), после правки оба файла зелёные.
- `pnpm eval:harness -- --dry-run` (claude — stub, временный HOME), exit 0; строки вызовов:
  `eval:harness: main — claude plugin eval <plugin-copy> --scaffold --trust-plugin --ablation none --threshold 0.8
  --no-publish --model claude-sonnet-5-5 --judge-model claude-opus-5-5 --max-cost-usd 30 …` и такая же у `gui`.
- `harness/README.md`: абзац о цене называет модели агента и judge и место констант; старая цена 15 USD помечена как
  цена на `claude-sonnet-5` с judge `claude-haiku-4-5`. Правило полного прогона называет `REGULAR_MODEL` и
  `JUDGE_MODEL` в `eval-run-env.mjs` («the run environment `scripts/eval-harness.mjs` imports»): полного пути
  `scripts/eval-run-env.mjs` в README нет, потому что `harness/bin/tests/plugin-neutral.test.sh` (ADR-0074, plugin
  без путей скриптов репозитория worfy) красный на новом пути скрипта; первая версия с полным путём его и покраснила. Вне списка файлов: `scripts/eval-outcome/README.md` называл judge
  `claude-haiku-4-5`, исправлено на `claude-opus-5-5`.
- Платного прогона в этом Ticket-е нет (решение владельца 2026-11-28): полный прогон на новых моделях — точка отсчёта,
  Ticket 05; PR называет его своим полным прогоном.
