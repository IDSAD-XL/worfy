# Spike: подхват MCP-серверов в работающей Session (worfy-mcp-live 01)

Дата: 2026-11-11, второй раунд — 2026-11-12. SDK `@anthropic-ai/claude-agent-sdk` 0.3.322, Claude Code 2.1.322
(нативный бинарник из пакета SDK), Electron 44, macOS arm64. Codex — по схеме 0.166.0
(`src/main/vendors/codex/protocol/`), живой Codex не запускался.

Ссылки вида `F:<имя>` — fixture-ы `test/fixtures/mcp-live/mcp-live-<имя>.json`. Каждый наблюдаемый факт ниже
стоит в fixture-е. Что выведено из кода или из других фактов, а не наблюдалось, помечено «вывод, не наблюдалось».

## Как проверено

- **Чтение SDK.** `sdk.d.ts` 0.3.322: `mcpServerStatus` (`:3145`), `reloadPlugins` (`:3221`, опция
  `holdOnCacheImpact`), `reconnectMcpServer` (`:3284`), `toggleMcpServer` (`:3292`), `setMcpServers` (`:3338`),
  `applyFlagSettings` (`:3071`). `sdk.mjs`: недокументированные `mcpAuthenticate(serverName, redirectUri,
  { redirectUriOnly })`, `mcpClearAuth(serverName)`, `mcpSubmitOAuthCallbackUrl(serverName, callbackUrl)` —
  control-запросы `mcp_authenticate`, `mcp_clear_auth`, `mcp_oauth_callback_url`; ответ — поле `response`.
  Обработчик `mcp_authenticate` в бинарнике Claude Code прочитан, чтобы знать ветку connector-а claude.ai (её в
  sandbox не видно). CHANGELOG в пакете SDK нет.
- **Сценарий `mcp-live` probe-а** (`scripts/spikes/harness-plugin/probe.ts`), команда из корня worktree:
  `pnpm exec electron scripts/spikes/harness-plugin/probe.ts mcp-live --out <tmp> --fixtures test/fixtures/sdk-messages`
  — exit 0. Процессы Claude Code, которые сценарий запустил, к концу вышли все (`children.alive_at_end_killed: 0`).
  Sandbox:
  - HOME и CLAUDE_CONFIG_DIR — во временной папке. Сценарий сам проверяет это до запуска (`sandbox_guard`: все
    пять пунктов `true`, иначе падает).
  - Без входа: `apiKeySource: none`, переменных `ANTHROPIC_*` нет.
  - Первыми в PATH стоят fake `security`, `open` и `xdg-open`. Claude Code звал только fake:
    `security find-generic-password` и `security -i` (запись). До Keychain входа он не дошёл, браузер не открывал.
    Запись refused, и Claude Code положил данные клиента OAuth в `.credentials.json` sandbox-а.
  - Модель не вызывалась. Ходы, которые нужны для `system/init` и транскрипта под resume, Claude Code отклонил
    сам: «Not logged in · Please run /login», `total_cost_usd: 0`.
  - Сервер OAuth — локальный fake (`127.0.0.1`, случайный порт), он токен не выдаёт никогда.
- **Настоящие настройки** (`summary.json` probe-а, `real_settings`). Хэши `~/.claude/settings.json`,
  `installed_plugins.json` и `known_marketplaces.json` до и после совпадали во всех прогонах.
  - Хэш `~/.claude.json` в части прогонов разошёлся. Этот файл пишут все живые сессии Claude Code машины: за
    3 минуты без probe-а его mtime сменился дважды.
  - Решающая проверка — `probe_tmp_in_real_claude_json`: есть ли временная папка прогона в настоящем
    `~/.claude.json`. Claude Code из sandbox, если бы писал туда, оставил бы там свой рабочий каталог ключом
    Project-а. Её значение — `false`; для всех прошлых прогонов `grep -c` их временных папок — 0.
- **Fixture-ы.** `system/init` трёх Session — `test/fixtures/sdk-messages/plugin-mcp-live-*.jsonl`; ответы
  control-вызовов и наблюдения — `test/fixtures/mcp-live/mcp-live-*.json`. Оба набора прошли scrub probe-а.
  `--rescrub` по обеим папкам ничего не меняет (`git diff` пуст). Имена серверов придуманные (`example-notes`,
  `example-notes-local`, `example-notes-project`, `example-notes-dynamic`, `example-oauth`, `example-unknown`).
  URL заменены на `<local-url>`, у `authUrl` записаны только имена параметров, `state` и порт — `<state>` и
  `<port>`.
