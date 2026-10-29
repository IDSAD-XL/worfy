# 46 — Медленные test-файлы Windows shard 1/3: harness-migrate и install-stable

Type: task
Status: done 2026-10-29T02:22Z
PR: #943
Branch: worfy-throughput/46
Blocked by: 35
Source: договорённость моста и Orchestrator-а 2026-10-29: главный приоритет владельца — скорость CI; после #927 PR,
который меняет только unit-код или Harness, не запускает macOS-job-ов, и самым долгим становится Windows full-suite.

## Что происходит

Windows full-suite идёт тремя shard-ами, 1/3 и 3/3 — примерно по 480–490 s, дольше всех остальных job-ов PR. В shard-е
1/3 (run main 40788089367) два тяжёлых файла:

- `test/contract/harness-migrate.test.ts` — около 220 s на Windows и 14 s на Linux, 48 case-ов. Вся цена в
  `makeSandbox` (`test/contract/harness-migrate-harness.ts`): копия fixture и plugin-а, четыре git-репозитория
  (`init`, `add`, `commit` — 12 запусков git) на каждый case. Готовый sandbox не скопировать как есть: fixture пишет
  путь sandbox-а в файлы, которые коммитит.
- `test/unit/install-stable.test.ts` — 88 s на Windows и 8 s на macOS. Отказы script-а проверяются запуском CLI
  отдельным процессом (`run()`, `install-stable-harness.ts`), хотя функция `installStable` уже проверяется в процессе.

## Что делаем

1. Замер «до» на ПК: время каждого файла, 3 прогона, медиана.
2. `harness-migrate`: sandbox собирается один раз на файл, по его постоянному пути; каждый case получает свежую копию
   нетронутого образца по тому же пути. Пути в закоммиченных файлах верны, git на case не запускается. Изменяемый
   sandbox между case-ами не делится: каждый case пишет в свою копию.
3. `install-stable`: отказы, которые не зависят от CLI, проверяются через `installStable` в процессе. Хотя бы один test
   проходит настоящий путь CLI от начала до конца.
4. Замер «после» тем же способом; число проверок до и после.

Нужен ПК: да, для замеров. Трогает Harness: нет. Вердикт Windows: по `scripts/windows-verdict-scope.mjs`.

## Готово, когда

- [x] Замер «до» и «после» в «Итог»: медиана из 3 прогонов на ПК для каждого файла.
- [x] Число проверок до и после совпадает, или каждое расхождение объяснено.
- [x] Для каждого файла mutant, который ломает переведённую проверку, красный.
- [x] Test-ы модуля зелёные: оба файла, `harness-migrate-boundaries.test.ts`, все файлы, которые импортируют
  `harness-migrate-harness.ts` или `install-stable-harness.ts`; `pnpm lint`, `pnpm typecheck`.
- [ ] PR открыт, время shard-а 1/3 на runner-е до и после — в «Итог».

## Где в коде

- `test/contract/harness-migrate-harness.ts` — `makeSandbox`, `useSandbox`.
- `test/claude-home-legacy.ts` — `copyLegacyFixture`, подстановка `__SANDBOX__`.
- `test/unit/install-stable.test.ts`, `test/unit/install-stable-harness.ts` — `run()`, `installStable`, `inProcess`.
- `scripts/install-stable.mjs` — только чтение.

## Вне скоупа

- Код `src/` и `scripts/install-stable.mjs`.
- Timeout-ы и пороги test-ов: не меняются.
- Shard 3/3 и деление test-ов по shard-ам.

## Итог

Замер на ПК (Windows 11), `node scripts/vitest-electron.mjs <файл>`. Каждый файл прогнан отдельно, по 3 раза,
полное время процесса:

| Файл | До, s | После, s | Медиана до → после |
|---|---|---|---|
| `test/contract/harness-migrate.test.ts` | 225.8 / 205.5 / 204.9 | 131.8 / 132.8 / 148.8 | 205.5 → 132.8 (−35 %) |
| `test/unit/install-stable.test.ts` | 103.0 / 103.3 / 103.0 | 57.9 / 57.4 / 55.3 | 103.0 → 57.4 (−44 %) |

Третий прогон harness-migrate «после» шёл одновременно с проверкой #940 на том же ПК (`pnpm install` и
vitest), поэтому он медленнее; на медиану это не влияет.

После замера в сборку sandbox-а внесена одна правка: копия и удаление вместо переименования (это находка review,
о ней ниже). Это около 0.5 s один раз на файл, замер её не включает.

