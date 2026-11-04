# 05 — e2e: приложение убито посреди Wave и запущено снова; GitHub недоступен весь Run

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Сценарии» (строки «Приложение убито посреди Wave и запущено снова», «GitHub недоступен весь Run»), «Где идёт набор», «Риски», п. 3, 4, 6

## Что происходит

- e2e Autopilot идут в собранном приложении на fake agent (`test/e2e/autopilot.spec.ts:245`); вспомогательные
  `prepare` (`:161`), `messages`, `journalKinds`, `files` (`:37`) живут внутри этого spec-а. Его не правим: перенос
  старых test-ов на новый helper — не в этом Epic-е.
- `endApp` убивает приложение SIGKILL и ждёт, что его процесс ушёл; на Windows — сначала PID приложения, потом
  `cmd.exe` (`test/e2e/end-app.ts:53-66`).
- Run живёт в памяти; после SIGKILL его Journal остаётся без `run-stopped`. Run history строит такой Run оборванным
  (`src/shared/flight-recorder/from-journal.ts:200-207`, `stoppedAt: null`).
- Строки Journal пишутся одним `appendFile` (шапка `src/main/autopilot/journal.ts`); оборванная последняя строка
  пропускается при чтении (`parseJournal`, `src/shared/autopilot/journal.ts`).
- GitHub недоступен: gh stub с файлом `fail` (`test/fixtures/gh/gh-stub.mjs:45-47`), `WORFY_GH` — `GH_STUB`
  (`test/e2e/launch-env.ts`).

## Что делаем

1. **`test/e2e/autopilot-world.ts`** — fixture-проект (git-папка, Epic `demo`), окружение fake agent, чтение Journal
   и лога сообщений, снимок файлов Project-а: те же функции, что внутри `autopilot.spec.ts`, без переноса старого spec-а.
2. **Скрипт `autopilot-fault-held.jsonl`:** ход Wave держится на `wait_release`, пока test не убьёт приложение.
3. **Убитое приложение.** Старт Run кнопкой Autopilot; Wave 1 ушла; test ставит 01 в `claimed`; `endApp`. Затем
   `launchApp` с той же `WORFY_DATA_DIR` и тем же Project-ом. Ожидание:
   - test ждёт устойчивых признаков, не отсчёта по часам: строка прошлого Run-а в Run history показана оборванной;
     строка статуса Autopilot — не «running»;
   - кнопка Autopilot стартует новый Run без toast отказа (И6); test ждёт его `run-started` и `wave-started`;
   - в конце число строк `WORFY_AGENT_LOG` — ровно две команды Wave (прошлого и нового Run-а): на старте после
     рестарта ничего не ушло (И1); `ticket-status`
     нового Run-а не повторяет `claimed` 01 из прошлого (И3, чтение на старте);
   - `checkRecovery` по обоим Journal-ам с ожиданием «нет `run-stopped`» у первого; файлы Project-а не тронуты worfy (И7).
4. **GitHub недоступен.** Файл `fail` с «error connecting to api.github.com» до старта. Run проходит Wave
   (test ставит Ticket-ы в `done`), кнопка и строка статуса работают, `checkRecovery` пустой, в логе gh только чтение.
5. `scripts/e2e-specs.table.json`: spec дописан в два правила, где уже стоит `test/e2e/autopilot.spec.ts`, —
   правило Link (`src/main/link/…`: Autopilot идёт через Link-сервис) и `src/renderer/flight-recorder/**` (spec
   открывает Run history). `test/e2e/timings.json` не правится: это медианы CI по id run-ов, новый файл до
   замера получает медиану таблицы (`scripts/e2e-shard.mjs:16`).

## Готово, когда

- [ ] e2e: после SIGKILL и нового запуска сообщений Orchestrator-у нет, прошлый Run в Run history оборван, новый Run
      стартует и шлёт команду Wave один раз; `checkRecovery` пустой.
- [ ] e2e: GitHub недоступен весь Run — Run проходит, `checkRecovery` пустой, gh только читал.
- [ ] После spec-а нет живого процесса приложения (ожидание `endApp` и закрытие второго запуска).
- [ ] Spec не дольше 30 с по логу `macos-e2e` на PR (предел этого Epic-а, не ADR-0081); зелёный в `macos-e2e` и
      `windows-e2e`.
- [ ] `node scripts/ci-scope.mjs` для diff-а с правкой `src/renderer/flight-recorder/` называет новый spec;
      `test/contract/ci-scope-e2e.test.ts` — exit 0.
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
- [ ] `src/` не изменён. `pnpm lint`, `pnpm typecheck` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- e2e `test/e2e/autopilot-faults.spec.ts` (новый). Для `src/main/autopilot/**` правила в
  `scripts/e2e-specs.table.json` нет: PR с Autopilot и так запускает все spec-файлы (`scripts/ci-scope.mjs:24-27`).
- Сначала падающий: test убитого приложения с ожиданием «Run продолжился сам после рестарта» — красный (Run в памяти не
  продолжается); затем верное ожидание.
- Локально перед PR — `rules-local-e2e.md` (общий замок `/tmp/worfy-e2e.lock`, проверка экрана).

## Где в коде

- `test/e2e/autopilot-world.ts` (новый)
- `test/e2e/autopilot-faults.spec.ts` (новый)
- `test/fixtures/agent-scripts/autopilot-fault-held.jsonl` (новый)
- `scripts/e2e-specs.table.json`

Только читать: `test/e2e/autopilot.spec.ts`, `test/e2e/end-app.ts`, `test/e2e/helpers.ts`, `test/e2e/launch-env.ts`,
`test/autopilot-invariants.ts`, `test/fixtures/gh/gh-stub.mjs`.
