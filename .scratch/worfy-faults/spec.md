# worfy-faults: сбои Autopilot как набор test-ов

Status: принят владельцем 2026-11-04 («Со всем согласен» — все рекомендованные ответы на Q1–Q7, раздел «Вопросы владельцу»).
Source: PR #1314 (`docs/proposals/eight-autonomy-features.md`, идея 7 «Autopilot fault injection»); оценка трёх идей,
принятая владельцем 2026-11-04 (Epic C: только test-ы, не функция продукта и не экран); Ticket
[worfy-polish 50](../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md) и PR #1307; Epic
[worfy-reliability](../worfy-reliability/spec.md) (рестарт без повтора действий, «сбой → инцидент → регрессионный
test»); [CONTEXT.md](../../CONTEXT.md), термины Run, Wave, Journal, Orchestrator, Session, Subagent, Quarantine;
ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md), [0005](../../docs/adr/0005-worfy-own-state-inventory.md),
[0071](../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md),
[0081](../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md).
Ticket-ы: Epic `worfy-faults`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`,
как у worfy-flight-recorder.

**Старт Epic-а — только после merge worfy-multi-vendor 39.** Ticket-ы 37, 38 и 39 того Epic-а правят
`src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `budget.ts`, `resume-at.ts`, `limits-wait.ts` и
`src/main/ipc/autopilot.ts`. Этот Epic этих файлов не правит (раздел «Решено без владельца», п. 1).

## Цель

2026-11-03 Run Autopilot-а остановился с `turn-error` после `API Error: 500`. После этого кнопка Autopilot на
Canvas ничего не делала, а `autopilot_start` отвечал «runs unattended»: Session Orchestrator-а ждала конца своих
фоновых задач (worfy-polish 50, «Что происходит»). Нашёл это владелец, не test.

Epic даёт набор test-ов: каждый сценарий вносит один сбой в Run над временным fixture-проектом и проверяет одни и
те же правила восстановления. Нового поведения, экрана или настройки нет. Сценарий, который находит дефект, —
это первый падающий test нового Ticket-а (раздел «Соглашения»).

## Что уже есть (переиспользуем)

- **Fake agent** `WORFY_AGENT=fake` (`src/main/agent/fake-query.ts:1-60`): Session играет скрипт
  `test/fixtures/agent-scripts/<name>.jsonl`. Директивы `crash` (Claude Code умирает, `fake-query.ts:588`), `exit`
  (`:590`), `wait_release` (`:574`, задачи «идут», пока test их не отпустит), `stderr`; SDK-сообщения — как есть,
  в том числе `result` с `is_error` и `rate_limit_event`.
- **Готовые скрипты сбоев:** `autopilot-limits.jsonl` (Limits отказали в ходе Wave), `autopilot-background.jsonl`
  (два implementer-а в фоне, `task_started` / `task_notification`), `crash.jsonl` (ENOSPC, потом `crash`),
  `error.jsonl`, `autopilot-blocked.jsonl`.
- **Claude process stub** `test/contract/claude-process-stub.ts:1-30`: у fake agent нет процесса, stub даёт ему
  настоящий дочерний процесс (`ignore-term` / `exit-at-once`); каждый процесс сам кончается через
  `STUB_LIFETIME_MS`, `stopAll()` добивает остальные. SIGKILL процесса stub-а Session в `error` не переводит:
  Session только запоминает выход процесса (`watch`, `src/main/agent/session.ts:540-543`), а fake query ждёт дальше
  на `wait_release`; процессы stub-а закрыты (`children`, `claude-process-stub.ts:56`). Смерть Claude Code в
  рабочих test-ах — директива `crash` после `wait_release` (`test/contract/autopilot-background.test.ts:624-628`,
  `test/contract/autopilot-limits.test.ts:498-501`). Stub в этом Epic-е — только для проверки «живых процессов не
  осталось».