- **Codex** — по схеме и README app-server-а (ветка `main` репозитория openai/codex, она может быть новее 0.166.0).
  Fake app-server (`test/fixtures/codex-app-server/fake-app-server.mjs`) отвечает только тем, что ему написал
  сценарий. Поэтому на вопрос, что делает настоящий Codex, он ответить не может, и прогона на нём нет.

## Ответы, шаг 3 (Claude)

1. **Сервер, записанный в конфигурацию на ходу, имя в `allowedMcpServers`.**
   - Без вызова: через 5 с после `claude mcp add --scope user` в `mcpServerStatus` его нет, только `worfy-canvas`
     (`F:allowed-status-5s-after-write-no-call`).
   - `reloadPlugins()`: в ответе (`mcpServers`) сервер уже есть, статус `pending`; через 1,5 с он `connected`,
     tool `notes_list` (`F:allowed-reload-plugins`). **Живой подхват работает этим вызовом.**
   - Проверены три scope-а `claude mcp add`: `user`, `local` (запись Project-а в `.claude.json`) и `project`
     (`.mcp.json` папки `cwd`). Все три `reloadPlugins()` подхватил: `pending`, затем `connected`
     (`F:allowed-reload-local-project`). Серверы plugin-ов и connector-ы claude.ai этим не проверены.
   - Источник после `reloadPlugins` — `source: dynamic`, `scope: dynamic`, а не `user` / `local` / `project`. После
     Restart тот же сервер — `source: user` (`F:restart-status`).
   - `setMcpServers` с его конфигурацией тоже подключает: `added: ["example-notes"]` (`F:allowed-set-mcp-servers`).
     Но тогда сервер переходит к хозяину: следующий `setMcpServers` без него отвечает `removed: ["example-notes"]`.
     После этого сервера нет в Session вовсе, хотя он по-прежнему в конфигурации пользователя
     (`F:allowed-set-mcp-servers-without`). Для сервера пользователя это не тот путь.
2. **`allowedMcpServers` отсекает сервер из `setMcpServers`: да.** Ответ `added: []`,
   `errors: { "example-notes-dynamic": "Blocked by enterprise policy (allowedMcpServers/deniedMcpServers)" }`
   (`F:cut-set-mcp-servers-unlisted`).
3. **Имя в allowlist у работающего query: нельзя.**
   - Сервер, который отсёк список, `mcpServerStatus` не перечисляет вовсе (`F:cut-status-start`; как `system/init`,
     ADR-0048).
   - `applyFlagSettings({ allowedMcpServers: [...] })` проходит без ошибки и ничего не меняет: после него и
     `reloadPlugins()` сервера в статусе нет (`F:cut-apply-flag-settings`, `F:cut-reload-after-flag`).
   - `reconnectMcpServer` и `toggleMcpServer(…, true)` на отсечённый сервер отвечают ошибкой «MCP server
     example-notes is blocked by enterprise managed policy» (`F:cut-reconnect-cut`, `F:cut-toggle-on-cut`).
   - Вызова, который меняет `managedSettings` работающего query, в `sdk.d.ts` нет. Что policy tier читается
     только при старте процесса — вывод, не наблюдалось; наблюдалось, что ни один из вызовов выше его не меняет.
   - **Путь Restart работает.** После `finish()` первого query его процесс вышел меньше чем за секунду
     (`F:restart-wait-for-exit`). Новый query с `resume` того же разговора и вторым `managedSettings` (имя
     добавлено): `example-notes` `connected`, `source: user` (`F:restart-status`), `session_id` в `system/init` тот
     же (`plugin-mcp-live-restart-same-conversation.jsonl`).
4. **`toggleMcpServer` и `reconnectMcpServer`.** Измерено на чистом сервере пользователя (`source: user`, Session
   после Restart, `setMcpServers` его не трогал) и, в первой Session, на сервере, который взял `setMcpServers`
   (`source: dynamic`). Ответы одинаковые.
   - `toggleMcpServer(name, false)`: ответ пустой, статус `disabled` (`F:restart-user-toggle-off`,
     `F:allowed-toggle-off`). **Выключение не только на эту Session.** Claude Code пишет
     `disabledMcpServers: ["example-notes"]` в запись Project-а (папки `cwd`) в `.claude.json` пользователя
     (`F:restart-user-config-after-toggle-off`, `F:allowed-config-after-toggle-off`). Что следующая Session в этой
     папке стартует с выключенным сервером — вывод из этой записи, не наблюдалось.
   - `toggleMcpServer(name, true)` возвращает `connected` и убирает имя из списка (`F:restart-user-toggle-on`,
     `F:restart-user-config-after-toggle-on`).
   - `reconnectMcpServer(name)`: ответ пустой, статус `connected` (`F:restart-user-reconnect`). Незнакомое имя —
     ошибка «Server not found: example-unknown» (`F:allowed-reconnect-unknown`).
