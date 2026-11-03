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

- [x] Вручную, владелец: записи (Plus) в `test/fixtures/codex-messages/`, manifest — закреплённая версия; test зелёный.
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
  причиной (после записей владельца их 12, см. «Раунд 2»; лишнее исключение — красный). Пять test-ов тех же проверок на данных в самом test-е зелёные
  при любой папке записей. `WORFY_CODEX_RECORDINGS` — другая папка записей, только для контрольных случаев.
- Контрольные случаи (синтетические записи из сценариев фейка во временной папке, не в репозитории): своя версия —
  exit 0; manifest `0.167.0` — exit 1; пустая папка — exit 1; без ответа `review/start` — exit 1 с
  `review.jsonl:5: result review/start — no recorded message of this kind`; запись с `threadId: 5` — exit 1 с
  `v2/TurnStartedNotification/threadId must be string`.
- Скрипт проверен только на фейке (`--app-server` с обёрткой над `fake-app-server.mjs`): отказ без флага, под `CI` и
  `VITEST`; в записанных файлах нет email, id аккаунта, токенов, домашней папки и временных путей. Настоящий Codex не
  запускался. Пока владелец не снял записи, test красный — так задумано (п. 3).

### Раунд 2: записи владельца

- Владелец снял записи Codex 0.166.0 (план Plus, 2026-11-03, `darwin-arm64`); Orchestrator положил их в PR. На них test
  был красным: 29 путей ключей и видов сообщений, которые играют сценарии фейка, а в записях их нет.
- Ни один из 29 не оказался ошибкой фейка: ни в одном записанном виде сообщения живой Codex не прислал поле под другим
  именем или в другой форме. Каждый — случай, до которого живой прогон не дошёл, а JSON Schema закреплённой версии его
  описывает. Они стали 12 исключениями `EXCEPTIONS` (вид и путь ключа, у каждого причина):
  - reasoning: элементы `reasoning` в `item/started`, `item/completed`, `thread/read` и `item/reasoning/summaryTextDelta` —
    ни один ход прогона не дал reasoning, хотя скрипт просил `model_reasoning_summary = "detailed"`;
  - план: `item(plan)` и `turn/plan/updated` — модель ответила, что `update_plan` ей недоступен (`turn.jsonl:72`);
  - `reason` в `item/commandExecution/requestApproval` — approval-ы прогона шли под политикой `untrusted`, где Codex
    reason не даёт; он даёт его, когда модель просит выйти из sandbox (в schema: «e.g. request for network access»);
  - `item(mcpToolCall).error.message` — инструмент `fail` вернул ошибку результатом (`error: null`), а `error` — вызов, не
    дошедший до инструмента (сервер не запущен);
  - отказ `thread/compact/start` — Codex не отказал ни разу: даже пустой thread он сжал (`compact.jsonl:16`, ответ `{}`, затем
    ход с `contextCompaction`);
  - `skills/changed` — за 15 с после новой skill не пришёл;
  - skill-элемент в `thread/read` — скрипт посылает skill текстом (`$capture-greeting`), worfy — элементом `skill`;
  - `status` `notLoaded` в `thread/list` — прогон просил список в том же процессе, где thread-ы загружены.
  Исключение пропускает только свой вид и путь ключа с тем, что под ним: новый ключ рядом (например
  `item(mcpToolCall).error.code`) — красный, это проверяет отдельный test.
- Новая проверка: записи hook-ов есть для `PreToolUse` (16), `Stop` (9) и `SubagentStop` (1), и у каждого входа
  `SubagentStop` есть `agent_type` (1 из 1) — для фейка hook-ов (Ticket 44).
- Обезличивание: три значения записей Orchestrator заменил руками — имя Mac-а в `serverName` (`remoteControl/status/changed`),
  `installationId` и `loginId`. Теперь их заменяет скрипт: имя хоста из `os.hostname()` и из `serverName` — на
  `capture-host.local` (только целое имя: хост `mac` не трогает `macos`), `installationId` —
  `00000000-0000-4000-8000-000000000001`, `loginId` — `…0002`; если что-то из них осталось, скрипт ничего не пишет.
  Test сверяет: в сохранённых записях эти значения уже такие, какими их пишет скрипт. Повторно записи не снимались.
- Под `CI` и `VITEST` скрипт отказывает раньше всего, `--help` тоже (было: `--help` выходил с кодом 0 до отказа).
- Контрольные случаи на копиях записей владельца во временной папке: свои записи — exit 0; manifest `0.167.0` — exit 1;
  пустая папка — exit 1; без ответа `review/start` — exit 1 с `review.jsonl:5: result review/start — no recorded message
  of this kind`; `threadId: 5` в `turn/started` — exit 1 с `v2/TurnStartedNotification/threadId must be string`; вход
  `SubagentStop` без `agent_type` — exit 1 с `hooks/SubagentStop.jsonl:1: no agent_type`.
- Следующая запись закроет часть исключений, если скрипт пошлёт skill элементом `skill` и попросит `thread/list` после
  перезапуска; в этом раунде сценарий скрипта не менялся.