- **gh stub** `test/fixtures/gh/gh-stub.mjs` (`WORFY_GH` в e2e — `test/e2e/launch-env.ts`, `GH_STUB`): `GH_STUB_DIR`
  с `prs.json`, файл `fail` даёт exit 1 с его текстом, его можно создать и удалить во время работы приложения
  (`gh-stub.mjs:45-47`); любая команда, кроме чтения, — exit 2 (`gh-stub.mjs:100`); `GH_STUB_LOG` пишет аргументы
  каждого вызова, без exit code (`gh-stub.mjs:37`). Для contract test-ов — `test/contract/gh-world.ts`
  (`STUB_COMMAND`, его runner — с timeout 15 с, `gh-world.ts:64`) и `ghRunner` (`src/main/github/prs.ts:95`),
  timeout gh по умолчанию — 30 с (`prs.ts:110`). `PrTracker` (`prs.ts:395`) берёт часы `now` (по умолчанию
  `Date.now`, `prs.ts:403`) и после неудачного чтения удваивает интервал до `maxIntervalMs` (`fail`, `prs.ts:433-435`).
- **Fake Codex** `test/fixtures/codex-app-server/fake-app-server.mjs` (`WORFY_CODEX=fake`), скрипты
  `test/fixtures/codex-scripts/`, среди них `turn-failed.jsonl`; схемы сверяет `test/contract/codex-fake.test.ts`.
  Выйти посреди хода он не умеет: шаги — `expect` / `notify` / `request` (`fake-app-server.mjs:7-12`), выход — только
  когда worfy закрыл stdin (`:45`) или по ошибке скрипта (`fail`, `:109-111`).
- **Seams Autopilot без правки `run.ts`:** поля `AutopilotDeps` (`src/main/autopilot/run.ts`) — `settleMs`,
  `limits`, `backgroundStallMs`, `tasksClock`, `prs` / `prsEveryMs` / `prsClock`, `endReadMs`. Так строит Run
  `harness()` в `test/contract/autopilot-limits.test.ts:210` — фиксированные часы, таймер ожидания в руках test-а.
- **Обработка сбоев в Run** (`run.ts`, по имени): `Autopilot.onEvent` переводит `state: 'error'` Session в
  `session-error`, `Autopilot.feed` пишет `session-error` в Journal, `Autopilot.newSession` замечает Session, уже
  ушедшую в ошибку; ход с `isError` → остановка `turn-error` с `session-error` (`step`, случай `turn-ended`,
  `src/shared/autopilot/cycle.ts:288`).
- **Journal** (`src/shared/autopilot/journal.ts`, по имени): виды событий — `JOURNAL_EVENT_KINDS`; `parseJournal`
  пропускает и считает нечитаемые строки, так что оборванная при SIGKILL строка не ломает чтение. `ticket-status` —
  одна строка на каждое изменение `Status:` (`statusChanges` в `run.ts`), статус до старта Run не пишется,
  последнее чтение — перед `run-stopped`, кроме Force stop и выхода приложения (шапка `run.ts`, абзац «The history
  of a run»).
- **e2e:** Run на fake agent в собранном приложении (`test/e2e/autopilot.spec.ts:245`), ожидание Limits
  (`:549`), narrow round из комментариев PR через gh stub (`:963-991`), кнопка после `turn-error` при живых задачах
  (`:1054`, polish 50). SIGKILL приложения — `endApp` (`test/e2e/end-app.ts:53-66`, на Windows сначала PID самого
  приложения). Список «что ничего не записано» — `files()` (`autopilot.spec.ts:37`).
- **Contract test-ы надёжности** (worfy-reliability 01, 05): рестарт Session, relaunch Orchestrator-а и resume после
  Limits не отправляют ход второй раз (`test/contract/autopilot-limits.test.ts:364`, `orchestrator-relaunch.test.ts`).

## Чего нет

