# Spike: Integration через worfy в Claude Code и Codex, refresh пакета MCP SDK (worfy-integrations 01)

Дата: 2026-11-20. `@anthropic-ai/claude-agent-sdk` 0.3.322, Claude Code 2.1.322 (нативный бинарник из пакета SDK),
`@modelcontextprotocol/sdk` 1.32.0 (копия, которую ставит peer Agent SDK), Electron 44, macOS arm64. Codex — по схеме
0.166.0 (`src/main/vendors/codex/protocol/`) и на fake app-server-е; настоящий Codex не запускался.

Часть агента сделана: шаги 1–7 тикета. Шаг владельца (вход в Atlassian и Linear) сделан 2026-11-20: итог — раздел
«Итог шага владельца», окончательное решение — раздел «Решение: tools-only proxy достаточен?».

## Как проверено

- **Сценарий `integrations` probe-а** (`scripts/spikes/harness-plugin/probe.ts`), из корня worktree:
  `pnpm exec electron scripts/spikes/harness-plugin/probe.ts integrations --fixtures test/fixtures/sdk-messages`
  — exit 0, `probe_error` нет. Прогон занимает около минуты. Рядом с probe-ом:
  - `integrations-stub.mjs` — stub сервиса MCP на `127.0.0.1` (streamable HTTP, ответы JSON). Режим bearer: каждый
    token — свой набор данных (`alpha`, `beta`…), ответ называет набор, журнал stub-а пишет набор, а не token.
    Режим OAuth: 401 с `resource_metadata`, metadata RFC 9728 и RFC 8414, Dynamic Client Registration, `/authorize`
    сразу отвечает 302 с code, `/token` проверяет PKCE S256, refresh token (с ротацией или без), revocation
    endpoint. Там же stand-in endpoint-а worfy (`/mcp/<имя>` с token-ом Session) и fake Messages API.
  - `integrations-oauth.mjs` — пакет `@modelcontextprotocol/sdk` 1.32.0, `OAuthClientProvider` в памяти, вход
    через пакет, окно spike-а и отчёт по серверу.
- **Sandbox** — как у `mcp-live`: HOME и CLAUDE_CONFIG_DIR во временной папке (`sandbox_guard`: все пять пунктов
  `true`), без входа (`apiKeySource: none`), первыми в PATH fake `security` и `open` (Claude Code звал только
  `security find-generic-password`). Ход Claude Code отклонил сам: «Not logged in · Please run /login»,
  `total_cost_usd: 0`.
- **Fake Messages API** (шаг 1b сценария). Чтобы увидеть, что получила бы модель, и пройти `tools/call` через сам
  Claude Code, та же Session запущена с `ANTHROPIC_BASE_URL` на fake API на `127.0.0.1` и фиктивным ключом. Модели
  нет: fake пишет `tools` каждого запроса и на первый отвечает блоками `tool_use`. Запрос никуда, кроме
  `127.0.0.1`, не уходит.
- **Настоящие настройки** (`summary.json`, `real_settings`): хэши `~/.claude/settings.json`,
  `installed_plugins.json`, `known_marketplaces.json` до и после совпали; `probe_tmp_in_real_claude_json: false`;
  транскриптов в `~/.claude/projects` прогон не создал (`transcripts_created: []`).
- **Процессы.** Все процессы Claude Code вышли сами (`children.alive_at_end_killed: 0`); fake app-server закрыт по
  stdin. Electron `userData` прогона — временная папка, удаляется в конце; partition-ы окна без `persist:`, на диск
  не пишут.
- **Fixture.** `test/fixtures/sdk-messages/plugin-integrations-two-integrations.jsonl` — `system/init` Session из
  пункта 3.1. Fake token-ы в нём и в `summary.json` заменены на `<token-…>`; `--rescrub` проходит по нему (имя
  `plugin-*`) и ничего не меняет в остальных fixture-ах (прогон 2026-11-20, `git status` чистый).
