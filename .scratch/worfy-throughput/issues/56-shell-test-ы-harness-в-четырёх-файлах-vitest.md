# 56 — Shell test-ы Harness в четырёх файлах vitest, а не в одном в конце run-а

Type: task
Status: done 2026-10-30T03:49Z
PR: #1039
Branch: worfy-throughput/56
Blocked by: —
Source: замер gate full на ПК 2026-10-29, bridge Session (ПК-сессия на Windows-ПК владельца): на `main` b2b30e07
`test/contract/harness-scripts.test.ts` занял 1367 s из 1542 s wall time vitest; первые ~10 min были заняты 15+
worker-ов, потом этот файл шёл один.

## Что происходит

- `test/contract/harness-scripts.test.ts` запускает все ~55 shell test-ов Harness (`harness/{bin,hooks}/tests/*.test.sh`)
  одним файлом, по пять сразу (`it.concurrent`, `maxConcurrency: 5` проекта contract, `vitest.config.ts:80`).
  vitest отдаёт один файл одному worker-у, поэтому в локальном `pnpm test` (gate fast и gate full) этот файл идёт
  последним и один, пока остальные worker-ы простаивают.
- Цифра 1367 s — из лога vitest на b2b30e07: vitest печатает время файла, только когда файл упал (там он упал на
  `:433`). На 0be09773 файл прошёл, и его хвост виден только по счётчику процессов `electron.exe` на ПК: около
  13 min с 2 процессами, выборка раз в 20 s. Доказательства замера ПК хранит ПК-сессия.
- CI уже делит этот файл на Windows: job-ы `windows (harness-scripts 1/2)` и `(2/2)` с `HARNESS_SCRIPTS_PART`
  (`.github/workflows/windows-tests.yml`, `test/harness-shell-tests.ts`). Локальный run гоняет файл целиком.

## Что делаем

1. Тело файла — в общий модуль `test/harness-scripts-suite.ts` (`harnessScripts(n)`); test-файлы
   `test/contract/harness-scripts-1.test.ts` … `-4.test.ts` вызывают его со своим номером. vitest сам раскладывает
   четыре файла по разным worker-ам; новой настройки параллельности нет.
2. Shell test-ы делятся между файлами по измеренному времени, не по числу (`inFile` в `test/harness-shell-tests.ts`:
   самый длинный — в файл с наименьшей суммой). Таблица секунд `MEASURED_SECONDS`: `windows` — Windows runner, CI
   run 40927995527; `other` (macOS и Linux) — Mac владельца, `pnpm test --maxWorkers=9`. Порядок старта внутри
   файла — по той же таблице, самый длинный первым (`startOrder`, заменяет ручной список `RUN_FIRST`).
3. CI: `HARNESS_SCRIPTS_PART` работает как раньше. В job-е части файл 1 запускает всю часть, файлы 2–4 — ничего:
   часть уже и есть деление этого job-а, а второе деление по файлам запустило бы по пять shell test-ов на файл
   на 4-CPU runner-е. Шаг `windows-tests.yml` получает список из четырёх файлов: shard-ы vitest их исключают,
   job-ы `harness-scripts <i>/<n>` запускают все четыре, когда в списке PR есть хотя бы один.
4. `scripts/affected-tests.table.json`: путь `harness/**` выбирает модуль `test/harness-scripts-suite.ts`, а через
   него — все четыре файла. `scripts/windows-test-list.mjs` отказывает каждому из четырёх файлов в ручном режиме
   `files`, как отказывал одному.

Нужен ПК: замер после merge. Платформенный: да — меняет шаг Windows CI shard-ов и job-ов `harness-scripts <i>/<n>`
и то, как Windows-run делит shell test-ы. Трогает Harness: да, только текст — `harness/README.md` и комментарии
`harness/bin/tests/wave-gate.test.sh` и `harness/hooks/tests/gate-verdict-world.sh` называли удалённый файл; поведение
скриптов Harness не меняется. Вердикт Windows — по
`node scripts/windows-verdict-scope.mjs`.