- Общей проверки правил восстановления: каждый test сверяет свой кусок Journal и сообщений по-своему.
- Сценариев: API 529 (overloaded) и обрыв связи посреди потока ответа; убитый процесс Orchestrator-а во время
  фоновой записи implementer-а; implementer с `task_notification` `failed`; gh, который висит или отвечает 5xx во
  время Run; конфликт merge, после которого Orchestrator ставит Ticket в `blocked`; приложение, убитое и запущенное
  снова посреди Wave; GitHub недоступен весь Run.
- Тех же сценариев для Orchestrator-а на Codex (после worfy-multi-vendor 37).

## Правила восстановления (инварианты)

Каждое правило — функция в `test/autopilot-invariants.ts` (Ticket 01). Её зовут contract test-ы и e2e test-ы, на
вход — события Journal Run-а, лог сообщений fake agent (`WORFY_AGENT_LOG` или `FakeCall`), лог gh stub и снимки
файлов Project-а до и после.

| # | Правило | Как проверяется |
| --- | --- | --- |
| И1 | Команда Wave уходит Orchestrator-у один раз на Wave | В логе сообщений строк `/epic-wave …` ровно столько, сколько `wave-started`, и каждая называет Ticket-ы своей Wave (новая Wave может законно назвать Ticket прошлой, вернувшийся в `open`); после рестарта Session, resume после Limits или рестарта приложения лишней строки нет, пока человек не начал новый Run |
| И2 | worfy не меняет ничего на GitHub | Каждая строка лога gh stub (только аргументы, `gh-stub.mjs:37`) входит в белый список чтения: `pr list …`, `auth status …`, `auth token …`, `api repos/<owner>/<repo> …` без `-X`/`--method`. Merge и PR делает Orchestrator, не worfy (ADR-0002) — с его стороны это И1 |
| И3 | Статус Ticket-а не теряется и не повторяется | На каждое изменение `Status:` файла Ticket-а за время Run — ровно одна строка `ticket-status`; статусы до старта не пишутся; последний `ticket-status` Run-а совпадает с файлом (кроме Force stop и выхода — там последнего чтения нет по замыслу) |
| И4 | Journal называет причину и кончается | `run-stopped.reason` — ожидаемая причина сценария, и перед ним стоит событие, которое требует таблица ниже; Run, который пережил сбой, — `resumed`. Убитое приложение — единственный случай без `run-stopped` |
| И5 | Никто не вмешивался | В Journal нет `human-input` и `refused-dialog`: ни один сценарий не просит диалога и не трогает Session руками |
| И6 | Run снова стартует | После остановки новый старт проходит (новый `run-started`, новый файл Journal), без отказа `autopilot-start-refused` (polish 50) |
| И7 | worfy не пишет в Project | Файлы fixture-проекта после сценария — те же, кроме правок, которые test сделал за Orchestrator-а (ADR-0005; `files()`) |
| И8 | Journal читается целиком | `parseJournal(...).skipped === 0` для Run, который остановился сам; у убитого приложения допустима одна нечитаемая последняя строка |

И4: причина остановки → событие, которое должно стоять перед `run-stopped` в том же Run (пусто — не требуется):

| `run-stopped.reason` | Событие перед ним |
| --- | --- |
| `turn-error`, `session-error` | `session-error` с текстом ошибки сценария |
| `limits-timeout` | `limits-hit` |
| `background-stalled` | `background-tasks` |
| `wave-unfinished` | — (стоп по `settle-timeout`, `cycle.ts:303`, своего события нет) |
| `blocked-tickets` | — (Ticket-ы — в `run-stopped.tickets`; `ticket-status` `blocked` проверяет И3) |
| `user-stop`, `user-force-stop` | — (Stop в состоянии `settling` останавливает сразу, без `run-stopping`: `gracefulStop`, `cycle.ts`) |
| нет `run-stopped` (убитое приложение) | — |

## Сценарии