5. **Выключение без `toggleMcpServer`: Restart без сервера.** Тот же разговор, `resume` после выхода процесса,
   сервер убран из `allowedMcpServers` (`F:turnoff-restart-allowlist-without`) или назван в `deniedMcpServers`
   (`F:turnoff-restart-denied`). В обоих случаях сервера в Session нет, и `.claude.json` sandbox-а не изменился
   (`config_unchanged: true`). Следующий query без этих настроек (инвентарь, пункт 6) видит сервер снова,
   `connected` (`F:inventory-status`).
6. **Query инвентаря** (без allowlist-а, без серверов worfy, без сообщения модели).
   - `mcpServerStatus` перечисляет серверы пользователя с именем, статусом и источником: `example-notes`
     `connected` `user`, `example-oauth` `needs-auth` `user` (`F:inventory-status`).
   - Список готов через ~1,2 с после старта, с выходом процесса — ~1,8 с. Транскрипта в `projects` sandbox-а не
     остаётся: файлов до и после поровну. `system/init` без сообщения не приходит (`F:inventory-facts`), так что
     инвентарь берётся только из `mcpServerStatus`.
   - Серверы пользователя при этом запускаются: stdio-сервер `connected`, то есть его процесс стартовал.
   - Connector-ы claude.ai без входа не видны — это вопрос живой проверки владельца, ниже.
7. **OAuth** (`mcpAuthenticate` / `mcpSubmitOAuthCallbackUrl`), на fake-сервере, который отвечает 401.
   - Статус сервера до входа — `needs-auth` (`F:inventory-status`). Если Keychain не читается (fake `security`
     отвечает ошибкой на всё), статус — `failed` с текстом «Couldn't read the stored credentials … keychain is
     locked» (`F:locked-keychain-status`).
   - `mcpAuthenticate("example-oauth")` без `redirectUri`. Ответ: `{ authUrl, requiresUserAction: true,
     callbackExpected: true, redirectScheme: "localhost", state, callbackPort }` (`F:oauth-authenticate`).
     Параметры `authUrl`: `client_id`, `code_challenge`, `code_challenge_method`, `redirect_uri`, `resource`,
     `response_type`, `state`.
   - Claude Code сам прошёл discovery и dynamic client registration. Запросы к fake: `POST /mcp`,
     `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-authorization-server`,
     `POST /register`, затем `POST /token` (`F:oauth-fake-server-requests`). Браузер он не открыл: fake `open` не
     вызван, URL отдан хозяину.
   - На `localhost:<callbackPort>` слушает Claude Code: GET туда с `error=access_denied` и `state` попытки ответил
     HTTP 200 со страницей (`F:oauth-listener-get`). Что редирект браузера с `code` на этот порт завершит вход без
     `mcpSubmitOAuthCallbackUrl` — вывод, не наблюдалось: fake токен не выдаёт.
   - `mcpSubmitOAuthCallbackUrl(name, url)` проверяет URL. Без `code` — ошибка «Invalid callback URL: missing
     authorization code…» (`F:oauth-callback-without-code`). С чужим `state` — «Callback URL not accepted: …
     (OAuth state mismatch)…», и вход продолжает ждать (`F:oauth-callback-wrong-state`). С верным `state` Claude
     Code меняет code на токен у token endpoint; fake отказал, и ошибка несёт `error_description` сервера
     (`F:oauth-callback-refused-token`).
   - `mcpClearAuth(name)` — `{}` (`F:oauth-clear-auth`). Незнакомый сервер — «Server not found: …»
     (`F:oauth-authenticate-unknown`). stdio-сервер — «Server type "stdio" does not support OAuth authentication»
     (`F:oauth-authenticate-stdio`).
   - **Connector claude.ai** (чтение бинарника, в sandbox не видно): ответ `{ authUrl, requiresUserAction: true,
     callbackExpected: false }` — вход завершается на claude.ai, callback-а нет. Подтвердит живая проверка.
   - Успешный вход до конца (выдача токена, `needs-auth` → `connected`) не проверен: fake токен не выдаёт.

