# 51 — `harness-evals.test.ts` в двух файлах и общие fixture-ы кейсов: короче долгий shard Windows

Type: task
Status: claimed 2026-10-29T04:55Z
Branch: worfy-throughput/51
Blocked by: 35
Source: разбор моста 2026-10-29 после #948 (Ticket 49): самый долгий job Windows — `windows (1/3) / full-suite`,
386–402 s; внутри него `test/contract/harness-evals.test.ts` идёт 257–261 s.

## Что происходит

После #948 (`37cb4172`) `harness-scripts.test.ts` идёт в своих двух job-ах, и самым долгим job-ом Windows стал
`windows (1/3) / full-suite`: 386–402 s (run-ы 40811277830, job 123241978554, и 40813892212, job 123250383910).
Внутри него `test/contract/harness-evals.test.ts` — 257–261 s на Windows (193 test-а, все подряд), против 31–41 s на
Linux и 55–77 s на macOS.

Профиль файла на `origin/main` `37cb4172`, только чтение:

- **Сборка fixture-ов.** `scaffold()` (`:133-152`) запускает bash → `harness/evals/lib/demo-project.sh`: node и около
  десяти команд git. Вызовов около 33. Семь из них повторяют сборку test-а кейса (`:213`) с теми же аргументами:
  `:362`, `:556`, `:581`, `:594`, `:607`, `:630`, `:673`.
- **Test-ы `eval:harness` со stub-ом claude** (`:804-814`, `:1554-1567`): каждый run копирует `harness/` и git-core
  (`scripts/eval-run-env.mjs:124-137`, `:226-303`), около 2 s на Windows.
- **Последовательно по устройству:** везде `spawnSync`; уборка через флаг `inTest` и `testTemps.splice(0)`
  (`:72-90`); одна общая копия `harness/` (`:743-757`); один общий git-репозиторий для test-ов `--changed`
  (`:1485-1515`).
- Test, который сканирует spawn-ы файла (`:906-935`), читает только свой файл (`:907`).

Ticket 15 (#935) уже свёл три test-а scaffold-а каждого кейса в один (около `:208-213`): минус 20 сборок, Windows
361 → 294 s. Этот test остаётся как есть.

## Что делаем

1. **Два файла по естественному шву:** test-ы кейсов и fixture-ов (около `:92-937`) и test-ы `eval:harness` и карты
   правил (около `:938-2081`). Общие помощники — в модуль под `test/contract/`. Все test-ы и все проверки на месте.
   Test сканирования spawn-ов читает оба файла и модуль.
2. **Одна сборка fixture-а на кейс** на файл, общая для test-ов, которые его только читают, — как #943 (Ticket 46)
   для harness-migrate (`test/contract/harness-migrate-harness.ts`). Test, который пишет в fixture (gate fast на
   `:566` и `:596` пишет в папку состояния fixture-а), получает свою копию. Объединённый test Ticket-а 15 остаётся
   одним test-ом на кейс; общая сборка строится на нём.
3. **Shard каждого нового файла** на Windows — тем же списком файлов, что у CI (с `WORFY_TEST_EXCLUDE`). Если обе
   половины в одном shard-е — сказать; имена ради hash-а не менять без слова Orchestrator-а.
4. **Два долга ревью #948 (low):**
   a. Contract test «каждый файл ровно в одном Windows job-е» (`test/contract/ci-workflow.test.ts:356`) строит модель
      из скопированных шаблонов include и сам выкидывает `harness-scripts.test.ts` (`:315`): mutant без
      `...ciExclude` в `vitest.config.ts:16-17` остаётся зелёным. Модель — из настоящего `vitest list --filesOnly` с
      `WORFY_TEST_EXCLUDE`, как его ставят shard-ы; mutant краснеет; test укладывается в 30 s.
   b. Устаревший комментарий `scripts/windows-verdict-scope.mjs:12-13`: назвать и два job-а `harness-scripts`.

Нужен ПК: нет. Трогает Harness: только строку `harness/README.md` с именем test-файла.

## Готово, когда

- [x] Два test-файла и модуль; число test-ов и проверок то же (193: 189 passed, 4 skipped на Mac до и после).
- [x] Повторные сборки с теми же аргументами заменены общим fixture-ом кейса; test, который пишет в fixture, —
      своя копия; mutant «общий fixture без копии» красный.
- [x] Test сканирования spawn-ов читает оба файла и модуль.
- [x] Shard каждого файла на Windows назван в «Итог».
- [x] Mutant без `...ciExclude` краснит contract test; test в пределах 30 s.
- [x] Комментарий `windows-verdict-scope.mjs` называет все пять Windows job-ов.
- [x] Время на Mac до и после для каждого затронутого файла; `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.
- [ ] Время каждого Windows job-а CI run-а PR-а — в «Итог», со скоростью runner-а.

## Где в коде

- `test/contract/harness-evals.test.ts` — остаются test-ы кейсов и fixture-ов, общий fixture кейса.
- `test/contract/harness-evals-run.test.ts` — новый: `eval:harness`, `--changed`, карта правил.
- `test/contract/harness-evals-shared.ts` — новый модуль: кейсы, временные папки, `childEnv`, stub claude.
- `test/unit/stale-leftovers.test.ts`, `test/stale-leftovers.ts` — где теперь `tempDir('worfy-eval-stub-')`.
- `test/fixtures/eval-stub/claude.cjs`, `scripts/eval-harness-coverage.mjs`, `harness/README.md` — комментарии с
  именем test-файла.
- `test/contract/ci-workflow.test.ts` — только блок «exactly one Windows job» (`windowsJobs`).
- `scripts/windows-verdict-scope.mjs` — комментарий `:12-13`.
- `.scratch/worfy-throughput/spec.md` — строка Ticket-а 51.

## Вне скоупа

- `scripts/ci-scope.mjs` и job `changes` (их правит impl-13); helper `shards()` в `ci-workflow.test.ts`.
- Копия `harness/` и git-core в каждом run-е `eval:harness` (`scripts/eval-run-env.mjs`): код скрипта, не test-ов.
- Параллельные test-ы внутри файла: общие копия `harness/` и git-репозиторий `--changed` держат их последовательными.

## Итог
