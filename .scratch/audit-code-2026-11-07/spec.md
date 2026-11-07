# Аудит кода 2026-11-07 — линзы correctness и test-gaps

Status: ready-for-agent
Коммит аудита: `42372355bb9f275313bf009f4c3e4c395f0008fd`
Линзы: `correctness` (четыре области) и `test-gaps`, один прогон по решению владельца 2026-11-07. Security не входит:
её аудит прошёл отдельно в тот же день (`.scratch/audit-security-2026-11-07/`). Находки HIGH и MED — в Ticket-ы аудита,
LOW — только в таблицу. В Profile в `audit_lenses` только `documentation`; Profile не правили, набор линз задан в брифе
Orchestrator-а.

## Что проверено

Пять агентов `worfy:scout` (только чтение), все в одном сообщении:

1. **Autopilot: run, cycle, очередь** — `src/main/autopilot/`, `src/shared/autopilot/`: дыры в state machine, гонки
   stop, start и limits, восстановление по journal.
2. **Session-ы и Vendor-ы** — `src/main/agent/`, `src/main/vendors/`: жизненный цикл, resume, пути ошибок, утечки
   listener-ов и процессов.
3. **Canvas, layout, Card-ы** — `src/main/layout/`, `src/main/cards/`, `src/renderer/canvas/`: потерянные записи,
   наложения, undo.
4. **Link, update, storage** — `src/main/link/`, `src/main/update/`, `src/main/storage/`: частичные записи, rollback,
   переподключение.
5. **test-gaps** — guard-ы, которые останавливают отправку без человека; разрушительные действия (удаление файлов, kill
   процессов, замена копий); записи карантина и пропущенные test-ы (`test/quarantine.ts`), которые прячут дефект.

Каждую находку перепроверил агент `worfy:reviewer`, который её не писал: один — области 2 и 3, второй — область 4,
третий — test-gaps, четвёртый — область 1. Они перечитали строки ±20, искали guard выше по цепочке вызовов и гоняли
отдельные test-файлы. Orchestrator сам перечитал строки всех трёх находок MED.

Прошлый аудит (`audit-2026-10-31`) был по линзе `documentation`; старых находок у этих линз нет.

## Что подтверждено как исправное

- Атомарная запись через временный файл и rename: `src/main/storage/json-file.ts:88-95`, `src/main/link/secrets.ts:97-105`,
  `restoreRecord` в `src/main/update/restart.ts`; на ней layout и данные Card.
- Debounce у NoteNode сбрасывается на `beforeunload`, `pagehide` и unmount; таймеры CardStore защищены `closed` и
  `watchers.has`; `History.run` идёт очередью и обрабатывает устаревшие шаги; `archive.run` перечитывает Layout перед записью.
- Link: pending-вызовы `LinkConnection` закрываются при обрыве, у каждого свой timeout; у `LinkConnections` один таймер
  переподключения на peer, listener-ы не копятся, `stop()` отписывается; `swapIn` в `scripts/install-stable.mjs`
  возвращает старую копию при сбое.
- Session-ы: путь старта и закрытия Codex, таймеры rpc, PermissionGate, park, relaunch и startOver Orchestrator-а, выбор
  id для resume, отзыв MCP grant.
- Test-ы есть у причин остановки Autopilot (limits-timeout, window-too-short, vendor-quota, start-refused), у отказов
  очереди, у всех hard deny и правил deny auto-approval, у `removeTree`, kill Terminal (SIGHUP, SIGKILL), kill скриптов
  Harness, guard-а пользовательских файлов Codex agents, отказа `under()` вне корня и `sweepRunTemps`.
- Восстановления run-а Autopilot по journal после сбоя в коде нет, и так задумано: journal только дописывается, у
  упавшего run-а нет строки `run-stopped`, читатель переживает обрезанный хвост (`src/shared/autopilot/journal.ts:388`).

## Находки

