# 54 — Очередь macOS: не больше двух macOS-job-ов на обычный PR

Type: task
Status: open
Blocked by: 11 (Ticket [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md) правит те же файлы —
`.github/workflows/ci.yml` и `scripts/ci-scope.mjs`)
Source: замер 2026-10-29 около 09:30 UTC по 13 последним завершённым run-ам `ci.yml`; планка владельца Q4
([spec.md](../spec.md), раздел «Ответы владельца 2026-10-29»): время по стене от push до `ci-ok`, очередь
включена.

## Что происходит

Замер 2026-10-29 около 09:30 UTC: 13 последних завершённых run-ов `ci.yml`, по `created_at`, `started_at` и
`completed_at` каждого job-а. Ожидание в очереди macOS — `started_at − created_at`, максимум по macOS-job-ам run-а.

- **Run-ы PR, n=11.** Медиана времени по стене — 31 min. Медиана ожидания в очереди macOS — 20 min; медиана
  времени по стене без этого ожидания — 11 min. Job-ы не на macOS ждут 0–1 min.
- **Push в `main`, n=2.** Run 40833295816 — 69 min, из них 53 min в очереди macOS; run 40830673743 — 80 min, из
  них 64 min. Без очереди — 15 min.
- **Причина** — лимит бесплатного плана: 5 macOS-job-ов одновременно на весь account. Его делят все открытые PR и
  `main` (`.github/workflows/ci.yml:38-42`).
- **Правило 8 владельца (2026-10-28):** если медиана ожидания macOS больше 10 min, shard-ы unit-test-ов macOS
  сливаются в один job (`docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md:108-110`). Это уже сделано:
  `macos-tests` — один job (`ci.yml:15`, `:182-185`). Ожидание всё равно 20 min.
- После #953 PR гоняет только те e2e spec-файлы, которые даёт таблица путей (`scripts/e2e-specs.table.json`).
  Второй shard `macos-e2e` поэтому в основном ждёт в очереди ради небольшой работы.
- **macOS-job-ы PR сегодня:** `macos-tests` + `macos-e2e (1/2)` + `macos-e2e (2/2)` = 3, плюс `macos-package`,
  если PR меняет build input. Где это в `ci.yml` на `origin/main` `62f31cd9`:
  - `ci.yml:39-40` — «a pull request asks for at most 3 of them (one macos-tests and two macos-e2e shards) when it
    changes the app»;
  - `ci.yml:182-185` — job `macos-tests`, `runs-on: macos-latest`;
  - `ci.yml:207-217` — job `macos-e2e`, matrix `shard: ${{ fromJSON(needs.changes.outputs.macos-e2e-shards) }}`
    (`:217`);
  - `ci.yml:260-263` — job `macos-package`, `if: fromJSON(needs.changes.outputs.expect)['macos-package']`.
- **Откуда число shard-ов.** Matrix `macos-e2e` строит `scripts/ci-scope.mjs`: `E2E_SHARDS = { 'macos-e2e': 2, … }`
  (`:149`); `e2eShards` (`:220-230`) даёт PR меньше shard-ов, когда его spec-файлы занимают меньше половины времени
  всех (`test/e2e/timings.json`, всего 1686 s). PR, чей путь приложения таблица не сужает, получает весь набор в
  двух shard-ах (`FULL_E2E`, `:353`).
- `macos-package` на PR без build input уже не идёт (`scripts/ci-scope.mjs:318-320`); это проверяет contract test
  `test/contract/ci-workflow.test.ts:567-573`.

## Что делаем

a. **На `pull_request` `macos-e2e` — один job**, который гоняет все spec-файлы PR из таблицы путей. На push в `main`
   — по-прежнему 2 shard-а. Правка — в `scripts/ci-scope.mjs` (matrix `macos-e2e-shards` для PR — `["1/1"]`);
   в `ci.yml` меняются только комментарии `:18-22`, `:39-42`, `:212-213`. Если PR гоняет весь набор (путь
   приложения вне таблицы), один shard — около 1686 s по `timings.json` при `timeout-minutes: 45` (`ci.yml:211`):
   записать в «Итог» настоящее время такого run-а.
b. **`macos-package` на обычном PR (без build input) пропущен** — подтвердить contract test-ом в
   `test/contract/ci-workflow.test.ts`, который читает `ci.yml` и `scripts/ci-scope.mjs`: обычный PR просит не
   больше двух macOS-job-ов — `macos-tests` и один `macos-e2e`.

Итог: не больше 2 macOS-job-ов на обычный PR против 3 сегодня. Ожидаемый эффект — очередь macOS короче примерно на
треть. Замер после merge — тем же методом, по 10 PR с кодом.

Нужен ПК: нет. Трогает Harness: нет.

## Готово, когда

- [ ] Сначала красный contract test: matrix `macos-e2e` на PR — 1 shard, на push — 2.
- [ ] Contract test: `macos-package` пропущен на обычном PR (без build input); обычный PR просит не больше двух
      macOS-job-ов.
- [ ] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] Замер после 10 PR с кодом (тем же методом: медиана времени по стене, медиана ожидания macOS, время без
      ожидания) — в «Итог».
- [ ] Вердикт Windows: runner (`scripts/windows-verdict-scope.mjs`). `windows-tests.yml` этот Ticket не меняет; если
      изменит — сказать об этом в PR и в «Итог».

## Где в коде

- `.github/workflows/ci.yml` — job `macos-e2e` и его matrix (`:207-217`), комментарии `:18-22`, `:39-42`.
- `scripts/ci-scope.mjs` — `E2E_SHARDS` (`:149`), `e2eShards` (`:220-230`), `FULL_E2E` (`:353`), shard-ы PR
  (`:375`).
- `test/contract/ci-workflow.test.ts` — test-ы scope PR (`:567-573` и рядом); test-ы `e2eShards` — в
  `test/contract/ci-scope-e2e.test.ts:127-139`.

## Вне скоупа

- c. `macos-tests` на PR — только когда меняются пути, специфичные для macOS. Это вопрос владельцу; здесь не
  делается.
- Ускорение job-ов Windows и Linux: они не ждут в очереди.

## Итог
