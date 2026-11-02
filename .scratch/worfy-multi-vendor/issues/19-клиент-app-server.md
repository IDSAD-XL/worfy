# 19 — Клиент app-server Codex

Type: task
Status: claimed 2026-11-02T19:11Z
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
- `src/main/vendors/codex/launch.ts` (Ticket 18; только вызов)
- `test/unit/codex-rpc.test.ts`, `test/contract/codex-app-server.test.ts` (новые)

Только читать: `src/main/agent/session/types.ts:30-36`, `src/main/agent/session/process.ts`.
