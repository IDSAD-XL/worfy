# 02 — Gate пишет записи о падениях

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Источники и что меняется в них» (gate не знает test-ов, `GATE_FAILURES_FILE`), «Модель» (файл run-а, запись шага без test-ов, срок хранения), «Windows» (оба пути запуска script-а), «Решено без владельца» (строка в красном отчёте); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md), [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md)

## Что происходит

- Gate гоняет script-ы профиля по одному (`harness/hooks/gate.mjs:1012-1039`) через `runScript`
  (`gate.mjs:727-745`); на Windows — через `cmd.exe` с `env: { ...process.env, … }` (`gate.mjs:648-650`), иначе
  `spawnSync` с окружением процесса (`gate.mjs:679`).
- Папка логов run-а названа до старта script-ов (`gate.mjs:980`), а пишется только после исхода
  (`gate.mjs:1055-1063`): остановленный run ничего не оставляет. Временный файл вывода script-а `captured` удаляет
  сам, в `finally` (`gate.mjs:711-716`). `removeOld` (`gate.mjs:838`) удаляет только файлы старше 8 дней
  (`gate.mjs:394-406`), а обработчик сигнала выходит через `process.exit` без уборки (`gate.mjs:825-829`) — на них
  полагаться нельзя.
- Красный отчёт печатает хвост вывода, блоки Playwright и путь полного лога (`gate.mjs:1066-1083`).
- Какой test упал, gate не записывает: в verdict-файле и маркерах — только исход.

## Что делаем

1. Перед каждым script-ом — `GATE_FAILURES_FILE` = `<state>/.run-<tag>-<pid>-<NN>.failures.jsonl` в окружении
   этого script-а (оба пути: прямой и `cmd.exe`). Переменная не остаётся в окружении следующего script-а.
2. Сразу после `runScript`, в `finally`, как `captured`: файл читается и удаляется, строки — в памяти до `settle`.
   Обработчик сигнала удаляет файл идущего script-а до `process.exit` (одна строка в `gate.mjs:825-829`).
3. После `settle` (там же, где пишутся логи): для каждого упавшего script-а — его строки из памяти (каждая
   проверяется форматом 01; битая строка пропускается, число пропущенных — в записи шага), к каждой — `step`; каждую
   gate сам прогоняет через `scrubRecord` (`error`, `name`, `file`), не доверяя очистке проекта; script упал и
   строк нет — одна запись шага: `runner`/`file`/`name` = `null`, `error` — первая строка с `error`/`Error`/`FAIL`
   его вывода, иначе последняя непустая, после `scrub`. Script среди `envBroken` (окружение недоступно) записей
   не даёт.
4. Есть хоть одна запись — `writeRunFile` с `run` = `<tag>/<run>`, `computer` (`ensureComputer`), `head`, `key`,
   `profile`, `outcome`, `at` и `dirty` (`git status --porcelain` перед первым script-ом не пуст); затем
   `pruneFailures`.
5. Красный отчёт: после «full output» — `--- failure records: <файл> (<n> tests, <m> steps without tests)`; запись
   не удалась — `--- failure records: not saved, <причина>`. Verdict-файл, маркеры, cache, строка вердикта и
   коды выхода — без изменений.
6. Комментарий в шапке `gate.mjs` — абзац о `GATE_FAILURES_FILE` и файле run-а (контракт для проектов).

## Готово, когда

- [ ] Shell test: проект-fixture, чей script `test` пишет две строки в `$GATE_FAILURES_FILE` и выходит с 1 — файл
      run-а с двумя записями, `step` = метка script-а, `head` = HEAD, код gate 2, строка `[gate] red …` прежняя.
- [ ] Shell test: script `lint` падает без строк — одна запись шага с первой строкой ошибки; в ней нет пути
      домашней папки.
- [ ] Shell test: строка reporter-а с `/Users/jdoe/…` в `error` и `name` — в файле run-а `~/…`: gate очистил сам.
- [ ] Shell test: run на дереве с незакоммиченной правкой — `dirty: true`; на чистом — `false`.
- [ ] Shell test: после каждого script-а его `.run-…failures.jsonl` в папке состояния нет (script следующего шага
      печатает список папки).
- [ ] Shell test: зелёный run и run «nothing ran» файла не пишут; run с `command not found` (окружение недоступно)
      записей не даёт.
- [ ] Shell test: run, остановленный SIGTERM во время script-а, который уже записал строку, не оставляет ни файла
      run-а, ни `.run-…failures.jsonl`.
- [ ] Shell test: второй script не видит `GATE_FAILURES_FILE` первого (печатает своё значение — оно другое).
- [ ] Shell test: красный отчёт содержит строку `--- failure records:`; verdict-файл тот же, что у run-а без строк
      в файле, без полей времени: `at`, `total_ms` и `steps[].ms` сравнение убирает.
- [ ] Shell test: файл run-а с `at` старше 60 дней удалён после нового красного run-а.
- [ ] Shell-test-ы gate (`harness/hooks/tests/*.test.sh`) и `test/unit/gate-state.test.ts` зелёные.
- [ ] Платформенный PR, если так скажет `scripts/windows-verdict-scope.mjs`: путь `cmd.exe` проверяется на Windows.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- `harness/hooks/tests/gate-failures.test.sh` (новый), по образцу `gate-timings.test.sh`: временный репозиторий и
  реестр, `CLAUDE_GATE_STATE` и `HARNESS_HOME` во временной папке. Строки в `test/harness-shell-tests.ts` не нужно:
  новый файл получает `UNMEASURED_SECONDS` (`test/harness-shell-tests.ts:57`, `:186`).
- Сначала падающий: первый случай — файла run-а нет.
- Прогнать все `harness/hooks/tests/gate-*.test.sh` и `test/unit/gate-state.test.ts`,
  `test/unit/flight-recorder-gate.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` (читают папку
  состояния gate).

## Где в коде

- `harness/hooks/gate.mjs`
- `harness/hooks/tests/gate-failures.test.sh` (новый)

Только читать: `harness/hooks/gate-failures.mjs` (Ticket 01), `harness/hooks/gate-log.mjs`,
`harness/hooks/gate-paths.mjs`, `src/main/gate/state.ts` (читает маркеры и verdict — не должен заметить папку
`failures/`).
