# 01 — Сообщение в Session в состоянии error ждёт выхода старого процесса Claude Code

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Находки», находка correctness-1; [ADR-0064](../../../docs/adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)

Глубина review — `high` (code PR, первый круг). Не платформенный PR: в `src/main/agent/session.ts` и
`src/main/agent/session/process.ts` нет веток по платформе.

## Что делаем

На коммите аудита `42372355b` сообщение в Session, которая перешла в состояние `error`, сразу запускает новый процесс
Claude Code на той же Vendor session, хотя старый процесс может быть ещё жив:

- `src/main/agent/session.ts:547` — `deliver()`: `if (this.stateValue === 'error' || this.run === null) this.begin()`.
  Ни `after`, ни ожидания `exited()`.
- `src/main/agent/session.ts:601-631` — `begin()` возобновляет `this.sdkSessionId` (`:609`) через `sessions.resume`.
- `src/main/agent/session.ts:696-717` — `fail()` только вызывает `run.handle?.close()`. Комментарий там же говорит, что
  процесс может быть жив: подписчик бросил исключение на его событии.
- `src/main/agent/session/process.ts:10-16` — `close()` SDK закрывает stdin, шлёт SIGTERM через 2 s и SIGKILL ещё через
  5 s. Старый процесс может пережить `close()` на время до 7 s.

Сценарий: sink подписчика (`onEvent` в `src/main/agent/node-sessions.ts:381` или `src/main/agent/orchestrator.ts:714`)
бросает исключение, пока идёт tool. Session переходит в `error`. Пользователь в ближайшие секунды пишет снова. Второй
процесс возобновляет тот же transcript, пока первый ещё пишет в него. ADR-0064 это запрещает. Relaunch Orchestrator-а
уже ждёт выхода старого процесса (`oldExit`, `src/main/agent/orchestrator.ts:837-847`), а этот путь — нет.

Что меняется: если `deliver()` стартует из `error` и в наборе `alive` (`src/main/agent/session.ts:153`, пополняет
`watch()` на `:634-638`) остались процессы, новый старт ждёт их выхода с той же границей, что у `exited()` (`:286`,
`EXIT_WAIT_MS` и SIGKILL после неё). Пока он ждёт, сообщение стоит в очереди, как при `start(after)` (`:257-271`).

Границы: relaunch и `exited()` для закрытой Session не меняются. Находка correctness-2 (`finish()` в
`src/main/vendors/claude/session.ts:471-477` не закрывает query) остаётся LOW вне этого Ticket-а: её процесс тоже лежит в
`alive`, так что это ожидание снимает и её последствие.

## Готово, когда

- [ ] Contract test: fake query, чей `close()` оставляет процесс живым N ms, и `send()` в состоянии `error`. Второй
      вызов `start`/`resume` driver-а происходит только после выхода первого процесса.
  - evidence: test-run pass · `pnpm test test/contract/session-handle-lifecycle.test.ts` exit 0 · mac - · 082997eb1
- [ ] Contract test: процесс, который не выходит, получает SIGKILL после границы, и новый старт идёт после этого;
      сообщение не теряется и уходит в новый процесс.
  - evidence: test-run pass · `pnpm test test/contract/session-handle-lifecycle.test.ts` exit 0 · mac - · 082997eb1
  - evidence: gate pass · `gate fast` exit 0 · mac - · 082997eb1
- [ ] Существующий test `test/contract/session-handle-lifecycle.test.ts:94` («a subscriber that throws fails the
      Session and closes its query; the next message starts the only live one») зелёный.
  - evidence: test-run pass · `pnpm test test/contract/session-handle-lifecycle.test.ts` exit 0 · mac - · 082997eb1

## Тесты

- `test/contract/session-handle-lifecycle.test.ts` — критерии 1, 2, 3 (extend)

## Где в коде

- `src/main/agent/session.ts` — `deliver()` (`:547`), `begin()` (`:601`), `start(after)` (`:257`), `exited()` (`:286`),
  набор `alive` (`:153`).
- `src/main/agent/session/process.ts` — `EXIT_WAIT_MS`, `KILL_EXIT_MS`.
- `src/main/agent/orchestrator.ts` — `oldExit` в relaunch (`:837-847`), образец ожидания.
- `test/contract/session-handle-lifecycle.test.ts` — test-ы жизненного цикла handle.

## Итог

- Сначала падающий: четыре новых test-а в `test/contract/session-handle-lifecycle.test.ts` до исправления красные —
  `start 2` шёл сразу после `close 1`, до `exit 1`; Session, закрытая во время ожидания, всё равно запускала процесс 2.