Число проверок не изменилось. harness-migrate: 48 passed до и после. install-stable: 31 passed и 4 skipped до и
после; skipped — test-ы macOS.

Что сделано:

- `harness-migrate-harness.ts`. Первый `makeSandbox` файла собирает sandbox по постоянному пути: копия fixture,
  четыре git-репозитория, копия plugin-а. Затем он копирует sandbox рядом, в `<путь>-built`, и удаляет оригинал.
  Каждый test получает свежую копию образца по тому же пути. Пути в закоммиченных файлах fixture верны, git на
  test не запускается. Заглушка `claude` пишется на каждый test: off Windows это ссылка, а `cpSync` сделал бы её
  абсолютной, ведущей в `-built`. Если папка прошлого test-а ещё на месте, `makeSandbox` бросает ошибку: так
  изменяемый sandbox не делится между test-ами. `afterAll` удаляет образец.
  - Профиль до правки: `makeSandbox` занимал около 1.8 s на test, из них 12 запусков git — около 1.7 s. Копия
    готового образца (378 файлов) — около 0.33 s.
- `install-stable.test.ts`. Каждый запуск CLI на Windows перечисляет процессы через PowerShell
  `Get-CimInstance Win32_Process`, это около 1.5 s. Сами отказы дешёвые, время уходит на установки, которые
  test-ы делают для подготовки.
  - Отказы «больше одного аргумента» и «сборка — не папка» проверяются через `installStable` в процессе.
  - Подготовительные установки идут через `installStable` с пустым списком процессов (`listing: () => ''`).
    Копию эти test-ы запускают только после установки. Все проверки «копия запущена» по-прежнему идут через CLI
    с настоящим списком.
  - Через CLI остались: полная установка от начала до конца (код 0, метаданные, вывод), отказ на Linux, отказ без
    Electron (проверка внутри сборки, которую запускает script, а заглушку pnpm из PATH берёт только отдельный
    процесс), повторная установка, сбои сборки, отказы `checkTarget` и отказы при запущенной копии.

Mutant-ы, оба красные, после проверки возвращены:

- install-stable: `argv.length > 1` → `> 2` в `scripts/install-stable.mjs`: EXIT=1, «expected [Function] to
  throw».
- harness-migrate: sandbox общий между test-ами (`makeSandbox` отдаёт уже существующую папку, `afterEach` её не
  удаляет): EXIT=1, 31 failed.

Проверки на итоговом коде, все с EXIT=0:

- `node scripts/vitest-electron.mjs` по пяти файлам: `harness-migrate.test.ts`, `harness-migrate-boundaries.test.ts`,
  `install-stable.test.ts`, `install-stable-functions.test.ts`, `no-rmsync.test.ts`. Результат: 171 passed,
  4 skipped. Других файлов, которые импортируют `harness-migrate-harness.ts` или `install-stable-harness.ts`, нет.
- `pnpm lint`.
- `pnpm typecheck`.

Review (correctness): блокирующих находок нет. Одна низкая: `renameSync` без повторов на Windows мог упасть на
файлах, которые ещё держит антивирус. Исправлено так: копия и `removeTestTree`, который повторяет удаление при
EBUSY и EPERM.

Shard 1/3 на runner-е: до — около 480–490 s (run `main` 40788089367); в CI run-е PR-а (head `330e3f22`) — 395 s.
Shard 3/3 того же run-а — 744 s: там guard-silent и heartbeat, их срезает Ticket 47.

На Mac `harness-migrate.test.ts` — 29,1 → 19,4 s.

Поправки к тексту выше, найдены на review моста (все низкие, код не меняют):

- Объяснение, почему заглушка `claude` пишется на каждый test, неверно: ссылка и так абсолютная, она ведёт на общий
  `SHELL_STUB` (`test/shell-stub.ts:27`). Запись на каждый test безвредна.
- Test macOS «Launch Services отказал в регистрации» (`test/unit/install-stable.test.ts:162`) тоже переехал в процесс
  (`installStable`), в списке выше его нет.
- `test/unit/install-stable-harness.ts` не менялся.
- Число `expect` в двух файлах — 241 → 227: убраны повторы, смысл тот же. Префикс и exit code отказов
  по-прежнему проверяют CLI-test-ы `install-stable.test.ts:120-121` и `:632-634`.
- Если `removeTestTree` в `afterEach` упадёт (`harness-migrate-harness.ts:119`), каждый следующий test файла упадёт с
  «папка прошлого test-а ещё на месте»: первая ошибка — настоящая, остальные — её следствие.