| Сценарий | Сбой | Слой | Ожидание (кроме И1–И8) | Ticket |
| --- | --- | --- | --- | --- |
| API 500 посреди хода | `result` `is_error`, `API Error: 500 … api_error` | contract | `turn-error`, текст ошибки в `session-error` | 02 |
| API 529 посреди потока | `stream_event`, затем `result` `is_error` `overloaded_error` | contract | `turn-error`; не принят за Limits | 02 |
| Обрыв связи с API | `result` `is_error` «API Error: Connection error.» | contract | `turn-error` | 02 |
| Limits посреди хода Wave 2 | `rate_limit_event` rejected, затем `result` `is_error` | contract | `limits-hit`, `waiting-until`, по таймеру test-а — `resumed`; Wave 1 не уходит снова | 02 |
| Claude Code Orchestrator-а умер во время фоновой записи | `wait_release` при живых implementer-ах, затем `crash` «Claude Code process exited with code 1» | contract | `session-error`; задачи Run больше не ждёт | 03 |
| Implementer упал, Ticket остался `claimed` | `task_notification` `status: failed`, последний ход Orchestrator-а кончился без задач | contract | `wave-unfinished` после `settleMs` (`evaluate` → `settling` → `settle-timeout`); повтора Wave нет | 03 |
| Implementer упал, Orchestrator вернул Ticket в `open` | то же, test ставит 01 в `open` | contract | новая Wave только с 01 (`evaluate` → `send-wave`), не `no-progress` | 03 |
| gh висит | новый файл `hang` в `GH_STUB_DIR`; свой `PrTracker` с `ghRunner` (timeout `ms(500)`) и часами test-а | contract | Run идёт дальше, строк `narrow-round` нет, остановка не ждёт gh дольше `endReadMs` | 04 |
| gh отвечает 5xx | файл `fail` с «HTTP 502» | contract | то же | 04 |
| Конфликт merge | скрипт Orchestrator-а сообщает конфликт, test ставит Ticket в `blocked` | contract | `blocked-tickets`; следующий Run его не берёт | 04 |
| Приложение убито посреди Wave и запущено снова | `endApp` (SIGKILL) во время хода, затем `launchApp` с той же папкой данных | e2e | на старте сообщений Orchestrator-у нет; Run history показывает старый Run оборванным; кнопка стартует новый Run | 05 |
| GitHub недоступен весь Run | файл `fail` с текстом ошибки сети до старта | e2e | Run проходит Wave; бейджи PR не мешают кнопке и строке статуса | 05 |
| Codex: ход упал | `turn-failed.jsonl` fake Codex | contract | как API 500 | 06 |
| Codex: app-server умер | новый шаг fake Codex `{"exit": <code>}` посреди хода | contract | как умерший Claude Code Orchestrator-а | 06 |

## Где идёт набор

- Contract test-ы (`test/contract/autopilot-faults-*.test.ts`) импортируют `src/main/autopilot/run.ts`: по
  `scripts/affected-tests.mjs` (граф импортов, пункт 4 его шапки) они идут на каждом PR, который трогает Autopilot,
  в job-ах `linux-tests` и `windows`, и на каждом push в `main` — весь набор.
- e2e spec `test/e2e/autopilot-faults.spec.ts` идёт в `macos-e2e` и `windows-e2e`. На e2e Linux job-а нет
  (`.github/workflows/ci.yml`: e2e — macOS и Windows). Для `src/main/autopilot/**` в `scripts/e2e-specs.table.json`
  правила нет, поэтому PR, который трогает Autopilot, и так запускает все spec-файлы (`scripts/ci-scope.mjs:24-27`);
  push в `main` — тоже все. Spec открывает Run history и идёт через Link-сервис, как `autopilot.spec.ts`, поэтому
  Ticket 05 дописывает его в два правила таблицы, где уже стоит `autopilot.spec.ts`: правило Link (`src/main/link/…`)
  и `src/renderer/flight-recorder/**`.
