# worfy-mcp-live: MCP-серверы в работающей Session и их статус

Status: принят владельцем 2026-11-11 («все да», Q1–Q11, решения в разделе «Решения владельца»)
Critic: [docs/product/critic/worfy-mcp-live-2026-11-11.md](../../docs/product/critic/worfy-mcp-live-2026-11-11.md) —
Split; возражения 1–3 приняты владельцем 2026-11-11 («все да») и внесены в spec.
Source: просьба владельца 2026-11-11: MCP-сервер, который пользователь добавил во время работающей Session (`claude mcp
add`, connector claude.ai), работает в этой Session без новой, как в Claude Code; UI показывает MCP-серверы Session и
работает ли каждый. Ответы владельца Q1–Q11 того же дня (раздел «Решения владельца»); ADR
[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (MCP-серверы Session-ов worfy — по списку
`mcp.allowed` в Profile), [0064](../../docs/adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md) (relaunch
ждёт выхода старого процесса Claude Code), [0094](../../docs/adr/0094-vendor-seam.md) (seam Vendor-а: части
driver-а); [CONTEXT.md](../../CONTEXT.md) — термины Session, Profile, Project, Vendor, Autopilot, Wave, Linked
machine; страницы Feature [sessions.md](../../docs/features/sessions.md) («Tools and skills are limited by the
Profile») и [vendors.md](../../docs/features/vendors.md) («worfy's tools in Codex»).
Ticket-ы: Epic `worfy-mcp-live`, 8 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`, как у worfy-ui-kit. Ticket-ы — `issues/01`–`issues/08`.

## Проблема

- Session, которую запустил worfy, получает набор MCP-серверов один раз, при старте. Список Profile читается в
  `src/main/vendors/claude/query.ts:90` и `:336–337` и уходит в Claude Code как policy tier: `managedSettings` с
  `allowManagedMcpServersOnly` и `allowedMcpServers` (`src/main/vendors/claude/options.ts:724–729`). Свои серверы
  worfy (`worfy-canvas`, `worfy-browser`, `worfy-mind-map`, серверы plugin-а Harness) добавляются по тому же списку
  (`options.ts:738–761`), plugin Harness идёт с `skipMcpDiscovery` (`:755`).
- Пользователь добавил сервер командой `claude mcp add` или подключил connector в claude.ai, пока Session работает.
  В терминальном Claude Code сервер появляется в той же сессии. В worfy — нет. Попадёт ли он в Session, даже если он
  есть в `mcp.allowed`, никто не проверял.
- Сервер вне списка `mcp.allowed` в Session не попадает совсем (ADR-0021). Пользователь об этом не узнаёт: в UI
  нет ни списка серверов Session, ни их статуса. Список в Project settings (`src/renderer/projects/EditProfile.tsx:398`,
  поле «MCP servers») — простой список имён, без статуса.
- Claude Code сообщает список серверов в `system/init` (`mcp_servers`), но worfy это поле отбрасывает: схема `sdkInit`
  (`src/shared/vendors/claude/events.ts:24–32`) и событие `init` (`:166–180`) его не знают. В `QueryHandle`
  (`src/main/agent/session/types.ts:68–85`) нет ни одного вызова про MCP.
- Сервер, который policy tier отсёк, Claude Code в `system/init` не сообщает: в записанном fixture-е
  `test/fixtures/sdk-messages/plugin-mcp-name-user-qmd-allow-qmd.jsonl` его нет, а в
  `plugin-mcp-name-user-qmd-no-allowlist.jsonl` (без списка) он есть. Имя connector-а claude.ai не лежит ни в одном
  файле, который worfy читает сам (`~/.claude.json`, `.mcp.json`).
- Сервер, которому нужен вход (OAuth), молча не работает. Сервер, упавший при старте, не переподключить, кроме как
  новой Session.
- У Codex то же. worfy отдаёт Codex-у только свои серверы по списку (`src/main/vendors/codex/mcp.ts:143–154`); серверы
  пользователя из конфигурации Codex «остаются как есть», их статус worfy не читает.

## Решение

- В шапке Session появляется chip «MCP n/m». Он открывает popover со списком серверов Session. У каждой строки:
  имя, статус, число tools, текст ошибки, источник и действия.
- Статусы: connected, failed, needs-auth, pending, disabled — как их сообщает Vendor. У Session Claude есть ещё свой
  статус worfy «не разрешён в этом Project» для сервера вне `mcp.allowed`. У Codex такого статуса нет (Q8).
- Источник: claude.ai, user config, Project, worfy (свои серверы worfy и plugin Harness).
- Действия: Reconnect (failed), Turn off for this Session, Allow (сервер вне списка, только Claude), Sign in
  (needs-auth).
- Allow пишет имя в `mcp.allowed` Profile-а и включает сервер в работающей Session. ADR-0021 остаётся: по умолчанию
  Session получает только серверы списка.
- Имена и статус серверов вне списка worfy узнаёт из служебного query инвентаря: query Claude Code без allowlist-а и
  без вызова модели (Q11).
- Сервер, добавленный пользователем во время Session и разрешённый списком, появляется в той же Session. Если Vendor
  этого не умеет, строка предлагает «Restart Session with the same conversation»: resume, контекст сохраняется. Новый
  процесс стартует только после выхода старого, как relaunch по ADR-0064.
- Тот же статус стоит рядом с каждым именем в списке MCP Project settings.
- Codex получает тот же chip и список после Claude, через свои вызовы app-server-а. Свои серверы пользователя Codex
  показывает как есть.
- В Autopilot набор серверов фиксируется в начале каждой Wave. Подхвата посреди Wave нет, статус виден.

## Решения владельца (2026-11-11, Q1–Q11)

Q1–Q7 — первый раунд, кратко:

- **Q1.** ADR-0021 остаётся: по умолчанию Session получает только серверы списка `mcp.allowed`. Сервер вне списка
  виден как «не разрешён в этом Project» с кнопкой «Allow» (английский текст UI); Allow пишет сервер в `mcp.allowed`
  Profile-а и включает его в работающей Session.
- **Q2.** Chip «MCP n/m» в шапке Session открывает popover: у каждого сервера статус (connected / failed / needs-auth /
  pending / disabled / not allowed), число tools, текст ошибки, источник (claude.ai, user config, Project, worfy). Тот
  же статус — рядом с каждым именем в списке MCP Project settings (`EditProfile.tsx:398`).
- **Q3.** Первый Ticket — spike на нынешнем SDK: какой вызов подхватывает новый сервер в работающем query. Если живой
  подхват невозможен — кнопка «Restart Session with the same conversation» (resume, контекст сохраняется). Test-ы
  никогда не зовут настоящие модели. Как устроен spike, уточнил Q9.
- **Q4.** Codex тоже, тот же chip и список, после Claude. В протоколе app-server-а (версия 0.166.0) есть
  `mcpServerStatus/list`, `config/mcpServer/reload`, `mcpServer/oauth/login` и уведомление о статусе сервера.
- **Q5.** Действия в списке: Reconnect (failed), выключить для этой Session, Allow in Project и вход (OAuth) изнутри
  worfy для needs-auth. Для Claude — то, что даёт SDK; если ничего, решает spike, а Ticket называет запасной путь
  (вход сервера в системном браузере или подсказка, где войти).
- **Q6.** Autopilot (Run без человека) фиксирует набор серверов в начале каждой Wave; подхвата посреди Wave нет; список
  статус показывает.
- **Q7.** Маленький Epic, Wave-ы по зависимостям; последний Ticket — приёмка владельцем; один Ticket документации для
  страниц `docs/features` (en + ru).

Q8–Q11 — второй раунд, по вопросу spec-а и трём возражениям критика:

- **Q8 (вариант а).** Codex показывает свои серверы пользователя как есть: статуса «не разрешён» и кнопки Allow у
  Codex нет. Применять ли список `mcp.allowed` к серверам пользователя в Codex — решение позже, оно в «Не в этом
  Epic-е».
- **Q9 (возражение 1 критика).** Spike (Ticket 01) — новый сценарий `mcp-live` в уже существующем
  `scripts/spikes/harness-plugin/probe.ts`, а не probe на одноразовой ветке. Sandbox как у сценариев `install` и
  `mcp-name`: HOME и CLAUDE_CONFIG_DIR во временной папке, без входа, без вызова модели; fixture-ы проходят через
  scrub probe-а и его `--rescrub`. Сценарий пишет сервер в конфигурацию sandbox-а, пока query работает, пробует
  `reloadPlugins`, `setMcpServers` и второй `managedSettings` и записывает `mcpServerStatus`. Он же пробует query
  инвентаря из Q11 и форму недокументированных `mcpAuthenticate` / `mcpSubmitOAuthCallbackUrl`, если её видно без
  входа. Запускает сценарий агент. Живая проверка владельца — только connector claude.ai. Wave 2 (Ticket 02) её не
  ждёт; ждут только части, которые касаются connector-а.
- **Q10 (возражение 2 критика).** Бывший Ticket 02 разрезан на два. Ticket 02 — путь чтения статуса: схема строки,
  событие `mcp`, каналы, Reconnect, Turn off for this Session. Ticket 03 — подхват разрешённого сервера на ходу,
  «Restart Session with the same conversation» и правило Autopilot «набор серверов фиксирован в начале Wave».
  Restart строится на уже существующем пути перезапуска после выхода процесса (`SessionRegistry.start(…, after)` в
  `src/main/agent/session/registry.ts`, ADR-0064); второго процесса на одном транскрипте нет никогда. Chip (04) и
  Codex (06) ждут только Ticket 02 и идут параллельно с 03.
- **Q11 (возражение 3 критика).** Имена и статус серверов и connector-ов вне списка даёт служебный query инвентаря:
  query Claude Code с настройками пользователя, но без allowlist-а и без вызова модели (как сценарии probe-а без
  модели). Он запускается, когда пользователь открывает список, и при старте Session; ответ кэшируется. Spike
  (Ticket 01) проверяет, перечисляет ли этот query connector-ы claude.ai. Если нет — запасной путь: в Project
  settings пользователь вписывает имя connector-а в `mcp.allowed` вручную, а список серверов показывает подсказку,
  как это сделать.

## Что уже есть в SDK и в протоколе Codex

Версия SDK по `package.json` и `pnpm-lock.yaml` `origin/main` — `@anthropic-ai/claude-agent-sdk` **0.3.322**. Строки
ниже — `sdk.d.ts` 0.3.322 (из `node_modules` worktree-а с этой версией). В `node_modules` main checkout-а лежит 0.3.289,
там те же вызовы стоят примерно на 120 строк раньше.

- `Query.mcpServerStatus()` (`:3145`) — список `McpServerStatus` (`:1300`): `name`, `status` (`connected` | `failed` |
  `needs-auth` | `pending` | `disabled`), `error`, `config`, `scope`, `source` (строка: `sdk`, `plugin` или scope
  конфигурации — `user`, `project`, `local`, `dynamic`, `managed`, `enterprise`, `claudeai`, `agent`), `tools`.
- `reconnectMcpServer(name)` (`:3284`), `toggleMcpServer(name, enabled)` (`:3292`).
- `setMcpServers(servers)` (`:3338`) — заменяет только динамические серверы. Серверы из файлов настроек он не трогает;
  `.mcp.json` текущей папки и серверы plugin-ов остаются, если их не назвать.
- `reloadPlugins()` (`:3221`) — ответ `SDKControlReloadPluginsResponse` с полем `mcpServers`.
- `applyFlagSettings()` (`:3071`) меняет только flag tier. Отдельного вызова, который меняет `managedSettings`
  работающего query, в `sdk.d.ts` нет.
- **OAuth.** В `sdk.d.ts` вызова входа в MCP-сервер нет. В `sdk.mjs` 0.3.322 у Query есть недокументированные
  `mcpAuthenticate(serverName, redirectUri, { redirectUriOnly })`, `mcpClearAuth(serverName)` и
  `mcpSubmitOAuthCallbackUrl(serverName, callbackUrl)` (control-запросы `mcp_authenticate`, `mcp_clear_auth`,
  `mcp_oauth_callback_url`). Можно ли на них опираться, решает spike (Ticket 01).
- **Probe.** `scripts/spikes/harness-plugin/probe.ts` уже умеет sandbox без входа и без вызова модели (сценарии
  `install`, `mcp-name`), `mcpStatus` (`:383`) зовёт `q.mcpServerStatus()`, scrub и `--rescrub` чистят fixture-ы.
  ADR-0048 (`docs/adr/0048-harness-plugin-spike-results.md:121–122`) уже нашёл: сервер, который worfy передаёт в
  `mcpServers` (`source: dynamic`), `allowedMcpServers` отсекает по имени.
- **Codex 0.166.0** (`src/main/vendors/codex/protocol/VERSION`): запросы `mcpServerStatus/list`,
  `config/mcpServer/reload`, `mcpServer/oauth/login`; уведомления `mcpServer/startupStatus/updated` (тело
  `McpServerStatusUpdatedNotification`: `starting` | `ready` | `failed` | `cancelled`, `error`) и
  `mcpServer/oauthLogin/completed`. У `McpServerStatus` Codex есть `authStatus` (`notLoggedIn`, `oAuth`, …) и tools.

## Истории пользователя

1. Как пользователь, я добавил сервер `claude mcp add` во время Session и хочу, чтобы агент в этой же Session его
   видел, не начиная разговор заново.
2. Как пользователь, я подключил connector в claude.ai и хочу, чтобы открытая Session его получила.
3. Как пользователь, я хочу одним взглядом на шапку Session понять, все ли её MCP-серверы работают.
4. Как пользователь, я хочу видеть, почему сервер не работает: текст ошибки, нужен вход или сервер не разрешён в
   Project.
5. Как пользователь, я хочу переподключить упавший сервер, не перезапуская Session.
6. Как пользователь, я хочу выключить сервер для этой Session, чтобы его tools не тратили контекст.
7. Как пользователь, я хочу разрешить сервер вне списка Project одной кнопкой и сразу пользоваться им.
8. Как пользователь, я хочу войти в сервер, которому нужен OAuth, из worfy, а если нельзя — знать, где войти.
9. Как пользователь, я хочу видеть статус серверов и в Project settings, рядом с именами списка.
10. Как пользователь Codex, я хочу тот же chip и тот же список.
11. Как владелец Autopilot, я хочу, чтобы набор серверов не менялся посреди Wave, а статус был виден.
12. Как пользователь, я не хочу, чтобы имена и адреса моих серверов уходили куда-то, кроме моего экрана.

## Решения по реализации

- **Одна форма строки для обоих Vendor-ов.** В `src/shared/agent/` появляется схема строки сервера (имя файла —
  предложение: `mcp-status.ts`): `name`, `status` (`connected` | `failed` | `needs-auth` | `pending` | `disabled` |
  `not-allowed`), `tools` (число или null), `error` (строка или null), `source` (`claudeai` | `user` | `project` |
  `worfy`), `actions` (`reconnect` | `turn-off` | `turn-on` | `allow` | `sign-in` | `restart`). Источники SDK
  сводятся к четырём: `claudeai` → claude.ai; `user`, `local`, `dynamic` → user config; `project` → Project; `sdk`,
  `plugin` → worfy. Прочие (`managed`, `enterprise`, `agent`) показываются как user config с исходным словом в
  tooltip-е. `not-allowed` и `allow` бывают только у строк Claude (Q8).
- **Строку строит main, renderer только рисует.** Какие действия доступны, решает driver Vendor-а: UI рисует кнопки
  из `actions` и ничего не знает о Vendor-е.
- **Seam — часть mcp driver-а Vendor-а** (`src/main/vendors/mcp.ts`, `McpPart`, ADR-0094 item 2): необязательные
  `status(session)` и `act(session, name, action)`. Claude реализует их в `src/main/vendors/claude/mcp.ts`, Codex —
  в `src/main/vendors/codex/mcp.ts`. Действие `restart` идёт не в driver, а в общий путь перезапуска Session (ниже):
  он одинаков для обоих Vendor-ов.
- **Событие `mcp`.** Как событие `context` (`src/shared/agent/events.ts:139`, `askContext` в
  `src/main/vendors/claude/session.ts:498–512`): main спрашивает статус после `system/init`, после каждого `result`,
  после каждого действия и по запросу renderer-а. Ответ уходит событием `{ type: 'mcp', servers }`. Неудачный запрос —
  «нет данных», ход не падает.
- **Каналы.** `agent.mcp` (`'project'`, `'read'`) — прочитать строки; `agent.mcpAction` (`'project'`, `'write'`) —
  действие. Образец — `agent.commands` и `agent.controls` в `src/shared/ipc/agent.ts:96`, `:105`. На Linked machine
  (машина, которую видно только для чтения) список читается, действия закрыты общим правилом записи.
- **Query инвентаря (Q11).** Строки «не разрешён» берутся не из Session: Claude Code не сообщает серверы, которые
  отсёк policy tier. main запускает служебный query Claude Code с настройками пользователя (`settingSources` как у
  Session), но без `managedSettings`-allowlist-а, без своих серверов worfy и без единого сообщения модели. Он ждёт,
  пока серверы выйдут из `pending`, читает `mcpServerStatus` и закрывается. Запуск — когда пользователь открывает
  список и при старте Session Claude; один query на Project и Machine за раз; ответ кэшируется в памяти main до
  следующего запуска, на диск не пишется. Строки «не разрешён» — серверы из ответа, которых нет в наборе Session.
  Если spike скажет, что connector-ы claude.ai в ответ не попадают, — запасной путь: в Project settings пользователь
  вписывает имя connector-а в `mcp.allowed` вручную, а popover показывает строку-подсказку об этом.
- **Allow** (только Claude) пишет `mcp.allowed` тем же путём, что окно Edit profile: `src/main/ipc/profile-edit.ts`
  через `bin/profile-set` Harness-а. Свой `profile.json` worfy не пишет. Затем driver включает сервер в Session
  способом, который выбрал spike; если такого нет — строка получает действие `restart`.
- **Restart Session with the same conversation** — resume того же разговора с новым набором серверов. Он идёт через
  уже существующий путь перезапуска после выхода процесса: старая Session закрывается, новая запускается
  `SessionRegistry.start(…, after)` (`src/main/agent/session/registry.ts:100`), где `after` — выход старого процесса
  (ADR-0064, `Session.exited`, SIGKILL по таймауту). Новая Session живая сразу, в `starting`, и держит то, что ей
  отправили, до старта процесса. Два процесса никогда не продолжают один транскрипт: ошибка «Session … is already live»
  означает баг, а не путь. Ход в момент нажатия прерывается с вопросом, как у других прерываний. `start` принимает
  `vendor`, поэтому тот же путь годится и для Codex.
- **Autopilot.** Session с `unattended: true` (`options.ts:299`) список не подхватывает посреди Wave: набор серверов
  фиксируется при старте Session Wave. Действия `reconnect` и `sign-in` в ней есть: они не меняют набор. `allow`
  пишет Profile, но включает сервер только со следующей Wave; строка говорит это словами.
- **Приватность — в меру.** Имена, адреса и ошибки серверов пользователя видны только на его экране. В Journal,
  Flight recorder, логи событий и диагностические выгрузки строки статуса и ответ query инвентаря не пишутся; `config`
  (URL, заголовки) из ответа SDK в renderer не передаётся. Fixture-ы и снимки экрана в репозитории — с придуманными
  именами (`example-notes`, `example-tracker`).
- **ADR.** Новый ADR не нужен: решение «по умолчанию только список» не меняется. Ticket 05 дописывает в ADR-0021
  раздел-поправку: Allow из Session, query инвентаря, подхват без новой Session, правило Wave для Autopilot и то, что
  у Codex список к серверам пользователя пока не применяется (Q8).
- **Тексты UI — английские** (ADR-0074), документы — русские.

## Решения по test-ам

- Хороший test проверяет поведение снаружи: какие строки и действия видит пользователь, какой control-вызов ушёл в
  query или app-server, что записано в Profile. Как устроен разбор ответа внутри, test не проверяет.
- **Без моделей и без сети.** Claude — `WORFY_AGENT=fake` (`src/main/agent/fake-query.ts`), Codex — `WORFY_CODEX=fake`
  (`test/fixtures/codex-app-server/fake-app-server.mjs`) с временным `CODEX_HOME`. Fake-и учатся отвечать на
  MCP-вызовы по записанным fixture-ам spike-а. Настоящие Claude Code и Codex test-ы не запускают; OAuth — stub без
  сети. Query инвентаря в test-ах — тот же fake query.
- **Seam 1 — unit:** сведение источника и статуса к строке; какие действия у какой строки; chip «n/m»; строка
  Autopilot.
- **Seam 2 — contract:** driver Claude над fake query, driver Codex над fake app-server; Restart над fake query с
  проверкой порядка «выход старого процесса, затем старт нового»; канал `agent.mcpAction` пишет `mcp.allowed` через
  stub `bin/profile-set` (образец — `test/contract/profile-edit.test.ts`).
- **Seam 3 — e2e:** chip и popover в настоящем Electron на fake query; клик Allow и Reconnect; список в Edit profile
  (образец — `test/e2e/edit-profile.spec.ts`).
- **Сначала падающий test** в каждом Ticket-е кода: красный на старом поведении, это пишется в «Итог».
- Spike (Ticket 01) запускает агент: sandbox probe-а без входа и без вызова модели. Единственная живая проверка —
  владельца, только для connector-а claude.ai, по шагам заметки spike-а. Ticket 02 и вся Wave 2 её не ждут.

## Решено без владельца

1. **Что считает chip.** «n/m»: n — серверы со статусом connected, m — все серверы Session, кроме «не разрешён». Цвет
   chip-а предупреждающий, если есть failed или needs-auth. Строки «не разрешён» стоят в popover-е отдельной группой
   под остальными.
2. **«Turn off for this Session»** выключает сервер только в этой Session. Profile не меняется; новая Session снова
   получит сервер. Включить обратно — та же строка, `Turn on`. Поправка 2026-11-12 (Orchestrator вместо спящего
   владельца, ждёт подтверждения утром): spike (Ticket 01, `spike-mcp-live.md`) показал, что `toggleMcpServer`
   пишет `disabledMcpServers` в запись Project-а в `.claude.json` пользователя, то есть выключает сервер не только
   в этой Session. Поэтому worfy `toggleMcpServer` не зовёт. Turn off = «Restart with the same conversation», где
   сервера нет в `managedSettings` этой Session: имя убрано из `allowedMcpServers`, а без списка в Profile —
   названо в `deniedMcpServers`; свой сервер worfy просто не передаётся в `mcpServers`. Turn on = тот же Restart с
   сервером обратно. В `.claude.json` worfy ничего не пишет. Unattended Session Autopilot-а Turn off не получает:
   это Restart посреди Wave. Turn off и Turn on переезжают из Ticket-а 02 в Ticket 03, где Restart; 02 остаётся
   статусом и Reconnect (меняет разрез Q10), Blocked by и Wave-ы не меняются.
3. **Свои серверы worfy** (`worfy-canvas`, `worfy-browser`, `worfy-mind-map`, `plugin_worfy_qmd`) в списке есть, с
   источником worfy. Выключить их можно; Allow им не нужен — они в списке по умолчанию.
4. **Restart — в этом Epic-е при любом ответе spike-а.** Он нужен хотя бы для сервера, который Vendor не может включить
   на ходу.
5. **Где ждёт живая проверка connector-а.** Ticket 01 закрывается без неё: в заметке spike-а — шаги для владельца. Её
   ждут только пункты про connector claude.ai в Ticket-ах 03 (подхват connector-а) и 05 (строка «не разрешён» и Allow
   для connector-а). Остальное в этих Ticket-ах делается и вливается без неё.

## Не в этом Epic-е

- Отмена ADR-0021 или «все серверы пользователя по умолчанию».
- Применение списка `mcp.allowed` к серверам пользователя в Codex (статус «не разрешён» и Allow у Codex). Причина —
  это решение о цене: оно меняет, какие tools получают уже работающие у пользователя Codex Session-ы, а не то, как
  показан статус. Решение позже (Q8).
- Добавление и удаление серверов из worfy (`claude mcp add` внутри worfy): пользователь добавляет их как привык.
- Подхват посреди Wave в Autopilot.
- Действия на Linked machine: список там только читается.
- Subagent-ы: они наследуют набор Session (ADR-0021), свой chip им не нужен.
- Список MCP в Terminal Node: там Claude Code в терминале, у него свой `/mcp`.

## Ticket-ы

| # | Ticket | Кто | Blocked by |
|---|---|---|---|
| 01 | [Spike: подхват MCP-серверов в работающей Session](issues/01-spike-подхват-mcp-серверов-в-работающей-session.md). Сценарий `mcp-live` в `scripts/spikes/harness-plugin/probe.ts`: sandbox, без входа, без модели; `reloadPlugins`, `setMcpServers`, второй `managedSettings`, `mcpServerStatus`, query инвентаря, форма `mcpAuthenticate`; Codex по fake и схеме. Шаги живой проверки connector-а для владельца | агент (запускает сценарий); владелец — живая проверка connector-а, не блокирует | — |
| 02 | [Статус MCP-серверов Claude Session и Reconnect](issues/02-статус-mcp-серверов-claude-session-reconnect-и-выключение.md): строка, событие `mcp`, каналы, Reconnect (Turn off — в 03, «Решено без владельца» 2) | агент | 01 |
| 03 | [Подхват сервера на ходу, Restart с тем же разговором и Turn off for this Session](issues/03-подхват-сервера-и-restart-с-тем-же-разговором.md): подхват разрешённого сервера, Restart над `SessionRegistry.start(…, after)` и ADR-0064, Turn off / Turn on for this Session через тот же Restart, правило Wave в Autopilot | агент; пункт connector-а ждёт живой проверки владельца | 01, 02 |
| 04 | [Chip «MCP n/m» в шапке Session и статус в Project settings](issues/04-chip-mcp-в-шапке-session-и-статус-в-project-settings.md) | агент | 02 |
| 05 | [Allow in Project, query инвентаря и вход OAuth для Claude; поправка к ADR-0021](issues/05-allow-в-project-и-вход-oauth-для-claude.md) | агент; пункт connector-а ждёт живой проверки владельца | 03, 04 |
| 06 | [Codex: статус MCP-серверов и действия](issues/06-codex-статус-mcp-серверов-и-действия.md) | агент | 02 |
| 07 | [Документация: страницы Feature en и ru](issues/07-документация.md) | агент | 05, 06 |
| 08 | [Приёмка владельцем](issues/08-приёмка-владельцем.md) | владелец | 01–07 |

## Волны

| Wave | Ticket-ы | Почему так |
|---|---|---|
| 1 | 01 | spike; без его ответа неизвестно, каким вызовом подхватывать и что отвечают MCP-вызовы для fixture-ов |
| 2 | 02 | строка, seam, событие и каналы, на которые опираются все остальные |
| 3 | 03, 04, 06 | подхват и Restart (main Claude и `src/main/agent/session/`), UI (`src/renderer/`), Codex (`src/main/vendors/codex/`): общих файлов нет |
| 4 | 05 | Allow, query инвентаря и вход: опираются на подхват и Restart из 03 и кнопки UI из 04 |
| 5 | 07 | документация по сделанному |
| 6 | 08 | приёмка |

Wave — Ticket-ы, которые можно брать параллельно: блокеры закрыты, общих файлов в «Где в коде» нет. Wave, которую
берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave). Имена новых файлов в «Где в коде» —
предложение; implementer сверяет их с `main`. Chip (04) и Codex (06) доходят до владельца на Wave раньше, чем при
одном общем Ticket-е статуса и подхвата.

## Риски

- **Живой подхват невозможен.** Например, policy tier читается только при старте процесса, а `setMcpServers` не
  обходит `allowedMcpServers` (ADR-0048 это уже видел для `source: dynamic`). Тогда Allow и новый сервер пользователя
  работают через Restart с тем же разговором: контекст сохраняется, но ход прерывается. Epic от этого не встаёт.
- **Живая проверка connector-а.** Её делает только владелец, по шагам заметки spike-а, на 10–15 минут. Ticket 02 и
  Wave 2 её не ждут; ждут только пункты connector-а в Ticket-ах 03 и 05.
- **Query инвентаря не видит connector-ы claude.ai.** Тогда работает запасной путь: имя вручную в Project settings и
  подсказка в popover-е. Allow одной кнопкой для connector-а в этом случае нет; «Готово, когда» это учитывает.
- **Query инвентаря запускает серверы пользователя ещё раз.** Каждый запуск поднимает процессы серверов списка
  пользователя на несколько секунд. Модель не вызывается, tools в ход не попадают. Ответ кэшируется, одновременно идёт
  не больше одного query на Project и Machine.
- **Недокументированный вход OAuth.** `mcpAuthenticate` есть в `sdk.mjs`, но не в `sdk.d.ts`: следующая версия SDK может
  его убрать. `test/contract/sdk-compat.test.ts` держит форму вызова, если spike его выберет; запасной путь —
  подсказка, где войти.
- **Обновление SDK меняет `McpServerStatus`.** Поле `source` описано строкой, не перечислением. Сведение к четырём
  источникам терпит незнакомое слово: оно идёт как user config. Сценарий `mcp-live` probe-а и `--rescrub` повторяются
  на новой версии SDK без вызова модели.
- **Цена.** Allow добавляет tools в каждый ход Session. Строка Allow говорит число tools сервера, если оно известно.
- **Windows.** Пути конфигурации пользователя и вход в системном браузере проверяют contract test-ы на Windows runner-е.

## Вопросы владельцу

Открытых вопросов нет: вопрос о списке `mcp.allowed` для серверов пользователя в Codex решён 2026-11-11 (Q8, вариант
(а)).

## Готово, когда

- [ ] Chip «MCP n/m» в шапке Session Claude и Codex открывает список серверов со статусом, числом tools, ошибкой и
      источником.
- [ ] Сервер, добавленный `claude mcp add` или connector-ом claude.ai во время Session и разрешённый списком, работает
      в этой Session — на ходу или через Restart с тем же разговором, как решил spike. Restart не запускает второй
      процесс на тот же транскрипт.
- [ ] В Session Claude сервер вне `mcp.allowed` виден как «не разрешён в этом Project»; Allow пишет его в Profile и
      включает в Session. Это зависит от query инвентаря (Q11): серверы из конфигурации пользователя он даёт всегда;
      connector claude.ai — если spike и живая проверка владельца подтвердили, что query его перечисляет. Если нет,
      connector вписывается в `mcp.allowed` вручную в Project settings, а popover показывает подсказку об этом.
- [ ] В Session Codex серверы пользователя показаны как есть, без «не разрешён» и без Allow.
- [ ] Reconnect, Turn off for this Session и вход для needs-auth работают из списка; где входа изнутри нет, строка
      говорит, где войти.
- [ ] Список MCP в Project settings показывает статус рядом с каждым именем.
- [ ] Autopilot не меняет набор серверов посреди Wave; статус виден.
- [ ] Имена и адреса серверов пользователя не попадают в Journal, Flight recorder и диагностические выгрузки.
- [ ] ADR-0021 дополнен поправкой; страницы Feature en и ru описывают Epic.
- [ ] (manual) Владелец принял Epic.