| № | Severity | Адрес | Сценарий и неверный результат | Проверка | Вердикт фазы 2 | Куда |
|---|---|---|---|---|---|---|
| correctness-1 | MED | `src/main/agent/session.ts:547` | Подписчик бросил исключение на событии, Session ушла в `error`, `fail()` вызвал `close()` (SDK: SIGTERM через 2 s, SIGKILL ещё через 5 s). Новое сообщение в ближайшие секунды сразу вызывает `begin()` и возобновляет тот же `sdkSessionId` (`:609`) вторым процессом рядом с живым первым — два процесса пишут один transcript (ADR-0064). Relaunch ждёт `oldExit` (`src/main/agent/orchestrator.ts:837-847`), этот путь — нет | `sed -n 543,549p src/main/agent/session.ts; sed -n 696,712p src/main/agent/session.ts; sed -n 10,16p src/main/agent/session/process.ts` | confirmed, MED; Orchestrator перечитал. Существующий test `test/contract/session-handle-lifecycle.test.ts:94` использует fake с мгновенным `close()` | Ticket 01 |
| correctness-2 | LOW | `src/main/vendors/claude/session.ts:471` | `finish()` → `end()` (`:477`) обнуляет `queryValue` без `close()`; при отклонённом `accountInfo` до первого сообщения `close()` ничего не делает | `sed -n 336,343p src/main/vendors/claude/session.ts; sed -n 470,481p src/main/vendors/claude/session.ts` | confirmed, понижено MED→LOW: SDK сам закрывает stdin при ноле отправленных сообщений, новая Session при следующем `send()` берёт новый id. Исправление correctness-1 снимает и её последствие | только таблица |
| correctness-3 | LOW | `src/main/vendors/codex/session.ts:327` | `interrupt()` ждёт всю цепочку `sending`; при зависшем app-server Codex Stop висит до 60 s на каждый запрос | `sed -n 325,336p src/main/vendors/codex/session.ts; sed -n 21,24p src/main/vendors/codex/rpc.ts` | confirmed, LOW: только при уже зависшем app-server; `halt()` Autopilot не задет | только таблица |
| correctness-4 | LOW | `src/main/autopilot/run.ts:1804` | `stopAll()` обходит только `this.runs`; старт, прошедший проверку `quitting` (`:1127`), но ещё не в `runs` (`:1184`), после выхода всё равно ставит Wave | `sed -n 1124,1128p src/main/autopilot/run.ts; sed -n 1804,1815p src/main/autopilot/run.ts` | confirmed, LOW: окно — секунды relaunch при выходе во время старта | только таблица |
| correctness-5 | LOW | `src/main/autopilot/run.ts:1181` | `take()` бросает после `openJournal` — `release` и повторный throw без строки `run-stopped` | `sed -n 1176,1183p src/main/autopilot/run.ts` | confirmed, LOW: journal выглядит как после сбоя, читатель это переживает | только таблица |
| correctness-6 | LOW | `src/main/update/build.ts:396` | Предел времени только у шагов `git`; зависший postinstall или electron-builder держит Update в `building` до перезапуска worfy | `sed -n 392,402p src/main/update/build.ts` | confirmed, понижено MED→LOW: у pnpm fetch-timeout 60 s и 2 повтора, у `fetch` Node timeout 300 s; блокируется только Update, `recover()` чинит при старте | только таблица |
| correctness-7 | LOW | `src/main/update/build.ts:243` | Бросок `changeUpdateState` при финальной записи оставляет в файле `building` до перезапуска | `sed -n 238,252p src/main/update/build.ts` | confirmed, LOW: нужен полный диск или отказ прав | только таблица |
| correctness-8 | LOW | `scripts/install-stable.mjs:1187` | В `rollBack` перенос метаданных после swap; при сбое `<name>.json` называет новый commit, хотя работает старая копия | `sed -n 1170,1192p scripts/install-stable.mjs` | confirmed, LOW: `fail()` прямо называет незаменённый файл | только таблица |
| correctness-9 | LOW | `src/main/link/service.ts:746` | `commitLink` сначала меняет секрет `outgoing:<id>`, потом `setLevel` и `store.put`; их сбой при повторной привязке даёт 401 и `forget` машины | `sed -n 742,766p src/main/link/service.ts` | confirmed, LOW: повторная привязка плюс сбой записи на диск; лечится новой привязкой | только таблица |
| correctness-10 | LOW | `src/main/layout/trash.ts:338` | `removeTree` в конце `restore()` вне try: Node и Card уже возвращены, а `restore()` бросает, undo теряет шаг | `sed -n 326,340p src/main/layout/trash.ts` | confirmed, LOW: на Windows `removeTree` сам повторяет 5 × 100 ms (`src/main/storage/remove.ts:141-144`) | только таблица |
| correctness-11 | LOW | `src/main/layout/store.ts:524` | После неудачной записи `layout.json` повторного таймера нет; изменение живёт в памяти до следующей правки или выхода | `sed -n 515,531p src/main/layout/store.ts` | confirmed, LOW: так написано в doc-комментарии («retried on the next change»), теряется только при сбое процесса до следующей правки | только таблица |
| test-gaps-1 | MED | `src/main/agent/orchestrator.ts:534` | Отказ unattended-старта, когда `deps.capabilities` бросает, не проходит ни один test: stub-ы всегда отвечают успехом (`test/contract/codex-orchestrator.test.ts:301`, `:562`, `test/contract/autopilot-faults-setup.ts:405`). Замена catch на `return null` пустит Autopilot на Vendor без прочитанных гарантий, test-ы зелёные | `sed -n 531,536p src/main/agent/orchestrator.ts; grep -rn "could not read what" test` | confirmed, MED; не HIGH: сегодня оба driver-а ловят ошибки сами | Ticket 02 |
| test-gaps-2 | MED | `src/main/agent/orchestrator.ts:365` | Три отказа `setUnattended` (turn, живые task-и, очередь; `:365`, `:370`, `:371`) не утверждает ни один test, тексты `ORCHESTRATOR_IN_TURN` и `ORCHESTRATOR_HAS_QUEUE` есть только в stub-е renderer-test-а `test/unit/canvas-actions.test.tsx:597`, `:611`, `:632`, текста `ORCHESTRATOR_HAS_TASKS` нет ни в одном test-е. Удаление трёх throw оставит test-ы зелёными | `sed -n 365,371p src/main/agent/orchestrator.ts; grep -rnE "ORCHESTRATOR_(IN_TURN\|HAS_TASKS\|HAS_QUEUE)" test` | confirmed, MED; вывод чтением, мутацию reviewer не запускал (бриф запрещал писать файлы) | Ticket 02 |
| test-gaps-3 | MED | `test/quarantine/*.json` (11 записей), `test/quarantine.ts:196-198` | 11 из 13 записей карантина истекают 2026-11-12, их owner Ticket-ы закрыты (`worfy-polish/41`, `worfy-throughput/44`, `/55`). С 2026-11-13 `test/unit/quarantine.test.ts:55-59` краснеет, а push в main гоняет весь набор (`.github/workflows/ci.yml:27-28`): CI main красный, владельца у починки нет | `for f in test/quarantine/*.json; do jq -c '{owner,until}' "$f"; done; sed -n 196,198p test/quarantine.ts` | confirmed, поднято LOW→MED: детерминированно красный main на обычном пути | Ticket 03 (срочно) |