## Готово, когда

- [x] Каждый shell test запускается ровно один раз за полный локальный run: список выполненных shell test-ов до и
      после совпадает (55 из 55, `diff` пустой).
- [x] CI: `ci-workflow.test.ts` и `windows-tests-workflow.test.ts` проверяют новый шаг, каждый shell test ровно в
      одном Windows job-е; `affected-tests` выбирает все четыре файла для пути `harness/`.
- [x] Деление — по измеренным секундам, не по числу.
- [x] Test-ы не удалены. Предел одного shell test-а (`FILE_TIMEOUT_MS`) этот тикет руками не поднимал, но после
      тикета 57 (общий множитель timeout-ов, #1026) он идёт через `ms()`: при множителе 3 по умолчанию на Linux и
      macOS — 360 s вместо 120 s, так задумано в тикете 57; на Windows — 900 s, как было.
- [x] Замер на Mac (`--maxWorkers=9`): wall time `pnpm test` и gate fast до и после, время файла или файлов — в «Итог».
- [x] Замер на ПК — после merge (80defef3, «Итог», последний раздел).
- [x] gate fast — `[gate] green` (exit 0, `pnpm lint && pnpm typecheck && pnpm test` — exit 0).

## Тесты

- `test/contract/harness-scripts-1.test.ts` (общий модуль `test/harness-scripts-suite.ts`): четыре файла вместе
  дают каждому shell test-у ровно один case — без части и с частями 1/2 и 2/2; файлы на диске совпадают с
  `HARNESS_SCRIPTS_FILES`; таблица секунд называет только существующие shell test-ы.
- `test/contract/ci-workflow.test.ts`: `startOrder`, `inFile` (деление по секундам, разница файлов не больше
  самого длинного shell test-а на обеих таблицах), `shareOf` (часть целиком у файла 1); модель Windows job-ов —
  каждый shell test ровно в одном job-е, список PR с одним из четырёх файлов.
- `test/contract/windows-tests-workflow.test.ts`: закреплённый шаг, PowerShell-case-ы шага (на машинах с `pwsh`),
  отказ ручного списка для каждого из четырёх файлов.
- `test/unit/affected-tests.test.ts`: строка `harness/**` ведёт к `test/harness-scripts-suite.ts`.

## Где в коде

- `test/harness-scripts-suite.ts` — бывшее тело `test/contract/harness-scripts.test.ts`, `harnessScripts(n)`
- `test/contract/harness-scripts-1.test.ts` … `test/contract/harness-scripts-4.test.ts`
- `test/harness-shell-tests.ts` — `HARNESS_SCRIPTS_FILES`, `MEASURED_SECONDS`, `startOrder`, `inFile`, `shareOf`
- `.github/workflows/windows-tests.yml` — шаг «Run the unit and contract suite, or a part of it»
- `.github/workflows/ci.yml` — комментарии о `harness-scripts`
- `test/contract/ci-workflow.test.ts`, `test/contract/windows-tests-workflow.test.ts`
- `scripts/windows-test-list.mjs` — `RUNS_ON_THE_PC`
- `scripts/affected-tests.table.json`, `test/unit/affected-tests.test.ts`
- `tsconfig.test.node.json`, `vitest.config.ts` — комментарий к `maxConcurrency`

## Вне скоупа

Нет.

## Итог

Почему деление файлов, а не `maxConcurrency`: shell test-ы не делят состояние — каждый идёт в своём пустом HOME
(`runInEmptyHome`), счётчик повторов `starts` и список живых процессов `liveRuns` — свои в каждом файле. Запасной
вариант (поднять `maxConcurrency` одному файлу) не понадобился.

Замер на Mac владельца, 18 ядер, `--maxWorkers=9` (`pnpm test --maxWorkers=9`, gate fast с `VITEST_MAX_WORKERS=9`),
время каждого файла — из JSON reporter-а vitest (`--reporter=json`) и `test-results/vitest-timings.json`. Load
average 9–15 во время всех run-ов: на Mac работали другие Session-ы. Каждый замер — дважды.

| Run | До (один файл) | После (четыре файла) |
| --- | --- | --- |
| `pnpm test`, run 1 | 238 s; файл 174 s (старт +60 s, конец +234 s; остальные файлы кончились на +147 s) | 143 s; файлы 39/41/47/55 s, последний кончился на +142 s |
| `pnpm test`, run 2 | 137 s; файл 135 s (старт 0, конец +136 s; остальные — +134 s) | 141 s; файлы 51/43/50/58 s, все кончились к +58 s |
| gate fast, run 1 | 168 s всего, test 137,3 s; файл 137 s | 156,7 s всего, test 141,0 s; файлы 52/44/50/57 s |
| gate fast, run 2 | 153,7 s всего, test 137,8 s; файл 137 s | 157,9 s всего, test 141,9 s; файлы 54/45/53/59 s |

- Run 1 `pnpm test` «до» — в свежем worktree без кэша порядка vitest: он поставил старый файл в очередь на +60 s,
  отсюда 238 s. С кэшем (run 2 и оба gate fast) старый файл стартует первым.
- На этом Mac с 9 worker-ами выигрыша по wall time нет: сумма времён всех файлов — 1070–1180 s, на 9 worker-ов это
  120–132 s, и run упирается в общий объём работы, а не в один файл. Shell test-ы теперь кончаются к +58 s, хвост
  run-а — другие файлы (`harness-evals-run.test.ts` 68 s, `e3-sandbox.test.ts` 62 s). Разница 137 → 141 s — в
  пределах шума загруженного Mac.
- Выигрыш ожидается там, где worker-ов больше, чем нужно общей работе: на ПК (15+ worker-ов, остальные файлы
  кончались за ~10 min, файл шёл ещё ~13 min). Замер на ПК — после merge.
- Список выполненных shell test-ов до и после совпадает в обоих run-ах: 55 из 55, все `passed`, `diff` пустой.
  Части CI: `HARNESS_SCRIPTS_PART=1/2` — 28, `2/2` — 27, вместе 55 без повторов; файлы 2–4 в части — 0 shell test-ов.
- Деление по таблице: Windows — 421/421/419/418 s на файл, Mac — 211/211/211/210 s (секунды при пяти сразу).

### Красный CI первого push-а (run 40939802575) и исправление

- Причина одна на все четыре красных job-а. Step `windows-tests.yml` передавал файлы как `pnpm test
  @(-split $env:HARNESS_SCRIPTS)`. Выражение-массив `@(…)` доходит до функции или скрипта PowerShell одним
  аргументом, в котором лежит массив. На runner-е `pnpm` — shim `pnpm.ps1` из corepack: он отдал node одну строку
  с четырьмя путями через пробел (`node scripts/vitest-electron.mjs "test/contract/harness-scripts-1.test.ts …
  -4.test.ts"`), фильтр vitest не совпал ни с одним файлом, и vitest вышел с кодом 1: «No test files found»
  (`windows (harness-scripts 1/2)` и `2/2`, ~1 min). Тот же step под stub-функцией `pnpm` в
  `windows-tests-workflow.test.ts` напечатал `test System.Object[]`, отсюда красные `linux-tests (3/4)` и
  `windows (3/3)` (PowerShell есть на обоих runner-ах).
- Исправление: `$files = -split $env:HARNESS_SCRIPTS; pnpm test @files` — splatting переменной даёт каждый путь
  отдельным аргументом. Stub в contract test-е печатает каждый аргумент в своих `<>`, так что склеенный аргумент
  виден. Mutation check: со старой строкой этот test красный на двух случаях части (`<… … … …>` вместо четырёх
  `<…>`); воспроизведено и на PowerShell 7.6.9 с shim-ом `.ps1`, который передаёт `$args` в node.
- Защита от job-а без shell test-ов. Фильтр без совпадений — уже красный: `--passWithNoTests` в этом step нет, и
  run 40939802575 сам это показал. Добавлено: case «runs its share» в файле 1 с частью (и в каждом файле без
  части) требует хотя бы один shell test. Mutation check: `inPart` возвращает `[]` → `expected 0 to be greater
  than 0`, exit 1.
- Нагрузка на Linux: shard-ы `linux-tests (1/4)` и `(2/4)` гоняли по два файла сразу. Время каждого shell test-а
  в run-е PR против двух run-ов `main` (40938293043, 40927995527, худшее из двух): самый долгий — 72,4 s против
  76,0 s на `main`, рост больше 1,3× только у `gate-args.test.sh` (1,7 → 2,4 s); большинство стали быстрее. Предел
  120 s не ближе, чем на `main`, конкурентность на CI не менялась.
- Устаревшие ссылки на удалённый `test/contract/harness-scripts.test.ts`: `harness/README.md`,
  `harness/bin/tests/wave-gate.test.sh`, `harness/hooks/tests/gate-verdict-world.sh`, `docs/lessons/README.md`.
  Скрипта, который читает это имя, нет (`git grep` по `harness/`, `scripts/`, `*.json`, `*.mjs`, `*.yml`).

### Второй run (40946353000) и исправление

- `windows (harness-scripts 1/2)` и `2/2` теперь гоняют четыре файла (4–5 min) и краснеют на одном case-е: проверка
  имён файлов ждала `\nharnessScripts(1)\n`, а runner Windows делает checkout с CRLF. Исправление: CRLF → LF перед
  сравнением; с файлом в CRLF case локально зелёный.
- `linux-tests (2/4)`: `beforeAll` в `test/unit/affected-tests.test.ts` (разбор всех test-файлов TypeScript-парсером,
  ~0,7 s CPU) не уложился в 10 s; файл шёл 58,6 s против 30–47 s в run-ах `main`. В этом shard-е вместе шли
  `harness-scripts-1` и `-2` — десять shell test-ов сразу на runner-е с 4 CPU; на `main` в shard-е был один файл,
  пять сразу. Этот же `beforeAll` уже в карантине на macOS как падающий под нагрузкой. Время самих shell test-ов
  не выросло, но нагрузка на соседей выросла, а `macos-tests` на push в `main` гонял бы все четыре файла в одном job-е.
- Первая попытка — `HARNESS_SCRIPTS_PART: 1/1` в `linux-tests` (файл 1 гоняет все shell test-ы по пять, как один
  файл на `main`) — не помогла: run 40949170000, `linux-tests (2/4)`, тот же `beforeAll` за 10 s, файл 74,5 s. Причина
  не в десяти сразу, а в соседстве: после переименования vitest кладёт `harness-scripts-1` в тот же shard 2/4, что и
  `affected-tests.test.ts` (на `main` файл shell test-ов шёл в shard 4/4), и пять shell test-ов рядом с ним хватает.
- Решение для `linux-tests`: shard исключает четыре файла (`WORFY_TEST_EXCLUDE`), а следующий step того же job-а
  гоняет их одни, часть `<shard>` (`HARNESS_SCRIPTS_PART=<i>/4`: файл 1 — четверть shell test-ов по пять сразу,
  файлы 2–4 — ни одного), только если список PR пуст или содержит один из файлов. Рядом с shell test-ами на Linux
  больше ничего не идёт; каждый shard длиннее примерно на 50 s (локально часть 2/4 — 33 case-а). Поведение step-а
  проверяет `ci-workflow.test.ts` под bash со stub-ом `pnpm` (три случая; mutation check: без проверки списка
  случай «список содержит файл» красный).
- `macos-tests` (весь набор в одном job-е на push в `main`): `HARNESS_SCRIPTS_PART: 1/1` — файл 1 гоняет все shell
  test-ы по пять, как один файл на `main` (локально: 72 case-а в файле 1, по одному в файлах 2–4). Деление на четыре
  файла остаётся для локальных run-ов (Mac, ПК). Предел shell test-а в этом шаге не менялся; после rebase на
  тикет 57 `FILE_TIMEOUT_MS` на Linux и macOS — 360 s при множителе 3 по умолчанию (раздел ниже).

### Раунд после #1026 (множитель timeout-ов) и windows-e2e

- Rebase на `origin/main` 82dedd3a (#1026) без конфликтов. `FILE_TIMEOUT_MS` теперь `ms(WINDOWS ? 300_000 : 120_000)`.
  При множителе 3 по умолчанию на Windows остаётся 900 s, как было, а не 2700 s: с одним повтором в CI зависший
  `.test.sh` пережил бы 60-минутный Windows job раньше, чем напечатал бы свою строку FAIL. На Linux и macOS 120 s
  становятся 360 s — это решение владельца про общий множитель. Исключение `OWNED_ELSEWHERE` для `FILE_TIMEOUT_MS`
  из `test/contract/test-timeout-scale.test.ts` убрано вместе с механизмом: других записей в нём не было.
  Остальные пределы `test/harness-scripts-suite.ts` идут через `ms()`. Два предела в 1 s, которые case-ы ждут
  истёкшими, помечены `// unscaled:`.
- windows-e2e (`ci.yml`) передавал spec-файлы тем же `@(-split $env:E2E_FILES | Where-Object { $_ })`. На pwsh
  7.6.9 два файла доходят до функции одним аргументом `<a b>`, а пустой список — лишним пустым аргументом `<>`.
  Теперь `$files = @(…); pnpm test:e2e "--shard=$env:SHARD" @files`. `ci-workflow.test.ts` гоняет команду из
  workflow под PowerShell со stub-ом `pnpm`, который печатает каждый аргумент отдельно (три случая: без файлов,
  один, два). Mutation check: со старой командой два случая красные, exit 1.
- Ручной запуск `windows-tests.yml` без shard-а (`else { pnpm test }`, весь набор в одном job-е на runner-е с 4 CPU)
  теперь ставит `HARNESS_SCRIPTS_PART=1/1`, как `macos-tests`: файл 1 гоняет все shell test-ы по пять, а не четыре
  файла рядом. Case «a dispatch» в `windows-tests-workflow.test.ts` ждёт `part=[1/1]`; mutation check: без этой
  установки case красный, exit 1.

### Замер на ПК после merge и исправление «4×5 одновременно» (ветка `worfy-throughput/56-concurrency`)

- ПК владельца (16 потоков), два полных run-а на 63b8182e, с 15 и с 8 worker-ами: в обоих 11 shell test-ов убиты по
  пределу 900 s (`FILE_TIMEOUT_MS` = `ms(300_000)` × 3) — `land`, `wave-gate-merge`, `skill-blocks-gate`,
  `plugin-neutral`, `wave-gate-lock`, `profile-schema2`, `epic-wave-ship-ticket`, `wave-gate`, `preflight`,
  `profile-attribution`, `silent-mode`. По одному те же скрипты идут 200–415 s. До #1023 (один файл, пять сразу)
  красным был один shell test. Оговорка: run-ы шли под игровой нагрузкой, чистый замер ПК будет позже.
- Вывод: дефект тикета, независимо от нагрузки. `maxConcurrency: 5` проекта contract действует на каждый файл, и в
  локальном полном run-е (gate, `pnpm test`) четыре файла шли рядом, до 5 shell test-ов каждый — до 20 сразу вместо
  прежних 5. На Mac это видно напрямую: пик одновременных `.test.sh` до исправления — 20.
- Исправление: `atOnce` (`test/harness-shell-tests.ts`) — сколько shell test-ов файл гоняет сразу. Без части
  четыре файла делят пять: 2, 1, 1, 1. С частью (CI-job, `HARNESS_SCRIPTS_PART`) файл 1 гоняет всю часть по пять,
  как раньше. Файл ставит себе это число через `vi.setConfig({ maxConcurrency })`. Ожидающий case держит сам
  limiter vitest, до старта case-а, поэтому предел case-а считается от его собственного старта. Деление по
  секундам учитывает это число (`inFile` через `fileEnds`: секунды файла на его слоты, но не меньше самого долгого
  shell test-а файла): файл 1 получает примерно вдвое больше секунд, и файлы кончаются вместе.
- Почему не общий семафор между worker-ами (lock-файл в temp): он отдавал бы освободившийся слот любому файлу, но
  ожидание шло бы внутри case-а и считалось бы против предела case-а, а пределы не поднимаем.
- Цена: файл `harness-scripts-<n>`, запущенный один без части, идёт по 2 или по 1 shell test-у сразу. Быстро
  прогнать все shell test-ы одни: `HARNESS_SCRIPTS_PART=1/1 pnpm test test/contract/harness-scripts-1.test.ts` —
  пять сразу.
- Замер на Mac (18 ядер, `--maxWorkers=9`, на Mac работали другие Session-ы). Пик — число разных
  `harness/{bin,hooks}/tests/*.test.sh`, которые идут одновременно, по `ps` раз в секунду.

| Run | До (`main` ffcb8ede) | После |
| --- | --- | --- |
| четыре файла harness-scripts одной командой | 55 s, пик 20 | 126 s, пик 5 (5 сразу — 91 выборка из 122) |
| полный `pnpm test` | 151 s, пик 20; shell test-ы идут с +1 по +62 s | 176 s, пик 5; shell test-ы идут с +1 по +144 s |

  Сумма времён shell test-ов в run-е четырёх файлов: 911 s до, 552 s после — без давки каждый идёт быстрее. Файлы
  после: файл 1 — 21 shell test, 244 s на два слота; файлы 2–4 — 95–110 s по одному. На этом Mac 20 сразу
  проходили, и полный run стал на 25 s длиннее; цель — ПК, где 20 сразу упирались в предел.
- Проверки: `afterAll` каждого файла сверяет пик своих shell test-ов с `atOnce`; `ci-workflow.test.ts` проверяет
  2, 1, 1, 1 для четырёх файлов, сумму 5 для 1–5 файлов, 5 для части и деление по слотам. Mutation check: без
  `vi.setConfig` файл 2 один красный (`expected 5 to be less than or equal to 1`); `atOnce` всегда 5 — два case-а
  `ci-workflow.test.ts` красные (`[5, 5, 5, 5]` вместо `[2, 1, 1, 1]`).

### Замер на ПК после #1039 (80defef3)

ПК владельца, 2026-10-30 03:22–03:47Z, под игровой нагрузкой (How to Fish шла в начале и в конце run-а): четыре
файла harness-scripts одной командой vitest, `HARNESS_SCRIPTS_PART` не задан. Отчёт — комментарий в PR #1039.

| Run | Итог | Wall time | Пик `.test.sh` сразу | Убиты по пределу 900 s |
| --- | --- | --- | --- | --- |
| ffcb8ede (до #1039), вместе | exit 1 | 1169 s | 20 | 4 |
| ffcb8ede (до #1039), по одному файлу подряд | exit 0 | 1537 s всего | 5 | 0 |
| 80defef3 (после #1039), вместе | exit 0, 74 passed / 2 skipped / 0 failed | 1517 s | 5 (ровно 5 — 228 выборок из 286, раз в 5 s) | 0 |

- Самые долгие shell test-ы после: `land` 424 s, `plugin-neutral` 385 s, `wave-gate` 358 s, `wave-gate-merge`
  356 s, остальные ≤ 273 s. До предела 900 s у самого долгого остаётся 476 s.
- После исправления четыре файла вместе идут столько же, сколько по одному подряд, и без красных.
- `guard-silent`: его собственный предел внутри скрипта (две проверки за 7500 ms) на ffcb8ede при 20 сразу дал
  7690 ms; при 5 сразу — зелёный, 209 s на весь скрипт. Правки не нужно.
