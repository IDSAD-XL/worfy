# 21 — Команда выбора test-ов по diff: список unit- и contract-файлов, которые задевает PR

Type: task
Status: done 2026-10-29T06:10Z
PR: #954
Branch: worfy-throughput/21
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 4; пункт 1 «Что делаем»
Ticket-а [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md) — вынесен сюда, чтобы e2e по путям
(13) не ждал CI на Linux на PR (12).

## Что происходит

- gate сужает набор только по пакету (`harness/hooks/gate.mjs`, выбор набора около `:861-945`); worfy — один
  пакет, и любая правка `.ts` запускает весь `pnpm test`.
- Около 87 unit- и contract-файлов запускают настоящие процессы (скрипты `harness/bin/*`, `bash`, `git`) или
  читают файлы как текст (`ci.yml`, тексты Harness) — граф import-ов этих связей не видит (spec Epic-а,
  раздел 2026-10-20, «Риски»).
- `scripts/windows-test-list.mjs` проверяет список файлов для runner-а, но не строит его.

## Что делаем

1. `node scripts/affected-tests.mjs <base> <head> [--json]`: печатает test-файлы `test/unit/` и `test/contract/`,
   которые задевает diff — по графу модулей (рекомендация spec-а — граф vite через `vitest related` /
   `vitest list`; окончательный выбор — по фикстурам этого Ticket-а) и по таблице
   `scripts/affected-tests.table.json` («путь или glob → test-файлы») для связей вне графа.
2. Правка конфигурации test-ов, `package.json`, lockfile, setup-файлов — печатает `ALL`. Путь, который не
   покрыт ни графом, ни таблицей, — тоже `ALL`, не пустой список.
3. Изменённый или новый test-файл входит в список всегда.

Нужен ПК: нет. Трогает Harness: нет. Вердикт Windows: не платформенный PR (команда идёт на Mac и Linux).

## Готово, когда

- [x] `test/unit/affected-tests.test.ts` на фикстуре: правка модуля `src/shared/` — его test-ы и test-ы его
      импортёров; правка `harness/bin/wave-gate` — contract test-ы, которые запускают его процессом (по
      таблице); правка `vitest.config.ts` — `ALL`; неизвестный путь — `ALL`; правка только `.md` — пустой список.
- [ ] Прогон на трёх последних влитых PR с кодом: число файлов и время `pnpm test <файлы>` против полного —
      в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `scripts/affected-tests.mjs`, `scripts/affected-tests.table.json`, `test/unit/affected-tests.test.ts` — новые
- Только читать: `harness/hooks/gate.mjs`, `scripts/windows-test-list.mjs`, `vitest.config.ts`

## Вне скоупа

- Шаг перед merge по задетым test-ам и bisect на красном `main` — Ticket 11.
- e2e — Ticket 13.
- Набор Windows-runner-а по diff — нет: «Windows tests» идёт `full` на каждый PR (Ticket 24, решение 5). Если
  `full` на PR станет самым долгим шагом до merge, выбор файлов по выводу этой команды — отдельный Ticket.

## Итог

**Что сделано.** `node scripts/affected-tests.mjs <base> <head> [--json]` печатает test-файлы `test/unit/` и
`test/contract/`, которые задевает `git diff --name-only --no-renames <base>...<head>`; `ALL` — весь набор;
пустой вывод — ни одного файла. Exit code 0 — ответ; 2 — неверные аргументы, ошибка git, рабочее дерево не
`<head>` (граф читается из него), таблицу не прочитать. Порядок для каждого изменённого файла: путь из `all`
таблицы → `ALL`; test-файл → он сам; строки таблицы (`links` и `generated`) → названные файлы (test-файл как
есть, модуль — через тех, кто его импортирует); модуль → test-ы, которые импортируют его прямо или через другие
модули. Строка-scan (`"scan": true` в `links`, `scans` в `generated`: test читает всю папку — `src/**`,
`test/**`, `scripts/**`, `harness/**`, `test/fixtures/**`) добавляет свои test-ы, но путь покрытым не делает.
Не покрыт ничем → `ALL`: модуль вне `src/` и `test/`, который никто не импортирует; файл другого вида (shell,
неизвестный `.json`/`.yml`, картинка); Markdown под `src/`, `test/`, `harness/`, `scripts/`, который не
назван. Удалённый модуль → `ALL` (граф `<head>` уже не знает его импортёров; `scripts/affected-tests.mjs:139-142`),
поэтому и переименование модуля → `ALL`. Markdown вне этих папок и пути из `none` (`docs/**`, `.scratch/**`)
покрыты без своих test-ов, но выбирают test-ы, которые их читают; пустой вывод — только если таких нет.
Таблица называет несуществующий файл → `ALL` с причиной на stderr. CI script не подключён — это решение
Ticket-а 11.

