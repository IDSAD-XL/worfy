# 56 — Shell test-ы Harness в четырёх файлах vitest, а не в одном в конце run-а

Type: task
Status: claimed 2026-10-29T19:18Z
Branch: worfy-throughput/56
PR: #1023
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
и то, как Windows-run делит shell test-ы. Трогает Harness: нет (`harness/` не меняется). Вердикт Windows — по
`node scripts/windows-verdict-scope.mjs`.

## Готово, когда

- [x] Каждый shell test запускается ровно один раз за полный локальный run: список выполненных shell test-ов до и
      после совпадает (55 из 55, `diff` пустой).
- [x] CI: `ci-workflow.test.ts` и `windows-tests-workflow.test.ts` проверяют новый шаг, каждый shell test ровно в
      одном Windows job-е; `affected-tests` выбирает все четыре файла для пути `harness/`.
- [x] Деление — по измеренным секундам, не по числу.
- [x] Timeout-ы не подняты, test-ы не удалены (diff это показывает).
- [x] Замер на Mac (`--maxWorkers=9`): wall time `pnpm test` и gate fast до и после, время файла или файлов — в «Итог».
- [ ] Замер на ПК — после merge.
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

- `harness/README.md:57`, `harness/bin/tests/wave-gate.test.sh:10`, `harness/hooks/tests/gate-verdict-world.sh:6`,
  `docs/lessons/README.md:27` называют старый файл `test/contract/harness-scripts.test.ts`. Правка `harness/`
  запускает e2e на PR; эти ссылки — для отдельного docs-PR.

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