- Пределы времени — правило этого Epic-а (ADR-0081 задаёт только бюджет Ticket-а 15 / 30 мин): e2e spec — не
  дольше 30 с по логу `macos-e2e` (`test/e2e/timings.json` хранит медианы CI по id run-ов; сейчас
  `autopilot.spec.ts` — 36.9 с на 11 test-ов, весь e2e — около 1690 с последовательно); каждый contract файл — не
  дольше 20 с по логу `linux-tests`. Сценарий, которому хватает contract-слоя, в e2e не идёт. Где запускать — вопрос Q1.

## Решено без владельца

1. **Только сторона test-ов.** Все сценарии собираются из существующих seams: поля `AutopilotDeps` (`run.ts`),
   директивы fake agent, Claude process stub, gh stub, `PrTracker`, fake Codex, `endApp`. `src/` этот Epic не
   правит; правятся только fixture-ы (gh stub — Ticket 04, fake Codex — Ticket 06). Если сценарию нужен seam внутри
   `run.ts` или файлов Limits — это новый Ticket, не правка внутри сценария (раздел «Риски», п. 2).
2. **Новые helper-модули, старые test-ы не переносятся.** `test/contract/autopilot-faults-setup.ts` повторяет
   сборку `harness()` из `autopilot-limits.test.ts:210`, `test/e2e/autopilot-world.ts` — `prepare`
   (`autopilot.spec.ts:161`), `messages`, `journalKinds`, `files`. Перенос старых test-ов на новые модули — не в этом
   Epic-е: он не нужен сценариям и тронул бы десятки test-ов ради одного рефакторинга. Все поля `faultRun`, нужные
   Ticket-ам 03, 04 и 06 (свой `PrTracker`, Vendor Orchestrator-а, Claude process stub для проверки процессов),
   кладёт Ticket 02, чтобы в Wave 3 setup никто не правил.
3. **И2 вместо «нет второго PR и merge».** worfy не делает PR и merge; их делает Orchestrator. С фейком их делать
   некому, поэтому правило проверяется с двух сторон: команда Wave одна (И1) и gh только читает (И2).
4. **И5 строгое:** ни `human-input`, ни `refused-dialog`. Отказ диалога в unattended Session проверяют свои test-ы.
5. **gh висит и Limits с resume — только contract.** Timeout gh — 30 с (`prs.ts:110`), запас resume — 2 мин
   (`RESUME_MARGIN_MS`, `src/shared/autopilot/resume-at.ts:14`). В собранном приложении часов, которыми управляет
   test, нет; добавить их — правка `run.ts` и файлов Limits, то есть `src/`.
6. **Сценарий не лечит.** Найденный дефект — новый Ticket этого Epic-а с подразделом «Инцидент» в «Итог»
   (процесс worfy-reliability 03). Сценарий становится его первым падающим test-ом.
7. **Снимков нет:** нового UI нет. Run history убитого Run-а проверяется по DOM в e2e, не по картинке.

## Новые термины

Предложение для `CONTEXT.md` (раздел `## Tests`), переносит Orchestrator:

- **Fault scenario** — test, который вносит один сбой (ошибка API, убитый процесс, недоступный GitHub, убитое
  приложение) в Run на fake agent над временным fixture-проектом и проверяет Recovery invariants. _Avoid_: chaos
  test, fault lab.
- **Recovery invariant** — правило, которое держится после любого Fault scenario (И1–И8): команда Wave одна,
  статус Ticket-а один раз, Journal называет причину, Run снова стартует. _Avoid_: «гарантия», health check.

## Ticket-ы

- **01 — Проверка правил восстановления.** `test/autopilot-invariants.ts` (И1–И8) и unit test на fixture-Journal-ах:
  хороший даёт пустой список, у каждого правила — свой испорченный вариант, который оно ловит. Blocked by: —.
- **02 — Contract setup и сбои API.** `autopilot-faults-setup.ts` (Autopilot на fake agent, Claude process stub,
  gh-world, свой `PrTracker`, Vendor Orchestrator-а, фиксированные часы — все поля для 03, 04, 06) и сценарии API 500, 529, обрыв связи, Limits в Wave 2. Blocked by: 01.
