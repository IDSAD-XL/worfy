# 30 — Compatibility suite Codex и скрипт записи

Type: task
Status: open
Blocked by: 22
Source: [spec.md](../spec.md), «Codex: бинарник и совместимость», «Риски», п. 2; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), «Главный риск»)

## Что происходит

- Для Claude связь с закреплённой версией держит `test/contract/sdk-compat.test.ts`: записи настоящих сообщений
  (`test/fixtures/sdk-messages/`, manifest с версией), фейк играет только формы из записей.
- Для Codex после Ticket-ов 17–22 есть сгенерированные типы и фейк, но записей живого Codex нет.

## Что делаем

1. `scripts/codex-capture.mjs` — запускает закреплённый Codex app-server, проходит сценарий (ход, steer, interrupt,
   approval, resume, `account/read`, `account/rateLimits/read`, `thread/list`, `thread/read`, `skills/list`) во
   временной папке-Project-е и пишет сообщения в `test/fixtures/codex-messages/` с manifest (версия, дата). Запускает
   его владелец со своим входом — при приёмке (Ticket 32); в CI и test-ах он не идёт. Email и id аккаунта в записях
   заменяются.
2. `test/contract/codex-compat.test.ts`: manifest записей — той же версии, что `package.json` (иначе красный);
   каждая запись разбирается сгенерированными типами; каждый сценарий фейка играет только виды сообщений и пути
   ключей, которые есть в записях.
3. Пока записей нет, test проверяет только типы и сообщает «no captures yet»; Ticket 32 добавляет записи.
4. В шапке test-а — порядок смены версии Codex: поднять версию, `scripts/codex-protocol.mjs`, `codex-capture.mjs`,
   test, отдельный PR.

## Готово, когда

- [ ] Test зелёный без записей и красный на записи другой версии (контрольный случай).
- [ ] Сценарий фейка с видом сообщения, которого нет в записях (контрольная запись), — красный.
- [ ] `node scripts/codex-capture.mjs --help` описывает запуск; скрипт отказывается работать без `CODEX_HOME` во
      временной папке или без явного `--use-my-login`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `scripts/codex-capture.mjs` (новый)
- `test/contract/codex-compat.test.ts` (новый), `test/fixtures/codex-messages/` (новая папка)

Только читать: `test/contract/sdk-compat.test.ts`, `scripts/sdk-compat.mjs`.