- **Метаданные Atlassian и Linear** — запрос без входа через `discoverOAuthServerInfo` пакета 2026-11-20 (раздел
  «Метаданные сервисов»).

## Ответы, шаг 3 (Claude)

### 3.1 Две Integration-ы на одном адресе рядом с записями `serverUrl` — обе connected, каждая со своим token-ом

Да. Session: `worfy-canvas`, `acme-alpha` и `acme-beta` — SDK-серверы в процессе probe-а (proxy на низкоуровневом
`Server` пакета MCP SDK, как планирует Ticket 06), сторона сервиса — `Client` пакета со своим token-ом на одном адресе
stub-а. Рядом на том же адресе — `acme-header` (тип `http` с заголовком в `mcpServers`) и `acme-user` (сервер
пользователя, `claude mcp add --scope user … --header`). `managedSettings`: `allowManagedMcpServersOnly: true`,
`allowedMcpServers: [{serverName: 'worfy-canvas'}, {serverUrl: '<адрес stub-а>'}]` — форма, которую worfy шлёт сегодня.

- `mcpServerStatus` и `system/init`: все шесть серверов `connected`; `acme-alpha` и `acme-beta` — `source: sdk`.
- Через fake Messages API Claude Code вызвал `mcp__acme-alpha__whoami` и `mcp__acme-beta__whoami`: результаты tool-ов
  — «dataset alpha» и «dataset beta», в журнале stub-а `tools/call alpha` и `tools/call beta`. Каждая Integration
  дошла до сервиса своим token-ом. Склейки по адресу нет: у SDK-сервера адреса для Claude Code нет вовсе.

### 3.2 Policy tier SDK-серверы не режет

Те же две Integration-ы со списком только из `serverUrl` и со списком только из `worfy-canvas`: обе `connected` в
обоих вариантах. Имя Integration в `allowedMcpServers` не нужно (совпадает с `options.ts:29-30`).

### 3.3 `disallowedTools` с `mcp__<имя>__<tool>` — tool из `system/init` НЕ убирает

`disallowedTools: ['mcp__acme-beta__list_items', 'NotebookEdit']` (`NotebookEdit` — контроль, встроенный tool):

| Где | `mcp__acme-beta__list_items` | `NotebookEdit` |
|---|---|---|
| `system/init`, `tools` | есть | нет |
| `tools` запроса к модели (`ENABLE_TOOL_SEARCH=false`) | есть | нет |
| вызов через `tool_use` | отказ: «Permission to use mcp__acme-beta__list_items has been denied.», до stub-а вызов не дошёл | — |

Встроенный tool список убирает, MCP-tool — нет: только запрещает вызов. Факт 3г spec-а («убирает tool из контекста
модели») для MCP-tool-ов на 0.3.322 неверен. Модель видит такой tool и тратит ход на отказ.

### 3.4 `--mcp-config` на 0.3.322

Есть. В аргументах процесса Claude Code: `--mcp-config` с JSON, в котором только сервер типа `http` —
`acme-header` с `headers.Authorization` целиком. Его token виден в аргументах (`header_token_in_args: true`): Факт 3в
подтверждён на 0.3.322. SDK-серверов (`worfy-canvas`, `acme-alpha`, `acme-beta`, `n`) в `--mcp-config` нет, token-ов
proxy нет ни в аргументах, ни в окружении процесса (`proxy_tokens_in_args: false`, `proxy_tokens_in_env: false`).
`managedSettings` уходит отдельным `--managed-settings`, `disallowedTools` — `--disallowedTools=…`.

### 3.5 Предел длины имени tool-а — 128 символов полного имени

Сервер `n` с tool-ами, у которых полное имя `mcp__n__<tool>` длиной 60, 64, 65, 100, 128, 129, 200, 256:

- `mcpServerStatus` перечисляет все восемь.
- В `system/init` и в `tools` запроса к модели — только пять, до 128 включительно. 129, 200 и 256 Claude Code
  отбрасывает молча: не обрезает, не пишет ошибку.
- Предел самого API не проверен (нужен настоящий вызов модели). В бинарнике Claude Code есть шаблоны
  `^[A-Za-z0-9_-]{1,64}$` и `^[A-Za-z0-9_-]{1,128}$` (`strings`), чей какой — не выяснено. Запрос fake API с именем
  в 128 символов Claude Code отправил, значит сам он шлёт до 128.

Для Ticket 06: при имени сервера до 24 символов tool сервиса может быть до 97 символов (128 − `mcp__` − 24 − `__`).
Самые длинные имена tools живых сервисов (шаг владельца): Atlassian — 31 символ, Linear — 29; полное имя с именем
сервера в 24 символа — 62 и 60. Это меньше и 128, и 64 (более строгого шаблона из бинарника).

### 3.6 Tool search по умолчанию

Без `ENABLE_TOOL_SEARCH` MCP tools в `tools` запроса нет: там 12 tools, среди них `ToolSearch` и
`DeferredToolPlaceholder`, а имена MCP tools стоят в тексте запроса. `tool_use` по такому имени Claude Code выполнил
так же. Фильтр tools для модели, значит, — только `tools/list` proxy, а не что-то в `tools` запроса.

## Ответы, шаг 4 (Codex)

Две Integration-ы на одном адресе endpoint-а worfy — да, по схеме и на fake app-server-е; настоящий Codex не
запускался.

- `config` у `thread/start`: `mcp_servers.acme-alpha` и `mcp_servers.acme-beta`, у каждого `url`
  (`http://127.0.0.1:<порт>/mcp/<имя>`, один origin) и `bearer_token_env_var: WORFY_MCP_TOKEN` — как
  `src/main/vendors/codex/mcp.ts:286-287`. Параметры проходят JSON Schema `ThreadStartParams` закреплённой 0.166.0
  (ajv; `config` у неё — объект с любыми ключами, поля `mcp_servers.*` схема не описывает). Ответ
  `mcpServerStatus/list` с двумя серверами `authStatus: bearerToken` проходит схему `ListMcpServerStatusResponse`.
- Fake app-server (`test/fixtures/codex-app-server/fake-app-server.mjs`, сценарий из первых трёх шагов
  `mcp-status.jsonl` и этого ответа) принял `initialize`, `thread/start` и `mcpServerStatus/list`. В его журнале
  ключи `mcp_servers.acme-alpha` и `mcp_servers.acme-beta` есть, token-а Session нет ни в одном сообщении — он только
  в окружении процесса.
- Роль Codex сыграл probe — то, что Codex делает с такой записью (Факт 4а): token из переменной, которую называет
  `bearer_token_env_var`, и запрос на `url`. Stand-in endpoint-а worfy развёл пути по proxy: `/mcp/acme-alpha` —
  tools набора `alpha` и `whoami` → «dataset alpha», `/mcp/acme-beta` — «dataset beta». Чужой token — 401.
- Вывод, не наблюдалось на настоящем Codex: ключ OAuth Codex («имя + hash адреса», Факт 4б) здесь не участвует —
  вход по bearer из окружения. Одна переменная на Session хватает на все Integration-ы, путь различает их.

## Ответы, шаг 5 (один refresh?)

`Client` пакета 1.32.0, `StreamableHTTPClientTransport` с `authProvider` (provider в памяти), вход через пакет
(DCR, PKCE). Stub гасит все access token-ы разом, `/token` отвечает через 100 мс. Затем один вызов, 10 параллельных
`tools/call` и ещё раз 10:

| Вариант | 1 вызов: refresh | 10 вызовов: refresh / успешно | ещё 10 |
|---|---|---|---|
| refresh token без ротации | 2 | 10 / 10 | 10 / 10 |
| refresh token с ротацией | 2 (второй отвергнут) | 0 / 0 — `Unauthorized` | 0 / 0 |
| ротация + fetch с одним refresh за раз | 1 | 1 / 10 | 1 / 10 |