**Граф модулей — vitest Node API** (`createVitest` + `specifications.getRelevantTestSpecifications()` с
`config.related`), то есть тот же расчёт, что у `vitest related`, на `vitest.config.ts` рабочего дерева.
Перед `createVitest` скрипт убирает `WORFY_TEST_EXCLUDE`: иначе файлы, которые Windows CI запускает отдельным job-ом, выпали бы из ответа.
Почему не CLI: `vitest list` в 5.0.3 не принимает `--related` (`CACError: Unknown option --related`), а
`vitest related` запускает test-ы, а не печатает список. Почему не свой граф import-ов: vite разрешает import-ы
так же, как run test-ов, и видит `import()`; своё разрешение путей пришлось бы держать в согласии с ним.
Чего граф не видит: import-ы с `?raw` (`src/main/mcp/*.md`) — строка в таблице. Скорость: на этом
репозитории 0,3–8,7 s на один diff (под `nice`; без модулей в diff граф не строится), на фикстуре test-а 0,1–0,5 s. Загрузка `vitest.config.ts`
делает то же, что перед каждым `pnpm test` (убирает остатки прерванного run-а).

**Таблица** `scripts/affected-tests.table.json` — четыре части. `generated` (137 строк) строит генератор
`node scripts/affected-tests-table.mjs`: TypeScript-парсер проходит исходники `test/` (кроме e2e, acceptance и
фикстур) и находит пути, которые test или helper запускает процессом или читает как текст (`__dirname`,
`import.meta.url`, `join`/`resolve` с литералами, строковые пути к файлам репозитория); каждый путь — `reads`
(покрывает) или `scans` (папка верхнего уровня или широкая папка: только добавляет test). `--check` даёт
exit code 0, когда закоммиченная таблица равна тому, что он строит, и 1, когда нет; test запускает его, так что
test, который начал читать новый файл, краснит run, пока таблицу не пересоберут. `links` (10 строк) — вручную:
то, что парсер не вычисляет, в том числе import-ы `?raw`. `all`: `package.json`, lockfile, `vitest.config.ts`,
`tsconfig*.json`, `scripts/vitest-electron.mjs`, setup-файлы и прочая конфигурация run-а. `none`: `docs/**`,
`.scratch/**`.

**Test** — `test/unit/affected-tests.test.ts`, 31 case: временный git-репозиторий со своим графом и таблицей,
по ветке на case. Правка `src/shared/format.ts` → его test и test импортёра через модуль; правка
`harness/bin/wave-gate` → contract test-ы из таблицы; `vitest.config.ts` → `ALL`; неизвестный путь, неизвестный
`.json`/`.yml`, удалённый модуль, Markdown под `src/` без строки → `ALL`; `.md` и `docs/**`, которые никто не
читает, → пустой вывод, а которые читает test, → этот test; scan-строка не покрывает путь; `WORFY_TEST_EXCLUDE`
не сужает ответ; новый и изменённый test-файл — всегда в списке; переименование — по обоим именам; diff от
точки ветвления (`...`); `--json`; отказы с exit code 2. Генератор: находит пути в тех формах, что пишут test-ы;
`--check` — 0 и 1. Настоящая таблица: равна выводу генератора, все названные файлы есть, фикстура, документ и
скрипт Harness ведут к своим test-ам, конфигурация run-а — `ALL`.

Review: round 1 REJECTED (5 med false negatives), round 2 VERIFIED.

CI #954 (merge-коммит `7e8798f5`): `lint-typecheck`, `linux-tests` 1–4/4, `macos-tests`, Windows `full-suite` и
`ci-ok` — SUCCESS.

