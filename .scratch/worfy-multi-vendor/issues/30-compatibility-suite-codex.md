# 30 — Compatibility suite Codex и скрипт записи

Type: task
Status: open
Blocked by: 22
Source: [spec.md](../spec.md), «Codex: бинарник и совместимость», «Риски», п. 2; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), «Главный риск»); решение владельца Q8 (план Plus)

## Что происходит

- Для Claude связь с закреплённой версией держит `test/contract/sdk-compat.test.ts`: записи настоящих сообщений
  (`test/fixtures/sdk-messages/`, manifest с версией), фейк играет только формы из записей.
- Для Codex после Ticket-ов 17–22 есть сгенерированные типы и JSON Schema, фейк и его сценарии, но записей живого
  Codex нет.

## Что делаем

1. `scripts/codex-capture.mjs` — запускает закреплённый Codex app-server, проходит сценарий (ход, steer, interrupt,
   approval, resume, `account/read`, `account/rateLimits/read`, `thread/list`, `thread/read`, `skills/list`) во
   временной папке-Project-е и пишет сообщения в `test/fixtures/codex-messages/` с manifest (версия Codex, дата,
   план). Он же ставит во временный plugin hook, который пишет свой вход: записи входа `PreToolUse`, `Stop`,
   `SubagentStop` с `agent_type` — для фейка hook-ов (Ticket 44). Email и id аккаунта заменяются. Скрипт отказывается
   работать без `--use-my-login`; в CI и test-ах он не идёт.
2. `test/contract/codex-compat.test.ts`:
   - записи есть, и manifest — той же версии, что `@openai/codex` в `package.json`; иначе test красный. Без записей
     test не зелёный;
   - каждая запись проходит `ajv` по сгенерированной JSON Schema (`protocol/json/`);
   - каждый сценарий фейка играет только виды сообщений и пути ключей, которые есть в записях.
3. Записи снимает владелец: implementer пишет скрипт и test, Orchestrator просит владельца выполнить одну команду
   на Mac с его входом (подписка ChatGPT Plus) и кладёт записи в тот же PR. До этого PR открыт, test красный —
   так задумано.
4. В шапке test-а — порядок смены версии Codex: поднять `@openai/codex`, `node scripts/codex-protocol.mjs`,
   `node scripts/codex-capture.mjs --use-my-login` (владелец), test; отдельный PR. Поднятая версия без новых записей —
   красный test.

## Готово, когда

- [ ] Записи владельца (Plus) в `test/fixtures/codex-messages/`, manifest — закреплённая версия; test зелёный.
- [ ] Контрольный случай: manifest другой версии — test красный; пустая папка записей — test красный.
- [ ] Контрольный случай: сценарий фейка с видом сообщения, которого нет в записях, — красный.
- [ ] В записях нет email, id аккаунта и путей домашней папки.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `scripts/codex-capture.mjs` (новый)
- `test/contract/codex-compat.test.ts` (новый), `test/fixtures/codex-messages/` (новая папка)

Только читать: `test/contract/sdk-compat.test.ts`, `scripts/sdk-compat.mjs`.