- **03 — Умерший Claude Code Orchestrator-а и упавший implementer.** Blocked by: 02.
- **04 — gh висит, 5xx и конфликт merge.** Режим `hang` в gh stub. Blocked by: 02.
- **05 — e2e: убитое приложение и GitHub без сети.** Blocked by: 01.
- **06 — Сбои на Orchestrator-е Codex.** Шаг выхода в fake Codex. Blocked by: 02 (и worfy-multi-vendor 37 — до старта Epic-а влит).
- **07 — Документация test-ов Autopilot и урок.** Вместо страницы Feature (Q6). Blocked by: 02, 03, 04, 05, 06.
- **08 — Приёмка с владельцем.** Blocked by: 01–07.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `test/autopilot-invariants.ts`, `test/unit/autopilot-invariants.test.ts`, `test/fixtures/autopilot-faults/` | 1 |
| 02 | `test/contract/autopilot-faults-setup.ts`, `test/contract/autopilot-faults-api.test.ts`, `test/fixtures/agent-scripts/autopilot-fault-api-500.jsonl`, `test/fixtures/agent-scripts/autopilot-fault-overloaded.jsonl`, `test/fixtures/agent-scripts/autopilot-fault-connection.jsonl` | 2 |
| 05 | `test/e2e/autopilot-world.ts`, `test/e2e/autopilot-faults.spec.ts`, `test/fixtures/agent-scripts/autopilot-fault-held.jsonl`, `scripts/e2e-specs.table.json` | 2 |
| 03 | `test/contract/autopilot-faults-process.test.ts`, `test/fixtures/agent-scripts/autopilot-fault-orchestrator-died.jsonl`, `test/fixtures/agent-scripts/autopilot-fault-implementer-failed.jsonl` | 3 |
| 04 | `test/contract/autopilot-faults-github.test.ts`, `test/fixtures/gh/gh-stub.mjs`, `test/fixtures/agent-scripts/autopilot-fault-conflict.jsonl` | 3 |
| 06 | `test/contract/autopilot-faults-codex.test.ts`, `test/fixtures/codex-scripts/autopilot-fault-turn-failed.jsonl`, `test/fixtures/codex-scripts/autopilot-fault-exit.jsonl`, `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/contract/codex-fake.test.ts` | 3 |
| 07 | `docs/features/autopilot.md`, `docs/features/ru/autopilot.md`, `docs/lessons/testing.md` | 4 |
| 08 | `.scratch/worfy-faults/spec.md` | 5 |

