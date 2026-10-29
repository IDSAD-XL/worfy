# 59 — e2e на GitHub macOS runner-е в два worker-а Playwright: сначала замер, потом один shard вместо двух

Type: task
Status: open
Blocked by: —
Source: итог Ticket-а [58](58-узкие-правила-e2e-для-путей-src-main.md) (узких строк таблицы для частых путей `src/main`
нет: они выполняются при каждом старте приложения); решение владельца 2026-10-29, раунд 3, Q9 (не выходим за
бесплатный лимит runner-ов); решение владельца 2026-10-30: замер eco (Ticket 43) и шаг 3 Ticket-а 39 стартуют, как
только медиана CI PR не больше 15 min.

## Что происходит

- Медиана времени по стене PR (push → `ci-ok`, очередь включена) — 15,8 min («Итог» Ticket-а 54); планка — 15 min.
  Без очереди macOS — 4,8 min: время съедает очередь, бесплатный план даёт 5 macOS-job-ов на весь account.
- PR на весь набор e2e берёт два macOS-job-а `macos-e2e (1/2)`, `(2/2)` по 14–21 min. Ticket 58 показал: сузить
  такие PR таблицей путей нельзя, правки `src/main` чаще всего задевают код старта.
- `playwright.config.ts:62` — `E2E_WORKERS` = 3 на Mac владельца вне CI, 1 везде ещё. Комментарий над ним: GitHub
  macOS runner не мерили в нескольких worker-ах. На Mac владельца 1 → 2 worker-а дали 565 s → 292 s.
- `macos-latest` — arm64, 3 CPU, 7 GB памяти: два Electron-а одновременно должны поместиться, но это надо измерить.

## Что делаем

1. **Замер на runner-е.** Ручной run (`workflow_dispatch`, `job=full-macos`) на ветке Ticket-а, в которой
   `macos-e2e` идёт с `--workers=2`: три run-а подряд. По каждому — длина каждого shard-а (`started_at`,
   `completed_at` job-ов, без логов), число flaky и упавших test-ов. Для сравнения — три последних run-а
   `full-macos` или push в `main` с одним worker-ом.
2. **Решение по данным.** Если три run-а в два worker-а зелёные без новых flaky и весь набор укладывается в один
   job не дольше 20 min — `macos-e2e` идёт одним shard-ом в два worker-а (`scripts/e2e-shard.mjs` и число
   shard-ов в `scripts/ci-scope.mjs`, `e2eShards`). Если зелёные, но длиннее — два shard-а в два worker-а.
   Если красные — один worker остаётся, причина и данные в «Итог».
3. **Комментарий в `playwright.config.ts`** — с замером runner-а, как у замера Mac владельца. Значение для
   runner-а — через `process.env.CI` на darwin или флаг в `ci.yml`; не через число ядер машины.
4. **Повторный замер медианы** — на 10 PR с кодом после merge, тем же методом, что в «Итог» Ticket-а 54.

## Готово, когда

- [ ] «Итог»: таблица трёх run-ов в два worker-а против трёх в один (длина shard-ов, flaky, упавшие), ссылки на
      run-ы.
- [ ] `macos-e2e` идёт по решению пункта 2; contract test-ы `test/contract/ci-workflow.test.ts` и
      `test/contract/ci-scope-e2e.test.ts` про число shard-ов зелёные.
- [ ] Число и вид runner-ов не растут: тот же `macos-latest`, никаких платных или self-hosted runner-ов (Q9).
- [ ] Timeout-ы test-ов не поднимаются (кроме множителя Ticket-а 57, он уже есть).
- [ ] Медиана времени по стене следующих 10 PR с кодом — не больше 15 min; таблица в «Итог». Если больше — причина по
      тем же данным и следующий шаг.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `playwright.config.ts` — `E2E_WORKERS` и комментарий над ним.
- `.github/workflows/ci.yml` — job `macos-e2e` (около строки 234), ручной `full-macos`.
- `scripts/e2e-shard.mjs`, `scripts/ci-scope.mjs` (`e2eShards`), `test/e2e/timings.json`.
- `test/contract/ci-workflow.test.ts`, `test/contract/ci-scope-e2e.test.ts`.

## Вне скоупа

- `windows-e2e` в несколько worker-ов: Windows runner-ы делят с Linux общий лимит в 20 job-ов, не очередь macOS.
  Если замер медианы покажет, что `ci-ok` ждёт именно `windows-e2e`, — строка в «Итог» и следующий Ticket.
- e2e на Linux runner-ах (xvfb) — большая отдельная работа; только строка-предложение в «Итог», если пункт 2 не
  дотянет медиану.
- Карта «модуль → spec-файлы» по V8 coverage (предложение «Итог» Ticket-а 58).

## Итог