## Ответы, шаг 5 (Codex 0.166.0, схема)

- `config/mcpServer/reload`: params `null`, ответ `McpServerRefreshResponse` = `{}`. README app-server-а: reload
  планирует обновление для загруженных thread-ов («planned thread refreshes»). `mcpServerStatus/list` с
  `threadId` «reuses the thread's current MCP connection and tool catalog after any pending runtime refresh».
  Значит, подхват в начатом thread-е задуман протоколом. Когда именно обновление доходит до thread-а, README не
  говорит; живьём не проверено.
- `mcpServerStatus/list`: params `cursor`, `limit`, `detail` (`full` | `toolsAndAuthOnly`), `threadId`,
  `serverName`. Строка: `name`, `runtimeStatus` (`notStarted` | `starting` | `connected` | `authenticationRequired`
  | `failed` | `cancelled` | `disabled` | `null` — «null when unavailable or the configuration changed»),
  `authStatus` (`unknown` | `unsupported` | `notLoggedIn` | `bearerToken` | `oAuth`), `tools`, `toolsError`,
  `httpOrigin`, `pluginId`, `serverInfo`. Без `threadId` discovery поднимает своё соединение с сервером.
- `mcpServer/oauth/login`: params `name`, `threadId?`, `clientRegistration?`, `scopes?`, `timeoutSecs?`; ответ
  `{ authorizationUrl, loginId? }` (только HTTP(S)); итог — уведомление `mcpServer/oauthLogin/completed`
  (`name`, `threadId`, `loginId`, `success`, `error`). Статус старта — `mcpServer/startupStatus/updated`
  (`starting` | `ready` | `failed` | `cancelled`, `error`, `failureReason`).


## Выбранный вызов по каждому пути

| Путь | Вызов | Restart с тем же разговором |
|---|---|---|
| Сервер из конфигурации пользователя (scope `user`, `local`, `project`), имя уже в `mcp.allowed` | `reloadPlugins()`, затем `mcpServerStatus()` | не нужен |
| Сервер вне списка, Allow | живого вызова нет | **нужен**: имя в `mcp.allowed`, выход старого процесса, `resume` с новым `managedSettings` |
| Turn off / Turn on for this Session | `toggleMcpServer` не годится (пишет `.claude.json`) | **нужен**: `resume` без сервера в `managedSettings` этой Session (или с ним обратно) |
| Connector claude.ai | ждёт живой проверки владельца | ждёт живой проверки |
| Codex, новый сервер в конфигурации | `config/mcpServer/reload`, затем `mcpServerStatus/list` с `threadId` | по схеме не нужен; живьём не проверено |

## Решения для Ticket-ов

- **Ticket 02** (статус и Reconnect): Reconnect — `reconnectMcpServer`. Источник `dynamic` после `reloadPlugins` у
  сервера пользователя сводится к «user config» только при помощи памяти о том, откуда сервер пришёл; иначе он
  станет «worfy». Выключения в Ticket-е 02 больше нет: оно переехало в Ticket 03 (ниже).
- **Turn off for this Session — решено без владельца 2026-11-12, ждёт подтверждения** (spec, «Решено без
  владельца» 2). worfy не зовёт `toggleMcpServer`: он пишет `disabledMcpServers` в `.claude.json` пользователя, а
  владелец решил «выключить для этой Session» (Q5). Turn off = Restart с тем же разговором, где сервера нет в
  `managedSettings` этой Session: имя убрано из `allowedMcpServers`, а без списка Profile — названо в
  `deniedMcpServers`. Turn on = тот же Restart с сервером обратно. Свои серверы worfy выключаются так же (их нет в
  `mcpServers` и в списке). В `.claude.json` ничего не пишется, новая Session снова получает все серверы. Это
  Ticket 03, у которого Restart.
- **Ticket 03** (подхват, Restart, выключение):
  - Разрешённый сервер, добавленный на ходу, — живой подхват через `reloadPlugins()`, без Restart.
  - `reloadPlugins` перечитывает и plugin-ы, и команды, и меняет список tools, то есть бьёт по prompt cache.
    Опция `holdOnCacheImpact` (ответ `held: true` и `cache_impact`) есть, но в spike-е не пробовалась. Ticket 03
    решает, просить ли подтверждение.
  - Restart с тем же разговором нужен для Allow (Ticket 05), для Turn off / Turn on и как запасной путь. Работает:
    `resume` после выхода процесса, как в ADR-0064.