Правило плана: Ticket стоит в первой Wave, где закрыты все его блокеры; общий файл у двух Ticket-ов одной Wave —
Ticket с большим номером уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts:158`).

- **Wave 1 — 01.** Правила нужны всем сценариям.
- **Wave 2 — 02, 05.** Оба ждут только 01. 02 — contract, 05 — e2e; общих файлов нет, fixture-скрипты разные.
- **Wave 3 — 03, 04, 06.** Ждут setup из 02 и только импортируют его: все их поля кладёт 02. gh stub правит только
  04 (05 его читает, файл `fail` уже есть, и к этому времени влит); fake Codex и его test схем — только 06.
- **Wave 4 — 07.** Ждёт все сценарии.
- **Wave 5 — 08.** Владелец.

## Не в этом Epic-е

- **Автоповтор хода после API 500/529** — это поведение продукта, не test (Q3). Набор закрепляет нынешнее:
  остановка `turn-error` и новый старт. Автоповтор — Epic `worfy-retry` (решение владельца 2026-11-04, Q3).
- **Экран или «лаборатория» сбоев**, отчёт по сценариям в UI.
- **Настоящий Claude Code или Codex** с учётной записью владельца, сеть, платный eval.
- **Перенос старых test-ов** Autopilot на новые helper-модули (Решено без владельца, п. 2).
- **Seam часов в собранном приложении** для resume после Limits в e2e (п. 5) — только если владелец захочет e2e
  этого пути, отдельным Ticket-ом после worfy-multi-vendor 39.
- **Случайные сбои** (fuzzing, случайный момент SIGKILL): каждый сценарий детерминирован, иначе flaky test.

## Риски

1. **Fake не повторяет настоящий Claude Code.** Сценарий проверяет, что делает worfy при сбое такой формы, какую
   играет скрипт. Форму сообщений сверяет compatibility suite worfy-reliability 05; новая форма ошибки Claude Code
   ловится там, а не здесь.
2. **Пересечение с worfy-multi-vendor 37–39.** Epic стартует после merge 39. Если сценарию всё же нужен seam внутри
   `run.ts`, `journal.ts`, `budget.ts`, `resume-at.ts`, `limits-wait.ts` или `src/main/ipc/autopilot.ts`, исполнитель
   останавливается и Orchestrator заводит отдельный Ticket; параллельно с Ticket-ами worfy-multi-vendor эти файлы
   не правятся.
3. **Убитое приложение на Windows.** Playwright запускает Electron через `cmd.exe`; `endApp` убивает сначала PID
   приложения (`end-app.ts:53-66`). Если test всё же flaky — Quarantine со сроком (`test/quarantine.ts`), не
   увеличенный timeout (rules.md, «Timeout-ы test-ов не подстраивают по одному»).
4. **Живые процессы после test-а.** Claude process stub сам кончается через `STUB_LIFETIME_MS`, `stopAll()` в
   `afterEach`; e2e после SIGKILL ждёт, что процесс приложения ушёл (`endApp`). Агенты не оставляют фоновых
   процессов.
5. **Дублирование setup-а** (`autopilot-faults-setup.ts` рядом с `harness()` в `autopilot-limits.test.ts`): могут
   разойтись. Обе копии собирают настоящие `Autopilot`, `Orchestrators`, `SessionRegistry`; расхождение ловит
   typecheck при смене их конструкторов.
6. **Рост CI.** Новый e2e test — только когда сценарию нужен собранный app; иначе contract. Предел 30 с на e2e
   spec (правило этого Epic-а) проверяет Ticket 05 по логу `macos-e2e`.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-faults/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный
  `ci-ok` (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — по общему правилу (`rules-review-depth.md`;
  PR только с test-ами начинается с `medium`).
- **Сначала падающий test.** Для нового правила или сценария — показать, что test краснеет на испорченном входе
  (Journal с повтором, вторая команда Wave, лишний `ticket-status`) и зеленеет на настоящем; это пишется в «Итог».
- **Без токенов и без чужих учётных записей.** `WORFY_AGENT=fake`, `WORFY_CODEX=fake` с временным `CODEX_HOME`,
  gh — stub (`WORFY_GH`, `GH_STUB_DIR`), Project — временная git-папка; настоящие Claude Code и Codex не запускаются.
- **Только сторона test-ов:** `src/` не правится (Решено без владельца, п. 1). Дефект, найденный сценарием, — новый
  Ticket с «Инцидент» (п. 6).
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Тексты в коде test-ов — английские
  (ADR-0074).
- Timeout-ы — только через `ms()` (`test/time-scale.ts`); ожидание условия, не отсчёт по часам.
- Flaky test — Quarantine со сроком и Ticket-владельцем (`test/quarantine.ts`). Low findings не становятся Ticket-ами.
- Репозиторий публичный: в fixture-Journal-ах и логах нет путей домашней папки, имён машин, id учётных записей.
- Перед локальным `pnpm test:e2e` на Mac — `rules-local-e2e.md` (общий замок и проверка экрана).
- Язык: документы — русские, термины — латиницей из `CONTEXT.md`.

## Вопросы владельцу

1. **Q1. Где идёт набор.** (а) В обычном наборе: contract — на каждом PR, который трогает Autopilot (affected tests),
   e2e — во всех полных e2e (PR с Autopilot и каждый push в `main`); (б) отдельный ночной workflow по расписанию на
   бесплатных runner-ах; (в) только вручную. **Рекомендую (а):** contract-сценарии стоят секунды, e2e — до 30 с;
   ночной job ловит дефект на день позже, а ручной запуск забывают. **Владелец 2026-11-04: (а).**
2. **Q2. Слои.** (а) Большинство сценариев — contract с часами test-а, e2e — только убитое приложение и GitHub без
   сети; (б) всё в e2e. **Рекомендую (а):** (б) требует seam часов в `run.ts` и Limits (файлы worfy-multi-vendor) и
   добавляет 3–5 мин к каждому полному e2e. **Владелец 2026-11-04: (а).**
3. **Q3. Автоповтор хода после API 500/529.** (а) Нет: набор закрепляет остановку `turn-error` и новый старт;
   (б) завести отдельный Epic «повтор хода» позже. **Рекомендую (а) сейчас:** повтор хода может повторить внешнее
   действие (commit, merge) — то, от чего защищает worfy-reliability 01; решение о (б) — отдельно.
   **Владелец 2026-11-04: (а)** — этот Epic закрепляет остановку `turn-error`. Автоповтор хода после ошибок API
   вынесен в отдельный Epic `worfy-retry` вместе с автопродолжением после окна usage limit — переключатель в чате
   Orchestrator-а, как Eco mode; его черновик пишется отдельно.
4. **Q4. Найденный дефект.** (а) Новый Ticket этого Epic-а с «Инцидент», сценарий — его первый падающий test,
   сценарный Ticket ждёт его; (б) чинить в том же PR, если правка мала. **Рекомендую (а):** Epic не правит `src/`,
   а файлы Autopilot заняты worfy-multi-vendor. **Владелец 2026-11-04: (а).**
5. **Q5. Сценарии на Codex (Ticket 06).** (а) В этом Epic-е, два сценария; (б) позже, отдельно. **Рекомендую (а):**
   Autopilot на Codex — новый путь worfy-multi-vendor 37, и сбоев на нём не проверял никто. **Владелец 2026-11-04: (а).**
6. **Q6. Документация.** Набор test-ов не меняет поведения, страница Feature ему не нужна. (а) Строка в таблице
   `#### Tests` страницы `docs/features/autopilot.md` и урок в `docs/lessons/testing.md` «сбой Autopilot-а → Fault
   scenario»; (б) отдельная страница `docs/features/autopilot-faults.md`. **Рекомендую (а):** страница Feature
   описывает поведение для пользователя; правила восстановления — часть «Tests» у Autopilot. **Владелец 2026-11-04: (а).**
7. **Q7. Приёмка.** (а) Вердикт — зелёные job-ы CI на macOS и Windows на SHA последнего merge (ADR-0071) и одна ручная
   проверка на Mac Stable: убить worfy посреди Run на демо-проекте, увидеть оборванный Run и новый старт; (б) без
   ручной проверки. **Рекомендую (а):** ручная проверка за пять минут подтверждает, что e2e убивает приложение так
   же, как это бывает на деле. **Владелец 2026-11-04: (а).**

## Готово, когда

- [ ] `test/autopilot-invariants.ts` проверяет И1–И8; у каждого правила есть испорченный fixture, который оно ловит (01).
- [ ] Все сценарии таблицы «Сценарии» есть и зелёные на Linux, macOS и Windows; каждый зовёт проверку правил (02–06).
- [ ] `src/` не изменён ни одним PR Epic-а.
- [ ] e2e spec не дольше 30 с по логу `macos-e2e`, каждый contract файл — не дольше 20 с по логу `linux-tests`
      (пределы этого Epic-а).
- [ ] Таблица «Tests» в `docs/features/autopilot.md` и урок в `docs/lessons/testing.md` (07).
- [ ] Приёмка владельца (08).
