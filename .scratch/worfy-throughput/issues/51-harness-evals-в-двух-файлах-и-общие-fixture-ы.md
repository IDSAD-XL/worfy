# 51 — `harness-evals.test.ts` в двух файлах и общие fixture-ы кейсов: короче долгий shard Windows

Type: task
Status: done 2026-10-29T08:18Z
PR: #957
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
- [x] Время каждого Windows job-а CI run-а PR-а — в «Итог», со скоростью runner-а.

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

PR #957. CI run PR-а 40821804650 на head `c3259e7e` (после rebase на `80149146`, #955): `ci-ok` — success.

### Что изменилось

- `test/contract/harness-evals.test.ts` — test-ы кейсов и fixture-ов (91 test). `harness-evals-run.test.ts` —
  `eval:harness` со stub-ом claude, `--changed`, карта правил (102 test-а). `harness-evals-shared.ts` — кейсы,
  временные папки (hook-и регистрируются при import-е), `childEnv`, stub claude и его копия `harness/`.
  Объявлений test-ов 99 до и после; вызовов `expect(` 460 до, 462 после (два новых — в test-е сканирования).
  На Mac 193 test-а: 189 passed, 4 skipped до и после.
- Объединённый test Ticket-а 15 (#935) — одна сборка и три проверки на кейс — остался одним test-ом на кейс. Общая
  сборка — его же: `caseFixture(name)` строит fixture кейса один раз на файл, ленивым кэшем, при первом test-е, а не
  в `beforeAll`. Отступление от брифа: лимит hook-а 10 s (30 s на Windows) меньше лимита test-а 15 s (45 s), а сборка
  на Windows — до 5 s под нагрузкой; harness-migrate (#943) строит так же. Упавшая сборка строится заново для
  следующего test-а (retry CI).
- Семь повторных сборок (`:362`, `:556`, `:581`, `:594`, `:607`, `:630`, `:673` на `37cb4172`) берут общий fixture.
  Два test-а gate fast пишут в папку состояния fixture-а (`.git/worfy-harness/gate/state`): они берут
  `caseFixtureToChange` — работают в fixture-е по тому же пути (registry fixture-а называет свой путь), после test-а
  fixture восстанавливается из копии сборки. `afterEach` сравнивает содержимое каждого общего fixture-а со сборкой
  (hash путей и содержимого файлов) и роняет test, который его изменил. Остальные пять test-ов fixture не меняют.
- Test сканирования spawn-ов читает оба файла и модуль; `childEnv` ищется как определение в начале строки.
- `ci-workflow.test.ts`, блок «exactly one Windows job»: список файлов — настоящий `vitest list --filesOnly` с
  `WORFY_TEST_EXCLUDE`, как его ставит shard-job (пусто — без переменной), и `vitest list --filesOnly
  test/contract/harness-scripts.test.ts` для job-ов `harness-scripts`. Три списка, каждый один раз на файл, около
  0,5 s на Mac. `vitest list` в vitest 5.0.3 принимает `--shard`, но не режет по нему (`getRelevantTestSpecifications`
  без sequencer-а): shard режет `BaseSequencer` vitest-а, как и раньше. Helper `shards()`, `ci-scope.mjs` и job
  `changes` не тронуты.
- `scripts/windows-verdict-scope.mjs:12-15` — комментарий называет все пять Windows job-ов.

### Mutant-ы

Каждый восстановлен из копии, `cmp` — 0.

- `caseFixtureToChange('status-block')` → `caseFixture`: exit 1, 1 failed / 90 passed — «the test changed the shared
  fixture of status-block».
- `caseFixtureToChange('reviewer-verdict')` → `caseFixture`: exit 1, 1 failed / 90 passed — то же для
  reviewer-verdict.
- Без восстановления после `caseFixtureToChange`: exit 1, красный следующий test того же fixture-а (registry).
- `vitest.config.ts` без `...ciExclude`: exit 1, 3 failed / 141 passed в `ci-workflow.test.ts` («in two Windows jobs
  or more: … (55)», harness-scripts в shard-е `3/3`). Тот же mutant со старым `ci-workflow.test.ts` с `origin/main`:
  exit 0, 144 passed — был зелёным.

### Shard-ы на Windows

Метод: `vitest list --filesOnly` с `WORFY_TEST_EXCLUDE=test/contract/harness-scripts.test.ts` (467 файлов), затем
`BaseSequencer.shard` vitest-а на 3 части — как режет `pnpm test --shard`. Обе половины — в `1/3`, рядом с
`harness-migrate.test.ts` и `install-stable.test.ts`. Имена не менялись (решение Orchestrator-а: внутри shard-а файлы
идут параллельно по worker-ам; перенос в `2/3` или `3/3` добавил бы туда около 140 s; место по hash-у сдвигается с
каждым новым файлом). Лог CI подтверждает: оба файла — в job-е `windows (1/3)`.

Число worker-ов vitest лог не печатает. По умолчанию vitest 5.0.3 берёт `availableParallelism() − 1`
(`node_modules/vitest/dist/chunks/doctor.CpHPRoza.js:121`); на runner-е с 4 CPU это 3, но число CPU runner-а в логе
тоже не напечатано — не проверено.

### Время

Mac, временный HOME, `node scripts/vitest-electron.mjs <файлы>`, время файла из `test-results/vitest-timings.json`:

| Файл | До (`37cb4172`) | После |
| --- | --- | --- |
| `harness-evals.test.ts` (весь) | 62,5 s | — |
| `harness-evals.test.ts` (fixture-ы) | — | 13,1 s |
| `harness-evals-run.test.ts` | — | 47,6 s (оба файла вместе — 47,7 s по стене) |
| `harness-evals-outcome.test.ts` | 27,4 s | 26,5 s |
| `ci-workflow.test.ts` | 16,8 s | 14,4–17,9 s |
| `windows-tests-workflow.test.ts` | 2,9 s | 3,0 s |
| `test/unit/stale-leftovers.test.ts` | 0,05 s | 0,04 s |

Windows, CI run PR-а 40821804650 (до — run-ы 40811277830 и 40813892212 на `main`):

| Job | Время job-а | vitest Duration | Lockfile check | Runner |
| --- | --- | --- | --- | --- |
| `windows (1/3) / full-suite` | 373 s (до: 386–402 s) | 311,7 s | 6,1 s | между быстрым и медленным, ближе к медленному |
| `windows (2/3) / full-suite` | 213 s | 164,0 s | 3,7 s | быстрый |
| `windows (3/3) / full-suite` | 316 s | 246,6 s | 7,7 s | медленный |
| `windows (harness-scripts 1/2) / full-suite` | 311 s | 247,3 s | 6,2 s | ближе к медленному |
| `windows (harness-scripts 2/2) / full-suite` | 325 s | 261,7 s | 5,9 s | между |

В `windows (1/3)`: `harness-evals-run.test.ts` — 155,2 s, `harness-evals.test.ts` — 92,6 s (вместе 247,8 s против
257–261 s одного файла). Самый долгий файл shard-а теперь — 155 s, следом `harness-migrate.test.ts` — 132 s. Job
`1/3` всё ещё самый долгий у Windows, но на 13–29 s короче, на runner-е не быстрее базовых. Эффект считать по
нескольким run-ам `main` одной скорости.

Правка `harness/README.md` (имя test-файла) запускает job-ы e2e (`macos-e2e`, `windows-e2e`): `harness/` входит в
приложение (`isBundledHarness`).

### Проверки

- Оба файла harness-evals, `harness-evals-outcome`, `ci-workflow`, `windows-tests-workflow`, `windows-verdict-scope`,
  `test/unit/stale-leftovers` под временным HOME — exit 0.
- `pnpm lint`, `pnpm typecheck`, gate fast (`[gate] green (fast)`) — exit 0, до и после rebase на `80149146`. Gate
  предупреждает: `harness-evals-run.test.ts` — 1246 строк (больше 1000).
- `node scripts/windows-verdict-scope.mjs 80149146 HEAD` — `runner`, exit 0.

### Ревью на Mac и merge

PR #957 влит, merge-commit `f52dc8bb`. Ревью на Mac — три low, ни одна не блокирует merge. Каждая переходит в
следующий PR, который тронет её файл:

- `test/contract/harness-evals.test.ts:165-173` (`putBack`): fixture восстанавливается копией, поэтому у файлов
  новые время и inode. Если позже read-only test запустит в таком fixture-е `git status`, git перепишет
  `.git/index`, и `afterEach` покажет ложный красный: содержимое fixture-а не совпадёт со сборкой. Сейчас такого
  test-а нет, ошибка скрытая; mutant это доказал.
- `test/contract/harness-evals.test.ts:113-122` (`contentOf`): hash не учитывает режим файла и цель symlink-а.
- `scripts/ci-scope.mjs:239` (на `f52dc8bb` — `:132`): комментарий называет один файл `harness-evals.test.ts`, а их
  теперь два. Пункт идёт в бриф Orchestrator-а для Ticket-а 11.

**Расхождение при merge.** #957 и #954 (Ticket 21, affected-tests) влиты порознь, и вместе оставили устаревшим
`scripts/affected-tests.table.json`: его строки описывали `harness-evals.test.ts` до разделения, без
`harness-evals-run.test.ts`. `main` на `f52dc8bb` красный —
`test/unit/affected-tests.test.ts:452` («holds what the generator builds from the test sources today»). Исправлено
вперёд в течение часа: #968 (`8664b8da`) заново собрал таблицу. Причину убирает Ticket 11: генерируемые строки
таблицы строятся во время run-а, а не хранятся в файле.