Отброшены на перекрёстной проверке:

| Находка автора | Адрес | Почему отброшена |
|---|---|---|
| Autopilot, MED | `src/main/autopilot/run.ts:2260` | `registry.get` не бросает: `newUnattendedSession` возвращает null, если Session закрылась до старта (`src/main/agent/orchestrator.ts:452`), а между `return view` и `get` только microtask-и |
| Autopilot, MED | `src/main/autopilot/run.ts:2120` | Ни один названный источник броска не бросает: настройки — кэш в памяти (`src/main/settings/store.ts:367-376`), `limits.state()` — `snapshot()`, поле в памяти (`src/main/agent/limits.ts:95-96`) |
| Autopilot, LOW | `src/main/autopilot/run.ts:2612` | Последовательности событий, где результат хода приходит в фазе `tasks` без `busy`, не нашлось: каждый ход начинается с idle→busy (`src/main/agent/session.ts:754`, `:763`) |
| link, LOW | `src/main/link/log-file.ts:95` | Так задумано: шапка файла `:12-13` говорит, что журнал, который не пишется, замолкает |
| test-gaps, MED | `src/main/agent/orchestrator.ts:548` | Покрыто: test `test/contract/codex-orchestrator.test.ts:551` передаёт `trust`, который бросает, и ждёт отказ hooks; прогнан, exit 0 |

Общий catch в `Run.enqueue` (`src/main/autopilot/run.ts:983`), который при броске останавливает цикл, reviewer назвал
защитной мерой уровня LOW; в Ticket не идёт.