- Замка в пакете нет: каждый запрос с 401 зовёт `auth()` сам (`dist/esm/client/streamableHttp.js:328-347`), и
  `auth()` шлёт refresh, если есть refresh token (`dist/esm/client/auth.js:351`). Даже один `tools/call` дал два
  refresh: transport в тот же момент переоткрыл GET-поток (журнал stub-а: `GET /mcp 401`, `POST /mcp 401`).
- Без ротации лишние refresh только тратят запросы. С ротацией второй refresh несёт уже использованный token, сервер
  отвечает `invalid_grant`, пакет стирает token-ы (`auth.js:196`, `invalidateCredentials('tokens')`) и уходит в новый
  вход: Integration теряет вход, все следующие вызовы — `Unauthorized`.
- Fetch transport-а, который держит один refresh на refresh token за раз (`singleFlightFetch`,
  `integrations-oauth.mjs`), чинит это: один refresh на истечение, 10 из 10.

Вывод для Ticket 05: замок нужен, в provider-е его не поставить — у `OAuthClientProvider` нет места вокруг refresh.
Место — `fetch` transport-а (опция `fetch` у `StreamableHTTPClientTransport`): один запрос `grant_type=refresh_token`
на Integration за раз, остальные ждут его ответа. Шаг владельца показал: и Atlassian, и Linear при refresh выдают
новый refresh token (`refresh_token_rotated: true` у всех трёх входов), то есть живые сервисы — строка «с ротацией»
таблицы, и без замка Integration теряет вход.

## Окно spike-а (шаг 6), проверено на stub-е

`windowOpener` (`integrations-oauth.mjs`): `BrowserWindow` на partition `integration-spike-<слот>` без `persist:`
(cookies только в памяти), redirect `http://127.0.0.1/worfy-oauth/<слот>` ловит `webRequest.onBeforeRequest` окна и
отменяет — listener-а нет. Provider — `memoryProvider` (client, token-ы и verifier в памяти процесса). На stub-е
OAuth в скрытом окне: вход за ~130 мс, DCR — 1, `/authorize` — 1, обмен code с проверкой PKCE — 1; refresh сработал
(новый access token, refresh token сменился); revocation — 200 на refresh и access token. В конце —
`clearStorageData()` partition-а.

## Метаданные сервисов (без входа, 2026-11-20)

| Сервис | Сервер авторизации | DCR | Revocation endpoint | Grant `refresh_token` | PKCE | Client ID Metadata Document |
|---|---|---|---|---|---|---|
| Atlassian `https://mcp.atlassian.com/v2/mcp` | `https://auth.atlassian.com` | да | да | да | S256 | да |
| Linear `https://mcp.linear.app/mcp` | `https://mcp.linear.app` | да | да | да | S256 | да |

Atlassian в metadata ресурса перечисляет 40 scope-ов, в том числе `offline_access` и `write:…`/`delete:…`. Пакет без
явного scope просит их все (`auth.js:274`: `scope || resourceMetadata.scopes_supported || clientMetadata.scope`), и
окно согласия Atlassian покажет весь список. Для Ticket 05: scope Integration-а выбирать явно (каталог, Ticket 03),
а не брать все из metadata.

## Решения для Ticket-ов

- **Ticket 06 (proxy).** Фильтр tools Project-а режет `tools/list` proxy, а не только `disallowedTools`: тот MCP-tool
  из списка модели не убирает (3.3). Имя tool-а с полным именем длиннее 128 Claude Code выбрасывает молча (3.5) —
  proxy пишет такие tools в статус Integration строкой «tool не виден агенту: имя длиннее 128». Token-ы сервиса в
  аргументы процесса не попадают, пока Integration — SDK-сервер (3.4); тип `http` с `headers` в `mcpServers` для
  Integration не использовать. Низкоуровневый `Server` пакета подходит как `instance` SDK-сервера (3.1).
