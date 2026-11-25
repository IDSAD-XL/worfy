# 150 — Quarantine of the flaky epic-frame Auberge performance e2e on macOS CI

Type: task
Status: claimed 2026-11-25T18:12Z
Branch: worfy-polish/150
Blocked by: none
Source: бриф Orchestrator-а 2026-11-25: CI run 45657771792 PR #2218 (worfy-assistant 11) красный в job-е `macos-e2e`
(job 139359148262) на e2e test-е старта Auberge-проекта, который PR не трогает; разбор 84 job-ов `macos-e2e` с
2026-11-22; правило карантина — `rules-merge.md` проекта, пример формы — Ticket worfy-polish 143.

Кто: агент. Не платформенный PR: только test-ы, запись `test/quarantine/` и два Ticket-а.

## Что происходит

`test/e2e/epic-frame.spec.ts:1113` — «an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly
over its biggest Epic» — меряет, за сколько миллисекунд Project из 155 Ticket-ов (размер проекта Auberge) становится
интерактивным (`N`). На Mac владельца предел — 3 s (`START_MS`, `test/e2e/start-budget.ts`). На GitHub Actions test
сначала трижды запускает Project из одного Ticket-а и берёт медиану (`R`); предел там — `min(6 × R, 7300)` и не меньше
3000 ms (`startBudget`, `START_RATIO` = 6, `RUNNER_START_CAP_MS` = 7300).

На PR #2218 (worfy-assistant 11) test красный с обеих попыток: 9436 ms и на повторе в CI 8788 ms против предела
7300 ms. PR не трогает ни `test/e2e/epic-frame.spec.ts`, ни `src/renderer/canvas`. Красный `ci-ok` такого PR — flaky
test, а не его ошибка.

Правила проекта (`rules-merge.md`): flaky test, который краснит `ci-ok`, — в карантин с владельцем и сроком не дальше
14 дней; предел и timeout не поднимают; ручной повтор упавшего job-а — не путь к merge.

### Evidence: 84 job-а `macos-e2e` с 2026-11-22T01:03Z по 2026-11-25T17:24Z

Из log-ов каждого завершённого job-а `macos-e2e` workflow `CI` (на `main` и на ветках PR) взяты `N` и `R` первой
попытки test-а; «повтор» — одна повторная попытка в CI (`test/flaky.ts`). «Ядро» — run на коде, где уже есть
attention core Assistant-а (`src/main/assistant/core/`); на `main` оно с worfy-assistant 03.

Красные первые попытки — 4 из 84:

| Время (UTC) | Run / job | Ветка, head | `N`, ms | `R`, ms | Предел, ms | Повтор | Ядро |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-23T21:09 | 45263502937 / 138007474540 | worfy-acceptance/01, 9ee890268 | 10258 | 3857 | 7300 | красный, 11468 | нет |
| 2026-11-25T11:43 | 45598783276 / 139152095369 | worfy-assistant/03, e65005e04 | 7716 | 1916 | 7300 | зелёный | нет |
| 2026-11-25T13:43 | 45618805239 / 139221291463 | worfy-product-session/37, 5eae90d10 | 8227 | 2007 | 7300 | зелёный | нет |
| 2026-11-25T17:20 | 45657771792 / 139359148262 | worfy-assistant/11, 044ca9f4d | 9436 | 1880 | 7300 | красный, 8788 | да |

Сводка по первым попыткам:

| Выборка | Job-ов | `N` min / медиана / max, ms | `N / R` min / медиана / max | `R` min / медиана / max, ms |
| --- | --- | --- | --- | --- |
| все | 84 | 2117 / 4963 / 10258 | 1.83 / 3.56 / 5.19 | 640 / 1384 / 3857 |
| без ядра | 71 | 2117 / 4901 / 10258 | 1.83 / 3.50 / 5.19 | 653 / 1353 / 3857 |
| с ядром | 13 | 2745 / 5998 / 9436 | 3.37 / 3.76 / 5.02 | 640 / 1561 / 1880 |

- В 58 из 84 job-ов `6 × R` больше 7300: предел решает не `R`, а потолок 7300 ms, то есть скорость runner-а, а не
  соотношение с одно-Ticket-ным стартом, ради которого `START_RATIO` заведён.
- 2026-11-25 из 43 первых попыток 12 выше 6200 ms — запас до потолка меньше 1.1 s.
- `N / R` красных job-ов (2.66–5.02) — внутри разброса зелёных (1.83–5.19): Project не стал медленнее относительно
  одно-Ticket-ного старта, медленнее стал runner.
- Два из четырёх красных — на коде без attention core: ядро не единственная причина. Оценка из чтения кода, не
  замер: на `main` с worfy-assistant 03 ядро при загрузке Project-а из 155 Ticket-ов делает около 23 синхронных
  записей `assistant-items.json` с проверкой zod (`src/main/assistant/core/sources.ts:133-150`,
  `src/main/assistant/core/attention-core.ts:96-101`, `src/main/storage/json-file.ts:81-93`) — порядка десятков ms.
  Замер — Ticket worfy-polish 151.

Вывод: flaky test под нагрузкой runner-а; предел на CI зависит от потолка, а не от замеренной базы. Починка — Ticket
worfy-polish 151 (замер ядра, запись одним сохранением, предел от замеренной базы без подъёма 3 s).

## Что делаем

1. Запись карантина `test/quarantine/epic-frame-auberge-start-macos-ci.json`: `kind` `quarantine`, `runner`
   `playwright`, `platforms` `["darwin"]` (e2e идут только на macOS), owner `worfy-polish 151`, `since` 2026-11-25,
   `until` 2026-12-09 (14 дней — предел для `kind` `quarantine`); в `reason` — run-ы и числа выше.
2. Test объявлен через `quarantined('epic-frame-auberge-start-macos-ci')` из `test/e2e/quarantine.ts` вместо `test`.
3. Предел и timeout-ы не меняются: ни `START_MS`, ни `START_RATIO`, ни `RUNNER_START_CAP_MS`, ни ожидания test-а.

## Готово, когда

- [ ] Запись `test/quarantine/epic-frame-auberge-start-macos-ci.json` — `kind` `quarantine`, `runner` `playwright`,
      owner `worfy-polish 151`, срок в пределах 14 дней; test помечен `quarantined('<id>')`;
      `test/unit/quarantine.test.ts` зелёный; список Playwright показывает test пропущенным.
- [ ] Таблица evidence выше: run-ы, job-ы и числа 84 job-ов `macos-e2e`.
- [ ] Предел не поднят: `test/e2e/start-budget.ts` и `src/` не изменены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.

## Где в коде

- `test/quarantine/epic-frame-auberge-start-macos-ci.json` (новый)
- `test/e2e/epic-frame.spec.ts:1113` (и импорт `quarantined`)
- `.scratch/worfy-polish/issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md` (новый Ticket)
- Только читать: `test/quarantine.ts`, `test/e2e/quarantine.ts`, `test/e2e/start-budget.ts`,
  `test/unit/quarantine.test.ts`, `src/main/assistant/core/`

## Вне скоупа

- Замер ядра, запись одним сохранением и новый предел — Ticket worfy-polish 151; он же снимает карантин.
