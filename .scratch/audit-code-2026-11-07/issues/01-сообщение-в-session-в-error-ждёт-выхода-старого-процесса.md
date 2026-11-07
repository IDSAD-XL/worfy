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
- [ ] Contract test: процесс, который не выходит, получает SIGKILL после границы, и новый старт идёт после этого;
      сообщение не теряется и уходит в новый процесс.
- [ ] Существующий test `test/contract/session-handle-lifecycle.test.ts:94` («a subscriber that throws fails the
      Session and closes its query; the next message starts the only live one») зелёный.

## Тесты

- `test/contract/session-handle-lifecycle.test.ts` — критерии 1, 2, 3 (extend)

## Где в коде

- `src/main/agent/session.ts` — `deliver()` (`:547`), `begin()` (`:601`), `start(after)` (`:257`), `exited()` (`:286`),
  набор `alive` (`:153`).
- `src/main/agent/session/process.ts` — `EXIT_WAIT_MS`, `KILL_EXIT_MS`.
- `src/main/agent/orchestrator.ts` — `oldExit` в relaunch (`:837-847`), образец ожидания.
- `test/contract/session-handle-lifecycle.test.ts` — test-ы жизненного цикла handle.