- **Ticket 05 (вход OAuth).** Замок refresh — в `fetch` transport-а, один refresh на Integration за раз (шаг 5).
  Scope — явный. Redirect через перехват навигации окна без listener-а работает (шаг 6).
- **Ticket 07 (Codex).** Одна переменная `WORFY_MCP_TOKEN` на Session, путь `/mcp/<имя>` на Integration (шаг 4).
- **Ticket 03 (каталог).** Поле scope-ов в шаблоне сервиса. Пометок «нужно больше, чем tools» Atlassian и Linear не
  требуют (раздел «Решение: tools-only proxy достаточен?»).

## Шаг владельца (вручную, 10–15 минут)

Что нужно: Mac с этой веткой (или `main` после merge), аккаунт Atlassian с доступом к двум site-ам, аккаунт Linear.
Агент со входом владельца ничего не запускает; token-ы остаются в памяти процесса и в конце отзываются.

1. Открыть Terminal в worktree с веткой `worfy-integrations/01` (Orchestrator скажет путь), где уже стоят
   зависимости, и запустить:
   `pnpm exec electron scripts/spikes/harness-plugin/probe.ts integrations-sign-in`
   Claude Code и Codex эта команда не запускает.
2. Откроется окно «worfy spike: atlassian-1». Войти в Atlassian, на экране согласия выбрать первый site и нажать
   Accept. Atlassian покажет длинный список прав, в том числе запись и удаление: так пакет MCP SDK просит по
   умолчанию, и это тоже результат spike-а. Spike зовёт только `tools/list` и `getAccessibleAtlassianResources`
   (чтение), ничего не пишет. Окно закроется само.
3. Откроется «worfy spike: atlassian-2». Снова войти (окно чистое, вход заново) и выбрать **второй** site. Если
   site у аккаунта один — выбрать тот же; итог тогда скажет, что site-ы совпали.
4. Откроется «worfy spike: linear-3». Войти в Linear и разрешить доступ.
5. Terminal напечатает итог (JSON) и строку `[probe] written to <папка>`. Прислать агенту путь к
   `<папка>/summary.json` или текст части `integrations-sign-in`. В ней нет token-ов, адресов site-ов и e-mail-ов:
   только число tools, их имена, `capabilities`, срок access token-а, есть ли refresh token и сработал ли refresh,
   revocation (HTTP-статус). Ошибка записана только классом и HTTP-статусом (`failed_at`, `error`, `code`), без
   текста: текст ошибки может цитировать ответ сервиса.

Если окно не открылось, вход упал или Atlassian отказал из-за прав — это тоже результат: прислать вывод Terminal
как есть. Каждое окно ждёт до 10 минут; закрыть окно — пропустить этот вход.

Token-ы каждого входа отзываются сразу после его отчёта, что бы в отчёте ни упало. Ctrl+C в Terminal тоже безопасен:
probe отзывает token-ы всех уже выполненных входов и печатает `[probe] revoke <вход>: {…}` перед выходом. Не отзовёт
только убийство процесса, которое он не может поймать (`kill -9`, падение самого Electron). Тогда — отозвать доступ
руками: Atlassian — профиль аккаунта, раздел подключённых приложений; Linear — Settings, раздел авторизованных
приложений; приложение называется «worfy integrations spike».

После этого агент заполняет «Итог шага владельца», окончательное решение про tools-only proxy и ставит пункт
`(вручную)` тикета.

## Итог шага владельца (вручную)

Владелец прогнал `probe.ts integrations-sign-in` 2026-11-20: Atlassian два раза (`atlassian-1`, `atlassian-2`), затем
Linear (`linear-3`). Orchestrator проверил `summary.json` (token-ов, e-mail-ов и адресов site-ов нет); значения ниже —
только из него. Версии: Agent SDK 0.3.322, Claude Code 2.1.322, Electron 44.10.2, `@modelcontextprotocol/sdk` 1.32.0.