| Линза или область | Проверено | Подтверждено | Отброшено | Доля ложных |
|---|---|---|---|---|
| correctness — Autopilot | 5 | 2 | 3 | 0,6 |
| correctness — Session-ы и Vendor-ы | 3 | 3 | 0 | 0 |
| correctness — Canvas и Card-ы | 2 | 2 | 0 | 0 |
| correctness — Link, update, storage | 5 | 4 | 1 | 0,2 |
| test-gaps | 4 | 3 | 1 | 0,25 |

Для брифа следующего аудита: область Autopilot дала долю ложных выше трети. Обе её MED строились на «этот вызов может
бросить» без проверки, может ли он бросить на деле. В бриф добавить: для каждого источника исключения назвать, при каком
вводе он бросает. Severity две находки авторы завысили (correctness-2, correctness-6), одну занизили (test-gaps-3).

## Дубликаты

| Находка | Вердикт | Где |
|---|---|---|
| correctness-1 | new | открытых Ticket-ов по `src/main/agent/session.ts` про этот путь нет |
| test-gaps-1, test-gaps-2 | new | открытых Ticket-ов по `src/main/agent/orchestrator.ts` нет |
| test-gaps-3 | new | `worfy-polish/47` (flaky test-ы Windows в gate full) открыт, но ни одну из 11 записей не называет; пять записей только для darwin в его рамки не входят |
| `src/main/link/store.ts:30` (`version: z.literal(1)`: старая сборка теряет `linked.json`) | already in work: `worfy-polish/63` | Ticket велит пройти списком все store поверх `readJsonFile` (`.scratch/worfy-polish/issues/63-старая-сборка-не-откладывает-state-файлы-новой.md:36`) |

Открытые Ticket-ы собраны `epic-status --json` по main и по веткам с commit-ами за три дня: Ticket-ов только на ветках
нет. Находки LOW по правилу владельца в Ticket-ы не идут, дубликаты для них не искали.

## Waves

| Ticket | Файлы (раздел «Где в коде») | Migration | Wave |
|---|---|---|---|
| 03 | `test/quarantine/*.json`, `test/quarantine.ts`, `test/unit/quarantine.test.ts`, `test/unit/affected-tests.test.ts`, `.scratch/worfy-polish/issues/41-flaky-test-ы-windows-после-пересчёта.md` | no | 1 (срочно, до 2026-11-12) |
| 01 | `src/main/agent/session.ts`, `src/main/agent/session/process.ts`, `src/main/agent/orchestrator.ts`, `test/contract/session-handle-lifecycle.test.ts` | no | 1 |
| 02 | `src/main/agent/orchestrator.ts`, `test/contract/codex-orchestrator.test.ts`, `test/contract/orchestrator-relaunch.test.ts` | no | 1 |

Ticket 01 и 02 оба называют `src/main/agent/orchestrator.ts`, но ни один его не меняет: 01 берёт оттуда образец
ожидания, 02 пишет test-ы против него. Поэтому все три идут в одной Wave.

## Что не проверено

- Прохода по dev stack нет: в Profile нет `dev_stack`; бриф запрещал запуск worfy и настоящего бинарника Codex.
- correctness-1 выведен чтением кода и SDK 0.3.289; второй процесс рядом с живым первым не воспроизведён. Выходит ли CLI
  Claude Code по EOF на stdin после ошибки initialize, не проверено: бинарник закрытый.
- Мутацию для test-gaps-1 и test-gaps-2 не запускали; её делает Ticket 02 в своих критериях.
- Гоняет ли job `windows` весь набор на каждом PR — от этого зависит, покраснеют ли с 2026-11-13 и PR, а не только main.
- Прочитаны частично: `src/main/autopilot/run.ts` (около 1100–3375 из 3424 строк), `src/main/agent/orchestrator.ts`,
  `src/renderer/canvas/history.ts`, `src/main/link/service.ts`, `src/main/update/build.ts`. Только grep: остальной
  `src/renderer/canvas`, `src/main/cards/protocol.ts`, `src/main/cards/remote.ts`, `src/main/link/discovery.ts`,
  `server.ts`, `pairing.ts`, `src/main/storage/remove.ts`, `src/main/vendors/codex/subagents.ts`, `launch.ts`, `history.ts`.
- Пропущенные test-ы вне `test/quarantine/` (`it.skip`, `skipIf`, `test.fixme`) scout test-gaps по отдельности не
  перечислил.
