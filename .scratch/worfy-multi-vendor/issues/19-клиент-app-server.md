# 19 — Клиент app-server Codex

Type: task
Status: done 2026-11-02T21:37Z
PR: #1256
Blocked by: 17, 18
Source: [spec.md](../spec.md), «Codex: бинарник и совместимость» (процесс на Session, без experimental), «Windows» (процесс); решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), «Как встраивать», «Главный риск»); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что делаем

1. `src/main/vendors/codex/rpc.ts` — JSON-RPC 2.0 поверх строк stdio: request с id и ответ, notification-ы,
   server→client request-ы с ответом worfy, ошибки JSON-RPC, время ожидания ответа. Каждое входящее сообщение
   проверяется `ajv` по сгенерированной JSON Schema (`protocol/json/`, Ticket 17); не прошедшее — событие `unknown`
   с именем метода и запись в log, а не исключение. Типы TypeScript — из `protocol/ts/`. Чистый модуль: вход и
   выход — строки.
2. `src/main/vendors/codex/app-server.ts` — процесс: запуск через `launch.ts` (Ticket 18) без shell, `initialize`
   с `clientInfo.name = 'worfy'` и без `experimentalApi`, затем `initialized`; stderr сохраняется, чтобы объяснить
   падение; `close()` ждёт выхода процесса, как `ClaudeCodeProcess` (`src/main/agent/session/types.ts:30-36`);
   падение процесса — ошибка всем ждущим request-ам.
3. Один процесс на Session; общего процесса нет (ADR-0094, Considered Options).

Глубина review — `high` (driver Codex). Платформенный: запуск и остановка процесса на Windows.

## Готово, когда

- [ ] Unit test `rpc.ts`: сообщение, которое не проходит схему, даёт `unknown`, а не исключение.
- [ ] Unit test `rpc.ts`: ответ находит свой request при перемешанных notification-ах; server→client request
      получает ответ; битая строка — ошибка, а не исключение; время ожидания — отказ с понятным текстом.
- [ ] Contract test на фейке: `initialize` с `clientInfo.name = 'worfy'`; фейк, упавший посреди хода, даёт ошибку
      ждущим request-ам; `close()` ждёт выхода.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/rpc.ts`, `src/main/vendors/codex/app-server.ts` (новые)
- `src/main/vendors/codex/launch.ts` (Ticket 18): вызов и guard от настоящего Codex — `VITEST` читается и из
  `process.env`, не только из переданного `env` (low-находка ревью Ticket-а 18)
- `test/unit/codex-rpc.test.ts`, `test/contract/codex-app-server.test.ts` (новые)
- `test/contract/codex-fake.test.ts`: test пути к настоящему бинарнику сам выключает `VITEST` (stub), иначе его
  останавливает новый guard

Только читать: `src/main/agent/session/types.ts:30-36`, `src/main/agent/session/process.ts`.

## Итог

- `rpc.ts` — чистый модуль JSON-RPC поверх строк; входящее сообщение проверяется `ajv` по схеме pinned Codex,
  не прошедшее — событие `unknown`, битая строка — событие `error`, ни то ни другое не бросает исключение.
- `app-server.ts` — процесс на Session через `launch.ts` без shell; `initialize` с `clientInfo.name = 'worfy'` и
  `capabilities: null` (без `experimentalApi`), затем `initialized`. Выход процесса отклоняет все ждущие request-ы
  ошибкой `CodexAppServerExit` с exit code и концом stderr; `close()` закрывает stdin и ждёт выхода, SIGKILL —
  после `EXIT_WAIT_MS`.
- Круг 2 (находки verifier-а, три пробела в test-ах; код `app-server.ts` не менялся) — contract test-ы в
  `test/contract/codex-app-server.test.ts`:
  - процесс, который не запустился (spawn несуществующего файла: только `error` и `close`, без `exit`), — `start()`
    отклоняется с «did not start» сразу, а не по времени ожидания `initialize`;
  - фейк закрыл свой stdin и жив — запись worfy получает EPIPE при `writable === true`; это warning, не
    uncaught error. Preload test-а закрывает fd 0 явно: `process.stdin.destroy()` его не закрывает;
  - `initialize` отвечен ошибкой — после отказа `start()` процесс уже вышел (exit code 0, по закрытию stdin).
  Каждый из трёх test-ов краснеет на своём mutant-е `app-server.ts` (строки 100, 87, 118). `afterEach` убивает по pid
  процесс, который test оставил живым, — без этого mutant строки 118 оставлял бы фейк после прогона.
- Не проверено: Windows (scope `pc`, gate full на ПК после Wave) — в частности, что `closeSync(0)` в preload на
  Windows закрывает читающий конец pipe-а и запись даёт EPIPE.