| | atlassian-1 | atlassian-2 | linear-3 |
|---|---|---|---|
| Сервер (`serverInfo.name`) | `atlassian-mcp-server` | `atlassian-mcp-server` | `linear` |
| `capabilities` | `logging{}`, `tools{listChanged}` | `logging{}`, `tools{listChanged}` | `tools{listChanged}` |
| `instructions`, символов | 2422 | 2797 | 2873 |
| Tools | 26 | 26 | 70 |
| Самое длинное имя tool-а / полное при сервере в 24 символа | 31 / 62 | 31 / 62 | 29 / 60 |
| Access token: тип, срок | `Bearer`, 28800 с (8 ч) | `Bearer`, 28800 с (8 ч) | `bearer`, 86100 с (~24 ч) |
| Refresh token выдан | да | да | да |
| Refresh: итог, время | `AUTHORIZED`, 1503 мс | `AUTHORIZED`, 509 мс | `AUTHORIZED`, 400 мс |
| Refresh: новый access token / refresh token сменился | да / да | да / да | да / да |
| Срок после refresh; tools после refresh | 28800 с; 26 | 28800 с; 26 | 86100 с; 70 |
| Revocation: refresh / access token | 200 / 200 | 200 / 200 | 200 / 200 |
| Вход (окно, вместе с действиями владельца) | 166527 мс | 296715 мс | 134670 мс |

Сервер авторизации, DCR, revocation endpoint и Client ID Metadata Document — как в «Метаданных сервисов»: у обоих
сервисов есть. Grant-ы Atlassian: `authorization_code`, `client_credentials`, `refresh_token`, token-revoke, jwt-bearer,
token-exchange; способы аутентификации client-а — `none`, `client_secret_post`, `client_secret_basic`,
`private_key_jwt`. Linear: `authorization_code`, `refresh_token`, jwt-bearer; `client_secret_basic`,
`client_secret_post`, `none`.

- **Scope.** Atlassian выдал длинный список, от `email offline_access read:account …` до прав записи (`write:all:twg`
  и другие `write:…`): пакет без явного scope попросил всё из metadata, как и ожидалось. Linear — `read write`.
- **Tools.** У Atlassian среди 26 есть `executeWrite` и `executeDestructive`, у Linear среди 70 — `save_*`,
  `delete_*`, `merge_diff`: оба сервиса дают агенту запись и удаление. Три Integration-ы — 122 tools.
- **Два site-а Atlassian не сравнены.** Вызов `getAccessibleAtlassianResources` у обоих входов дал `sites: "not read"`:
  tool упал или его ответ не разобрался как JSON-список (spike пишет только эту строку, без текста ответа). Попали ли
  два входа на разные site-ы, этот шаг не показал. Что видно: оба входа прошли, refresh и revocation у каждого свои,
  `instructions` у двух входов разной длины (2422 и 2797).
- **Настройки владельца.** `~/.claude/settings.json` и файлы плагинов (`installed_plugins.json`,
  `known_marketplaces.json`) до и после — те же. `~/.claude.json` изменился: это запись самого Claude Code
  (Orchestrator проверил), временной папки probe-а в нём нет (`probe_tmp_in_real_claude_json: false`). Новых
  transcript-ов нет.

## Решено без владельца

1. Без модели, но с fake Messages API на `127.0.0.1` (`ANTHROPIC_BASE_URL` и фиктивный ключ) — чтобы увидеть
   `tools` запроса и пройти `tools/call` через сам Claude Code (пункты 3.1, 3.3, 3.5). Ключ никуда не ведёт, запрос
   не уходит с машины. Без этого пункт «каждая отвечает данными своего token-а» был бы проверен только мимо Claude Code.
