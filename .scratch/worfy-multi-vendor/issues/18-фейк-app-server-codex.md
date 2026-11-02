# 18 — Фейк app-server Codex (`WORFY_CODEX=fake`)

Type: task
Status: open
Blocked by: 17
Source: [spec.md](../spec.md), «Фейк и test-ы», «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), таблица механизмов)

## Что происходит

- Фейк Claude — `WORFY_AGENT=fake` (`src/main/agent/app-registry.ts:170-190`), сценарии —
  `test/fixtures/agent-scripts/<имя>.jsonl`, лог — `WORFY_AGENT_LOG`.
- Для Codex фейка нет; test-ы не должны запускать настоящий Codex и входить в аккаунт.

## Что делаем

1. `test/fixtures/codex-app-server/fake-app-server.mjs` — Node-скрипт: JSON-RPC по stdio по строке на сообщение,
   как app-server. Шаги сценария: ответ на request, notification, server→client request (approval) и ожидание ответа
   worfy.
2. Сценарии — `test/fixtures/codex-scripts/<имя>.jsonl`: `turn` (простой ход), `steer`, `interrupt`, `approval`
   (команда и правка файлов), `resume`, `account-plus`, `account-pro` (одно недельное окно), `signed-out`,
   `login`, `limits-two-windows`, `usage-limit-window` (окно 100 % с `resetsAt`), `usage-limit-quota` (без окна),
   `threads` (для `thread/list` и `thread/read`).
3. `src/main/vendors/codex/launch.ts` — как стартует app-server: бинарник из Ticket-а 17 или, при
   `WORFY_CODEX=fake`, `process.execPath` с фейком. `WORFY_CODEX_SCRIPT`, `WORFY_CODEX_LOG` (request-ы worfy строками
   JSON), `WORFY_CODEX_HOME` (thread-ы фейка). `CODEX_HOME` процесса — из окружения test-а.
4. Сообщения сценариев типизированы сгенерированными типами (`src/main/vendors/codex/protocol/`): сценарий с полем,
   которого в типах нет, не проходит test.

## Готово, когда

- [ ] Contract test: фейк проходит `initialize` → `initialized`, `thread/start`, `turn/start` и отдаёт notification-ы
      сценария `turn`; лог содержит request-ы worfy.
- [ ] Contract test: под test-ами `launch.ts` не запускает бинарник `@openai/codex` (подменённый spawn видит только
      `process.execPath`) и ничего не пишет вне временных папок.
- [ ] Каждый сценарий проходит проверку по сгенерированным типам.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/fixtures/codex-scripts/` (новые)
- `src/main/vendors/codex/launch.ts` (новый)
- `test/contract/codex-fake.test.ts` (новый)

Только читать: `src/main/agent/app-registry.ts:170-190`, `src/main/vendors/claude/fake-query.ts` (после Ticket-а 13).