- **Ticket 05** (Allow, инвентарь, OAuth):
  - Allow = запись в `mcp.allowed` + Restart с тем же разговором; живого пути нет.
  - Query инвентаря — `mcpServerStatus` у query без сообщения, без allowlist-а и без серверов worfy, закрыть
    после выхода серверов из `pending`. ~1,8 с, транскрипта нет, кэшировать. Перечисляет ли он connector-ы — ждёт
    живой проверки. Если нет — запасной путь spec-а: имя вручную в Project settings и подсказка.
  - OAuth: `mcpAuthenticate(name)`, `authUrl` открыть в системном браузере. Слушатель callback-а на localhost у
    Claude Code есть (`F:oauth-listener-get`); что вход по нему завершается сам — вывод, Ticket 05 проверяет это
    test-ом на fake, который выдаёт токен. `mcpSubmitOAuthCallbackUrl` — для случая, когда редирект на localhost не
    доходит (Linked machine): пользователь вставляет URL.
  - Метод недокументирован. `test/contract/sdk-compat.test.ts` его пока не проверяет; добавить туда
    `typeof q.mcpAuthenticate === 'function'` и форму ответа по `F:oauth-authenticate` — работа Ticket-а 05.
  - Запасной путь, если метод уйдёт: подсказка «войти через `/mcp` в терминальном Claude Code».
- **Ticket 06** (Codex): `mcpServerStatus/list` с `threadId`, Reconnect через `config/mcpServer/reload`, вход —
  `mcpServer/oauth/login` + уведомление `oauthLogin/completed`. Сценарий fake app-server-а с этими методами,
  проверенный JSON Schema (`test/contract/codex-fake.test.ts`), — работа Ticket-а 06.

## Живая проверка connector-а claude.ai — шаги для владельца (вручную, 10–15 минут)

Агент со входом владельца ничего не запускает. Модель не вызывается ни на одном шаге: query получает только
control-запросы. Скрипт печатает имена, статусы и источники серверов и есть ли `authUrl`, но не сам URL.

1. Нужны вход в Claude Code (терминал, подписка) и connector в claude.ai, который ещё не подключён.
2. В терминале, в корне любого worktree worfy с установленными зависимостями (не в main checkout), запустить:

   ```sh
   node --input-type=module -e "
   import { query } from '@anthropic-ai/claude-agent-sdk'
   import { createInterface } from 'node:readline/promises'
   const rl = createInterface({ input: process.stdin, output: process.stdout })
   const q = query({ prompt: (async function* () { await new Promise(() => {}) })(), options: { cwd: process.cwd(), settingSources: ['user', 'project', 'local'] } })
   const show = async (t) => { await new Promise((r) => setTimeout(r, 4000)); console.log(t, (await q.mcpServerStatus()).map((s) => [s.name, s.status, s.source].join(' '))) }
   await show('1 start:')
   await rl.question('Connect the connector in claude.ai, then press Enter ')
   await show('2 no call:')
   console.log('3 reloadPlugins:', (await q.reloadPlugins()).mcpServers.map((s) => [s.name, s.status, s.source].join(' ')))
   await show('4 after reload:')
   const name = await rl.question('Name of a connector in needs-auth (empty: skip) ')
   if (name) { const a = await q.mcpAuthenticate(name); console.log('5 mcpAuthenticate keys:', Object.keys(a ?? {}), 'callbackExpected:', a?.callbackExpected) }
   q.close(); rl.close()
   "
   ```

3. Записать сюда, что напечатали шаги 1–5:
   - перечисляет ли query без allowlist-а connector-ы claude.ai (шаг 1; `source: claudeai`) — это и есть query
     инвентаря;
   - появился ли новый connector без вызова (шаг 2) или после `reloadPlugins` (шаги 3–4);
   - что вернул `mcpAuthenticate` для connector-а (шаг 5): ключи и `callbackExpected` (по чтению бинарника —
     `false`).
4. Если connector не виден на шаге 1 — запасной путь Ticket-а 05 (имя вручную в Project settings).

### Итог живой проверки (вручную)

- [ ] (вручную) Query без allowlist-а перечисляет connector-ы claude.ai: …
- [ ] (вручную) Connector, подключённый во время query, подхватывается: без вызова / `reloadPlugins` / нет: …
- [ ] (вручную) `mcpAuthenticate` для connector-а: …