**Прогон на влитых PR** — снят до доработки round 1, на прежней таблице (одна строка `harness/**` на 42 имени,
без генератора); на влитой таблице не перемерен. (merge-коммит `C`, `C~1...C`; время файлов — из логов CI run-а 40813630615, Linux,
4 shard-а: 459 файлов, сумма 975 s, самый долгий `harness-scripts.test.ts` 144 s; локально — `pnpm test
<файлы>` с `--maxWorkers=9` из 18 ядер, предел 120 s):

| PR | что менял | изменено файлов | выбрано test-файлов | сумма их времени в CI | самый долгий | локально `pnpm test <файлы>` |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| #949 | `harness/bin/wave-gate` и его test | 3 | 40 | 351 s (36 %) | 144 s | не уложился в 120 s |
| #945 | `harness/hooks/gate.mjs`, `gate-resolve.mjs` | 5 | 40 | 351 s (36 %) | 144 s | не запускал (тот же набор) |
| #941 | `harness/bin/wave-brief`, skill, rules | 7 | 40 | 351 s (36 %) | 144 s | не запускал (тот же набор) |
| #940 | `ci.yml`, `scripts/e2e-shard.mjs`, `ci-scope.mjs` | 8 | 11 | 27 s (3 %) | 10 s | 21,3 s, exit 0 |
| #927 | `ci.yml`, `scripts/ci-scope.mjs`, ADR | 5 | 8 | 26 s (3 %) | 10 s | 17,2 s, exit 0 |
| #933 | `src/` (Autopilot, настройки) | 19 | 246 | 411 s (42 %) | 36 s | не запускал |

Полный `pnpm test` локально с теми же 9 worker-ами в 120 s не уложился (остановлен по пределу); в gate fast
этой ветки, на всех ядрах, — 168,8 и 153,3 s. #933 на своём
коммите дал `ALL`: таблица называет `test/unit/e2e-shard.test.ts`, которого тогда не было — так и задумано;
строка таблицы выше — с этой строкой, убранной для замера.

**Выигрыш в CI, если Ticket 11 подключит команду** (оценка по этим числам, не замер): сейчас unit + contract
на Linux — 4 shard-а, шаг test-ов 88–221 s, сумма 527 s runner-времени плюс около 30 s установки на shard;
`macos-tests` — 762 s. PR с CI, скриптами и документами (#927, #940) — 3 % времени файлов: один shard около
30 s вместо четырёх, около 8 из 9 runner-минут Linux. PR Harness — 36 %, но стену держит
`harness-scripts.test.ts` (144 s один): время до `ci-ok` почти не меняется, экономия — около 60 % runner-минут.
PR в общий модуль `src/` (#933, настройки) — 42 %. Больше всего даст `macos-tests` (762 s), если и он пойдёт по
выбору. Windows `full-suite` остаётся полным (Ticket 24).

**Чего команда не ловит.** Test, который читает файл по пути, что парсер генератора не вычисляет (параметр,
вызов, путь, собранный во время run-а), и для которого нет строки `links`: для пути вне `src/` и `test/` это
`ALL`, а для модуля под `src/` или `test/` — только его импортёры. Страховка — полный run на push в `main`.
`windows-verdict-scope.test.ts` проверяет, что у каждого шаблона `PC_ONLY` остался файл; удаление
последнего такого файла таблица не направляет к этому test-у. На Windows путь вида vitest (прямые слэши)
локально не проверен — проверит job `windows / full-suite`.

Не проверено: прогон на трёх PR на влитом коде — числа выше сняты на таблице до доработки round 1, и полный
`pnpm test` локально в 120 s не уложился, так что сравнения «выбор против полного» локально нет (только по
времени файлов в CI).

Долг: `test/unit/affected-tests.test.ts:452` запускает процессом node + typescript по всем исходникам test-ов
(1,1 s в одиночку под нагрузкой, предел 5 s) — экспортировать `generate()` (`scripts/affected-tests-table.mjs:217`)
и вызывать его в том же процессе или перенести case в `test/contract`. Переименованный модуль всегда запускает
весь набор.
