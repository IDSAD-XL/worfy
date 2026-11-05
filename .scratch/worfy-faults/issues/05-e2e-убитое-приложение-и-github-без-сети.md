# 05 — e2e: приложение убито посреди Wave и запущено снова; GitHub недоступен весь Run

Type: task
Status: claimed 2026-11-05T09:24Z
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
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · eddc8bad409b0208b84aae8dc90da9ddc794dbe1
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · efaa3e43d
- [ ] e2e: GitHub недоступен весь Run — Run проходит, `checkRecovery` пустой, gh только читал.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · eddc8bad409b0208b84aae8dc90da9ddc794dbe1
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · efaa3e43d
- [ ] После spec-а нет живого процесса приложения (ожидание `endApp` и закрытие второго запуска).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · eddc8bad409b0208b84aae8dc90da9ddc794dbe1
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-faults.spec.ts` exit 0 · mac - · efaa3e43d
- [ ] Spec не дольше 30 с по логу `macos-e2e` на PR (предел этого Epic-а, не ADR-0081); зелёный в `macos-e2e` и
      `windows-e2e`.
- [ ] `node scripts/ci-scope.mjs` для diff-а с правкой `src/renderer/flight-recorder/` называет новый spec;
      `test/contract/ci-scope-e2e.test.ts` — exit 0.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs --run test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts` exit 0 · mac - · eddc8bad409b0208b84aae8dc90da9ddc794dbe1
- [ ] Каждый test краснеет на испорченном ожидании — в «Итог».
  - evidence: test-run pass · `pnpm exec playwright test test/e2e/autopilot-faults.spec.ts` on 4 mutants exit 1 each · mac - · eddc8bad409b0208b84aae8dc90da9ddc794dbe1
  - evidence: test-run pass · `pnpm exec playwright test -g "GitHub out of reach" test/e2e/autopilot-faults.spec.ts` on 2 mutants of round 1 exit 1 each · mac - · efaa3e43d
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
- `scripts/ci-scope.mjs` (одна строка в `APP_FILES`, см. «Итог»)

Только читать: `test/e2e/autopilot.spec.ts`, `test/e2e/end-app.ts`, `test/e2e/helpers.ts`, `test/e2e/launch-env.ts`,
`test/autopilot-invariants.ts`, `test/fixtures/gh/gh-stub.mjs`.

## Итог

- `test/e2e/autopilot-world.ts`: `prepareWorld(scratch)` (`:78`) — git-папка с Epic-ом `demo` (01, 02 готовы, 03
  после обоих), epic-status stub, папка данных с Project-ом, `GH_STUB_DIR` и `GH_STUB_LOG`; `env(script)` — окружение
  запуска. Читатели: `messages` (`:158`), `journals` (`:169`, тексты всех Journal-ов по времени первой строки),
  `kindsOf` (`:186`), `ghCalls` (`:201`), `files` (`:36`); `setStatus` (`:145`) меняет статус за Orchestrator-а —
  сначала ответ epic-status, потом строку `Status:` файла Ticket-а — и отдаёт `StatusWrite` для И3 и И7;
  `releaseTurn` (`:210`). `autopilot.spec.ts` не тронут.
- `test/fixtures/agent-scripts/autopilot-fault-held.jsonl`: два хода Orchestrator-а, каждый держится на
  `wait_release "turn"`. Убитому приложению хватает первого: второй запуск играет скрипт заново.
- `test/e2e/autopilot-faults.spec.ts`, test убитого приложения (`:35`): Wave 1 (01, 02) ушла, test ставит 01 в
  `claimed`, ждёт `ticket-status` в Journal-е и убивает приложение `endApp` (SIGKILL, ожидание ухода процесса), потом
  `close({ windowGone: true })` убирает временные папки запуска. Второй запуск с той же `WORFY_DATA_DIR`: строки
  статуса нет, кнопка `Autopilot` активна; Run history из палитры открыт на убитом Run-е с «no stop in the Journal»;
  сообщений Orchestrator-у по-прежнему одно. Кнопка стартует новый Run без toast отказа; его Wave — только 02 (01 в
  работе); в логе fake agent ровно `/epic-wave Ticket-ы 01, 02 …` и `/epic-wave Ticket-ы 02 …`. После закрытия
  второго запуска (его Run кончается `run-stopped app-quit`) `checkRecovery` с `stop: null`, `waves: 2`,
  `tornLastLine: true` пустой: `claimed` 01 записан один раз, прошлым Run-ом.