2. Роль Codex в шаге 4 играет probe по документированному поведению Codex (Факт 4а), не настоящий binary: бриф
   запрещает его запуск.
3. Unit-test-ов у кода spike-а нет, как у всего `probe.ts`: это не код worfy и в сборку не попадает. Проверка —
   прогон сценария с exit 0 и факты `summary.json`.
4. Шаг владельца отзывает token-ы каждого входа в `finally` сразу после его отчёта и ещё раз пробует на SIGINT,
   SIGTERM и необработанной ошибке (revocation endpoint есть у обоих сервисов). Ошибки в отчёт и в Terminal идут
   только классом и HTTP-статусом, ответ списка site-ов, который не разобрался, — строкой «not read». Проверено на
   stub-е: `--services stub-ok,stub-tools-fail,stub-bad-sites` — exit 0, у всех трёх входов revoke 200/200, маркер
   из ответа stub-а не попал ни в `summary.json`, ни в вывод; `stub-tools-hang` и SIGINT — «revoke … 200/200» перед
   выходом, процесс не остался.
5. Сравнение двух site-ов Atlassian осталось непроверенным, повторного входа владельца не просим: решение про proxy,
   замок refresh и предел имени от него не зависят. Что две Integration-ы одного сервиса держат каждая свой token и
   свой refresh, показали stub (3.1, шаг 5) и два входа Atlassian. Проверить site-ы можно в приёмке Ticket-а 05:
   у живой Integration список site-ов виден в ответе tool-а.

## Решение: tools-only proxy достаточен?

**Да.** Ни Atlassian, ни Linear не объявляют в `initialize` ни `resources`, ни `prompts`, ни `completions`. Объявлены
только `tools` (с `listChanged`) и у Atlassian `logging` — это уведомления сервера, не данные для агента. Stub,
Claude Code и Codex обходятся `initialize`, `tools/list` и `tools/call`. Elicitation и sampling — возможности
client-а, `initialize` сервера их не показывает; нужны ли они при вызове tool-а, этот spike не проверял.

Выводы:

- **Ticket 06 (proxy).** Объём — tools, плюс три вещи из живых серверов:
  1. `tools.listChanged`: на `notifications/tools/list_changed` от сервиса proxy заново берёт `tools/list` и сам
     шлёт `list_changed` агенту — оба сервиса это объявили.
  2. `instructions` из `initialize` сервиса (2422–2873 символа) proxy отдаёт в своём `initialize`: без них агент
     теряет описание сервиса. Берутся от каждой Integration отдельно — у двух входов Atlassian они разной длины.
  3. `logging` proxy не объявляет, уведомления `notifications/message` сервиса не пересылает (или только в журнал
     worfy).
  Предел имени: при имени сервера до 24 символов самые длинные полные имена — 62 (Atlassian) и 60 (Linear), меньше
  128 и даже 64; правило «tool не виден агенту: имя длиннее 128» остаётся для других сервисов. 26 + 26 + 70 tools —
  фильтр tools Project-а в `tools/list` proxy нужен уже на этих двух сервисах (`executeDestructive`, `delete_*`).
- **Ticket 05 (вход OAuth).** Замок refresh обязателен: оба сервиса ротируют refresh token, а без замка пакет при
  параллельных вызовах шлёт несколько refresh и после `invalid_grant` стирает вход (шаг 5). Замок — в `fetch`
  transport-а, один refresh на Integration за раз. Scope — явный: без него Atlassian выдаёт и права записи.
  Access token живёт 8 ч (Atlassian) и ~24 ч (Linear): refresh — обычный путь, а не редкость. Revocation endpoint
  есть у обоих и отвечает 200 — отключение Integration-а может отзывать token-ы у сервиса.
- **Ticket 03 (каталог).** Пометок «нужно больше, чем tools» Atlassian и Linear не требуют. В шаблоне сервиса —
  явный scope (для Linear `read write`, для Atlassian — выбранный список вместо всех из metadata).
