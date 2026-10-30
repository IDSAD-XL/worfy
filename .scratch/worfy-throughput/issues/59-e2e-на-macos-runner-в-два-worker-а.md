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

- [x] «Итог»: таблица трёх run-ов в два worker-а против трёх в один (длина shard-ов, flaky, упавшие), ссылки на
      run-ы.
- [x] `macos-e2e` идёт по решению пункта 2; contract test-ы `test/contract/ci-workflow.test.ts` и
      `test/contract/ci-scope-e2e.test.ts` про число shard-ов зелёные.
- [x] Число и вид runner-ов не растут: тот же `macos-latest`, никаких платных или self-hosted runner-ов (Q9).
- [x] Timeout-ы test-ов не поднимаются (кроме множителя Ticket-а 57, он уже есть).
- [ ] Медиана времени по стене следующих 10 PR с кодом — не больше 15 min; таблица в «Итог». (после merge) Если больше — причина по
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

Замер 2026-10-30, ручные run-ы `full-macos` (`gh workflow run ci.yml -f job=full-macos`) на ветке `worfy-throughput/59`,
база `d829ab9c`. Длина shard-а — `completed_at − started_at` job-а `macos-e2e` (установка, сборка и test-ы; очередь
не входит); «Playwright» — время, которое печатает сам Playwright в конце shard-а; flaky и упавшие — из его итоговых
строк и строк FLAKY.

**Два worker-а (`workers: 2` при `CI` на darwin):**

| Run | Shard-ы | Длина shard-ов, s | Playwright, min | Итог | Flaky | Упали |
|---|---|---|---|---|---|---|
| [40968393929](https://github.com/IDSAD-XL/worfy/actions/runs/40968393929) | 1 | 1340 | 21,2 | зелёный | 2: `arrange-by-epic.spec.ts:138`, `epic-frame.spec.ts:1104` | 0 |
| [40971289237](https://github.com/IDSAD-XL/worfy/actions/runs/40971289237) | 2 | 433 + 807 | 6,1 + 12,4 | **красный** | 3: `autopilot.spec.ts:244`, `arrange-by-epic.spec.ts:138`, `browser-focus.spec.ts:295` | 1: `epic-frame.spec.ts:1104` (обе попытки) |
| [40973032360](https://github.com/IDSAD-XL/worfy/actions/runs/40973032360) | 2 | 619 + 866 | 9,2 + 13,1 | зелёный | 2: `autopilot.spec.ts:244`, `chat-attachments.spec.ts:148` | 0 |

**Один worker (как сейчас), три последних push в `main` с полным e2e:**

| Run | Shard-ы | Длина shard-ов, s | Playwright, min | Итог | Flaky | Упали |
|---|---|---|---|---|---|---|
| [40964027732](https://github.com/IDSAD-XL/worfy/actions/runs/40964027732) | 2 | 1110 + 1100 | 17,2 + 17,0 | зелёный | 0 | 0 |
| [40953344871](https://github.com/IDSAD-XL/worfy/actions/runs/40953344871) | 2 | 975 + 979 | 15,1 + 15,2 | зелёный | 0 | 0 |
| [40938293043](https://github.com/IDSAD-XL/worfy/actions/runs/40938293043) | 2 | 1012 + 1112 | 17,3 + 15,9 | зелёный | 0 | 0 |

Первый run шёл одним shard-ом, чтобы сразу проверить главный вариант пункта 2: 1340 s, больше 20 min на job, и два
новых flaky. Второй и третий — двумя shard-ами в два worker-а.

**Решение по пункту 2: один worker остаётся**, два shard-а `macos-e2e` тоже (`E2E_SHARDS` в `scripts/ci-scope.mjs`
не меняется). Два worker-а ускоряют shard примерно вдвое, но три run-а дали 7 flaky и один красный run против нуля
в одном worker-е. Причины:

- **Первый test второго worker-а.** Во всех трёх run-ах test № 2 списка (первый test второго worker-а) хоть раз
  падал с `electron.launch: Process failed to launch!`: два первых старта Electron одновременно на свежем runner-е.
  Retry проходит. Лечить — в `launchApp` (`test/e2e/helpers.ts`, вне следа этого Ticket-а): разнести первые старты
  worker-ов или повторить запуск, который не стартовал.
- **`epic-frame.spec.ts:1104`** (Auction-sized Project интерактивен за 3 s, на GitHub Actions — 6 × время
  проекта из одного Ticket-а, не больше 7300 ms) — в двух worker-ах не уложился в 7,3 s в обеих попытках run-а
  40971289237 и с retry в 40968393929. Это замер скорости, и соседний Electron на 3 CPU его ломает.
- `browser-focus.spec.ts:295`, `chat-attachments.spec.ts:148` — по одному разу.

`playwright.config.ts` — замер runner-а в комментарии над `E2E_WORKERS`; значение прежнее (3 на Mac владельца
вне CI, 1 везде ещё). Contract test в `test/contract/ci-workflow.test.ts` закрепляет два shard-а и один worker в
CI.

**Следующий шаг**, если медиана после этого Ticket-а останется больше 15 min: Ticket на старт worker-ов
(первый старт Electron в `launchApp` — повтор при `Process failed to launch!`) и на `epic-frame.spec.ts:1104` в
нескольких worker-ах (предел, который не зависит от соседнего Electron-а). После этого повторить замер в два worker-а двумя shard-ами: 433–866 s на shard против
975–1112 s.

Медиана времени по стене следующих 10 PR с кодом — после merge (пункт 4), не в этом PR.