- Test GitHub без сети (`:115`): файл `fail` с «error connecting to api.github.com» до старта. Wave 1 → test ставит
  01 и 02 в `done` → Wave 2 (03) → 03 `done` → `stopped: no ready wave`, кнопка снова `Autopilot`. gh звали
  (`pr list` упал), `checkRecovery` с `stop: 'no-ready-wave'`, `waves: 2` пустой, в том числе И2.
- **Правка вне списка брифа, согласована с Orchestrator-ом:** `scripts/ci-scope.mjs`, `APP_FILES` +=
  `test/autopilot-invariants.ts` (`:132`). Spec импортирует `checkRecovery` из этого файла, и contract test
  `test/contract/ci-workflow.test.ts:1227` («every file outside test/e2e that the e2e tests import makes a pull
  request run macos-e2e») без строки краснел: PR, который правит правила восстановления, не запускал бы
  macos-e2e. Копия `checkRecovery` внутри `test/e2e` отвергнута — две копии правил.
- `scripts/e2e-specs.table.json`: spec дописан в правило Link и в правило `src/renderer/flight-recorder/**`, в обоих
  `why` — по фразе. `node scripts/ci-scope.mjs` (EVENT=pull_request) на пробном commit-е поверх ветки с правкой
  `src/renderer/flight-recorder/filter.ts`: `e2e-files` = autopilot-chat, **autopilot-faults**, autopilot,
  flight-recorder-detail, flight-recorder. `test/contract/ci-scope-e2e.test.ts` и `ci-workflow.test.ts` — exit 0.
- Сначала падающий: test убитого приложения с ожиданием «Run продолжился сам после рестарта» (`Wave 1 · running`
  после второго запуска) — красный: `element(s) not found`, строки статуса нет, Run жил в памяти.
- Мутанты (каждый — exit 1, правило в выводе): ожидание лога сообщений с лишней командой Wave — «I1: /epic-wave names
  01, 02, which no wave-started announces»; ожидание `stop: 'app-quit'` у убитого Run-а — «I4: no run-stopped, the
  scenario expects app-quit»; лог gh с `pr merge 11` — «I2: gh log line 2: gh pr merge 11 is not a read»; `waves: 1`
  у GitHub-сценария — «I1: 2 wave-started, the scenario expects 1».
- Время локально (Mac, один worker): 3.5 с и 1.4 с, spec — 5.1 с. Предел 30 с по логу `macos-e2e` и зелёный
  `windows-e2e` проверяет CI на PR.
- **Доработка, раунд 1 (красный `windows-e2e (1/4)`, run 42005761838):** test GitHub без сети на Windows падал на
  `expect(status).toHaveText('stopped: no ready wave')` с `element(s) not found` после двух «Wave 2 · running».
  Причина — в test-е, не в Run-е: Run остановился (в снимке ошибки toast «Run stopped: no-ready-wave · 3 done,
  0 blocked»), но после `done` у 03 все Ticket-ы Epic-а готовы, и рамка Epic-а уходит фишкой на полку готовых
  (ADR-0075, пункт 5) вместе со строкой статуса и кнопкой — как только экран прочтёт `Status:` 03. Экран и
  остановка Run-а гонятся; на Mac первой успевала остановка, на Windows CI — экран. Теперь test сам ставит экран
  первым: после `setStatus(03, done)` ждёт фишку `done-shelf-chip` эпика `demo` и пропажу рамки, только потом
  `releaseTurn`. Остановку читает из того, что переживает рамку: toast `run-stopped-toast` («Run stopped:
  no-ready-wave · 3 done, 0 blocked») и последняя строка Journal-а; потом открывает рамку кнопкой фишки «Expand demo,
  3 of 3 done» — строка статуса `stopped: no ready wave`, кнопка `Autopilot` с `aria-disabled="true"` (запускать
  нечего; прежнее `false` было верно только пока экран не видел 03 готовым). Timeout-ы не тронуты, src/ не тронут.
- Воспроизведение на Mac: старые конечные проверки при новом порядке (экран первым) — exit 1, `element(s) not
  found` на строке статуса, ровно как на Windows. Мутант без последнего `releaseTurn` — exit 1, toast не пришёл.
  Spec целиком — exit 0 (6.0 с и 2.3 с).
