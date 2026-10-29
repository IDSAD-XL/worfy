# 21 — Команда выбора test-ов по diff: список unit- и contract-файлов, которые задевает PR

Type: task
Status: claimed 2026-10-29T04:29Z
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

- [ ] `test/unit/affected-tests.test.ts` на фикстуре: правка модуля `src/shared/` — его test-ы и test-ы его
      импортёров; правка `harness/bin/wave-gate` — contract test-ы, которые запускают его процессом (по
      таблице); правка `vitest.config.ts` — `ALL`; неизвестный путь — `ALL`; правка только `.md` — пустой список.
- [ ] Прогон на трёх последних влитых PR с кодом: число файлов и время `pnpm test <файлы>` против полного —
      в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

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
таблицы → `ALL`; test-файл → он сам; путь из `links` → названные файлы (test-файл как есть, модуль — через
тех, кто его импортирует); модуль → test-ы, которые импортируют его прямо или через другие модули. Не покрыт
ничем → `ALL`: модуль вне `src/` и `test/`, который никто не импортирует и таблица не называет, и файл любого
другого вида (shell, YAML, JSON, картинка). `*.md` и пути из `none` (`docs/**`, `.scratch/**`) — покрыты
без test-ов. Таблица называет несуществующий файл → `ALL` с причиной на stderr. CI script не подключён — это
решение Ticket-а 11.

**Граф модулей — vitest Node API** (`createVitest` + `specifications.getRelevantTestSpecifications()` с
`config.related`), то есть тот же расчёт, что у `vitest related`, на `vitest.config.ts` рабочего дерева.
Почему не CLI: `vitest list` в 5.0.3 не принимает `--related` (`CACError: Unknown option --related`), а
`vitest related` запускает test-ы, а не печатает список. Почему не свой граф import-ов: vite разрешает import-ы
так же, как run test-ов, и видит `import()`; своё разрешение путей пришлось бы держать в согласии с ним.
Чего граф не видит: import-ы с `?raw` (`src/main/mcp/*.md`) — строка в таблице. Скорость: на этом
репозитории 0,3–8,7 s на один diff (под `nice`; без модулей в diff граф не строится), на фикстуре test-а 0,1–0,5 s. Загрузка `vitest.config.ts`
делает то же, что перед каждым `pnpm test` (убирает остатки прерванного run-а).

**Таблица** `scripts/affected-tests.table.json` собрана по исходникам test-ов: какие файлы они запускают
процессом или читают как текст (`join(REPO, …)`, `new URL(…)`, строковые пути). `harness/**` — одна грубая
строка, 42 имени (`harness-scripts.test.ts` с shell test-ами Harness и все test-ы, которые называют путь под
`harness/`: `wave-gate`, `land`, `profile`, `project-connect`, `gate.mjs`…). Отдельные строки — для test-ов,
которые читают все файлы папки (`no-rmsync`, `agent-env`, `quit-listeners`, `canvas-zoom`…), скриптов
`scripts/*`, `.github/**`, `build/**`, конфигураций сборки и фикстур `test/fixtures/<папка>/**`. `all`:
`package.json`, lockfile, `pnpm-workspace.yaml`, `.nvmrc`, `vitest.config.ts`, `tsconfig*.json`,
`scripts/vitest-electron.mjs`, setup-файлы и то, что грузит `vitest.config.ts`, `.gitattributes`, `.gitignore`.

**Test** — `test/unit/affected-tests.test.ts`, 21 case: временный git-репозиторий со своим графом и таблицей,
по ветке на case. Правка `src/shared/format.ts` → его test и test импортёра через модуль; правка
`harness/bin/wave-gate` → contract test-ы из таблицы; `vitest.config.ts` → `ALL`; неизвестный путь →
`ALL`; только `.md` и `docs/**` → пустой вывод; новый и изменённый test-файл — всегда в списке; переименование
— по обоим именам; diff от точки ветвления (`...`), не от нового base; `--json`; отказы с exit code 2. Плюс
проверки настоящей таблицы: все названные файлы есть, `wave-gate`/`land`/`profile`/`project-connect`/`gate.mjs`
ведут к своим contract test-ам, конфигурация run-а — `ALL`. Mutation testing: 19 mutant-ов скрипта и 3
mutant-а таблицы в копии под scratchpad — каждый краснит test.

**Прогон на влитых PR** (merge-коммит `C`, `C~1...C`; время файлов — из логов CI run-а 40813630615, Linux,
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

**Чего команда не ловит.** Test, который читает файл как текст и не попал в таблицу: для пути вне `src/` и
`test/` это `ALL`, а для модуля под `src/` или `test/` — только его импортёры. Страховка — полный run на push в
`main`. `windows-verdict-scope.test.ts` проверяет, что у каждого шаблона `PC_ONLY` остался файл; удаление
последнего такого файла таблица не направляет к этому test-у. На Windows путь вида vitest (прямые слэши)
локально не проверен — проверит job `windows / full-suite`.
