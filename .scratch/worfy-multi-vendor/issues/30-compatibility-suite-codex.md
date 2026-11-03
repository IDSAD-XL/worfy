# 30 — Compatibility suite Codex и скрипт записи

Type: task
Status: claimed 2026-11-03T04:25Z
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
   `SubagentStop` с `agent_type` в `test/fixtures/codex-messages/hooks/` — для фейка hook-ов (Ticket 44). Email и id аккаунта заменяются. Скрипт отказывается
   работать без `--use-my-login`; в CI и test-ах он не идёт.
2. `test/contract/codex-compat.test.ts`:
   - записи есть, и manifest — той же версии, что `@openai/codex` в `package.json`; иначе test красный. Без записей
     test не зелёный;
   - каждая запись проходит `ajv` по сгенерированной JSON Schema (`protocol/json/`);
   - каждый сценарий фейка играет только виды сообщений и пути ключей, которые есть в записях.
3. **Вручную:** записи снимает владелец — implementer пишет скрипт и test, Orchestrator просит владельца выполнить одну команду
   на Mac с его входом (подписка ChatGPT Plus) и кладёт записи в тот же PR. До этого PR открыт, test красный —
   так задумано.
4. В шапке test-а — порядок смены версии Codex: поднять `@openai/codex`, `node scripts/codex-protocol.mjs`,
   `node scripts/codex-capture.mjs --use-my-login` (владелец), test; отдельный PR. Поднятая версия без новых записей —
   красный test.

## Готово, когда

- [ ] Вручную, владелец: записи (Plus) в `test/fixtures/codex-messages/`, manifest — закреплённая версия; test зелёный.
- [ ] Контрольный случай: manifest другой версии — test красный; пустая папка записей — test красный.
- [ ] Контрольный случай: сценарий фейка с видом сообщения, которого нет в записях, — красный.
- [ ] В записях нет email, id аккаунта и путей домашней папки.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `scripts/codex-capture.mjs` (новый)
- `test/contract/codex-compat.test.ts` (новый), `test/fixtures/codex-messages/` (новая папка)

Только читать: `test/contract/sdk-compat.test.ts`, `scripts/sdk-compat.mjs`.

## Итог

- `scripts/codex-capture.mjs` — скрипт записи. Без `--use-my-login` отказывает (код 2), под `CI` или `VITEST` — тоже,
  с любыми флагами. Запускает закреплённый `codex app-server` (launcher пакета `@openai/codex` под тем же Node, версия
  в `node_modules` сверяется с `package.json`) три раза с `CODEX_HOME` во временной папке: вход и hook-и; сценарий;
  resume после перезапуска. Вход — новый вход ChatGPT в этой временной папке по ссылке, которую печатает скрипт
  (`account/login/start`, `cli_auth_credentials_store = "file"`); `~/.codex` не читается и не меняется, в конце —
  `account/logout` и удаление временной папки. Копировать `auth.json` владельца скрипт не стал: обновление токена
  во временной копии сделало бы недействительным refresh token в `~/.codex`.
- Сценарий: без входа (`account/read`, отказ `account/rateLimits/read`), вход, `account/read`,
  `account/rateLimits/read`, `model/list`, `hooks/list`, `skills/list` и `skills/changed`, ход с `update_plan` и
  командой, skill, MCP-сервер записи (`echo` и `fail`), правка файла, approval (accept, decline, interrupt с
  `cancel`), steer, interrupt, Subagent с правкой в read-only, `thread/compact/start` (и на пустом thread-е), `review/start`,
  ход с несуществующей моделью, `thread/list` по страницам, `thread/read`, `thread/resume` после перезапуска и
  resume неизвестного thread-а. Чего Codex не прислал за `--timeout`, записано строкой `{"capture": …}`.
- Hook-и: не plugin, а `hooks.json` в самом временном `CODEX_HOME` (слой пользователя). Для plugin-а Codex сверяет ещё
  hash содержимого папки plugin-а (`trusted_content_hash`, `codex-rs/hooks/src/engine/plugin_trust.rs`), а
  app-server его не отдаёт; hash hook-а пользователя отдаёт `hooks/list` (`currentHash`), и скрипт подтверждает его в
  `config.toml` того же `CODEX_HOME` (`hooks.state."<key>".trusted_hash`, `codex-rs/hooks/src/config_rules.rs`) до
  второго запуска. Вход hook-а от источника не зависит. Записи — `hooks/<событие>.jsonl`; скрипт печатает, сколько
  входов `PreToolUse`, `Stop`, `SubagentStop` записано и сколько из них с `agent_type`.
- Обезличивание: email, id аккаунта и пользователя, токены (из `account/read` и временного `auth.json`), любой email,
  домашняя папка и временные папки заменяются в строках и ключах; если после замены что-то из них осталось в тексте,
  скрипт ничего не пишет (код 1). В конце печатает виды сообщений сценариев фейка, которых нет в записях.
- `test/contract/codex-compat.test.ts` — один test на записи: manifest и `cliVersion` каждого thread-а — закреплённой
  версии, `node_modules` — тоже; каждая запись проходит `ajv` по сгенерированной JSON Schema (как её сгенерировал
  Codex, объекты открыты); каждый шаг сценариев фейка — вид и пути ключей из записей, кроме исключений `EXCEPTIONS` с
  причиной (пока пусто; лишнее исключение — красный). Пять test-ов тех же проверок на данных в самом test-е зелёные
  при любой папке записей. `WORFY_CODEX_RECORDINGS` — другая папка записей, только для контрольных случаев.
- Контрольные случаи (синтетические записи из сценариев фейка во временной папке, не в репозитории): своя версия —
  exit 0; manifest `0.167.0` — exit 1; пустая папка — exit 1; без ответа `review/start` — exit 1 с
  `review.jsonl:5: result review/start — no recorded message of this kind`; запись с `threadId: 5` — exit 1 с
  `v2/TurnStartedNotification/threadId must be string`.
- Скрипт проверен только на фейке (`--app-server` с обёрткой над `fake-app-server.mjs`): отказ без флага, под `CI` и
  `VITEST`; в записанных файлах нет email, id аккаунта, токенов, домашней папки и временных путей. Настоящий Codex не
  запускался. Пока владелец не снял записи, test красный — так задумано (п. 3).