- Исправление — `begin()` в `src/main/agent/session.ts`: если в наборе `alive` остались процессы Session, вызов
  `start`/`resume` driver-а идёт только после их выхода, с той же границей, что у `exited()`: `EXIT_WAIT_MS`, затем
  SIGKILL и ещё `KILL_EXIT_MS`. Ожидание и SIGKILL вынесены из `exited()` в общий `endProcesses()`; `exited()` ведёт
  себя как прежде. Пока Session ждёт, сообщение лежит в `run.waiting` (как сообщение, отправленное во время обычного
  старта), а не в видимой очереди: состояние `busy`, prompt показан сразу. Session, закрытая во время ожидания,
  процесс не запускает. Без живых процессов старт синхронный, как раньше.
- Test-ы: fake process (pid самого test-а, выход только по событию `exit`, SIGTERM и `close()` его не завершают) за
  каждым fake query. Критерий 1 — процесс жив 300 ms после второго сообщения, второго старта нет; после `exit 1` —
  `start 2`, resume того же Vendor session, сообщение `again` у процесса 2. Критерий 2 — SIGKILL не раньше границы
  (в test-е `EXIT_WAIT_MS` = 500 через `vi.mock`), потом `start 2` и сообщение у процесса 2. Ещё два: Session,
  закрытая во время ожидания, не стартует; провал `accountInfo` до первого сообщения.
- Находка correctness-2 (LOW, `finish()` в `src/main/vendors/claude/session.ts` обнуляет query, и `close()` не
  доходит до процесса) кодом не правилась, но её последствие снято: такой процесс лежит в `alive`, следующий старт ждёт
  его и убивает по границе — это проверяет test «a failed start check whose close does not reach the process».
- `test/contract/orchestrator-relaunch.test.ts` (вне «Где в коде»): в test-е «the same Session and process go on
  attended…» строка `fake: exit` завершала query, но не stub-процесс за ним, и новый процесс стартовал рядом с живым —
  та самая форма дефекта. Теперь test завершает stub-процесс (`stopAll()`) перед следующим сообщением, как его
  завершил бы выход Claude Code.
- `docs/features/sessions.md`, «A crash»: следующий процесс ждёт выхода старого, SIGKILL через 7,5 s.
- Review, круг 1 (REJECTED, medium): сообщение, ждущее в `run.waiting`, не видели `handOverQueue()` и `keep()`.
  Relaunch Orchestrator-а во время ожидания (Force stop, `giveBackNow`, Start now) закрывал Session и терял его.
  Выбрано: `handOverQueue()` отдаёт и сообщения из `run.waiting` — они ещё не дошли ни до одного процесса, —
  первыми, перед очередью, с флагом `paused` очереди. Второй путь (класть сообщение в видимую очередь) отброшен: в
  `error` очередь на паузе после `fail()`, и сообщение в ней не ушло бы без «Send queued», а снятие паузы отпустило бы
  и старые удержанные сообщения. Цена выбранного пути: если в очереди были удержанные сообщения, переданное сообщение
  в новой Session тоже удержано (виден в очереди, не потерян). Других путей, которые забирают очередь при relaunch,
  нет: `takeNow` и `relaunch` оба идут через `handOverQueue()`. Заодно это закрывает ту же потерю для сообщения,
  отправленного во время обычного старта процесса.
- Test-ы круга 1: «the message that waits is handed to the person's Session and goes to its process, after the old
  one exited» (`test/contract/orchestrator-relaunch.test.ts`) — сценарий review целиком: Session run-а в `error` с
  живым процессом, сообщение ждёт, `giveBackNow` → сообщение у процесса 3, после SIGKILL процесса 2; «a message that
  waits for the old process is handed over with the queue; the closed Session starts nothing» и «a start that fails
  after the wait fails the Session with its reason» (`test/contract/session-handle-lifecycle.test.ts`).
- Текст warning-а в `endProcesses()` теперь передаёт вызывающий: «after the close» для `exited()`, «after its next
  process was asked for» для `begin()`. Условие после ожидания — одно `this.run !== run`: `close()` обнуляет run.
- Mutation-проверка: без проверки закрытия краснеет test закрытия во время ожидания; без ожидания (граница 0) краснеют
  test-ы критериев 1 и 2; `handOverQueue()` без `run.waiting` — краснеют оба test-а передачи (exit 1); проглоченный
  отказ старта после ожидания — краснеет test отказа (exit 1).
- Проверки круга 1: test-ы, импортирующие Session, driver Claude и Orchestrator (89 файлов), — exit 0; `pnpm lint &&
  pnpm typecheck && pnpm test` и gate fast — в отчёте implementer-а с exit code.
