# worfy-integrations: несколько MCP-серверов одного сервиса (Jira, Slack, Linear…) на Project, с добавлением, входом и управлением внутри worfy

Status: draft 2026-11-20, владелец не отвечал
Critic: docs/product/critic/worfy-integrations-2026-11-20.md (Split, applied) — возражение 1: в `Blocked by:` добавлены
05 ← 04a, 07 ← 05, 08 ← 06; возражение 2: вход OAuth Ticket-а 04b — `OAuthClientProvider` пакета `@modelcontextprotocol/sdk`
1.32.0 (прямая зависимость), refresh — в transport-е proxy; возражение 3: Ticket 04 разрезан на 04a (вход по token-у) и
04b (OAuth), первая рабочая Integration — после 03, 04a, 05 и 07 (Q10).
Source: просьба владельца 2026-11-20, его слова: «поддержка нескольких Jira, Slack, etc MCP сервисов одновременно,
чтобы настраивалось под разные проекты» и «продумай как удобно сделать добавление новых MCP прямо изнутри ворфи,
менеджить их на уровне проекта, авторизовывать и т.д., ибо очевидно добавлять их просто например с claude plugins вряд
ли получится, ибо он ограничивает 1 MCP на 1 сервис аккаунт». ADR
[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (MCP-серверы Session-ов worfy — по списку `mcp.allowed`
в Profile; поправки 2026-11-12 и 2026-11-13 — Allow на ходу и правило адреса),
[0042](../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Profile целиком на машине, Full mode и Silent
mode), [0052](../../docs/adr/0052-machines-and-linking.md) (секреты связи Machine-ов),
[0078](../../docs/adr/0078-browser-node.md) (Browser profile и флажок «доступен Autopilot»),
[0094](../../docs/adr/0094-vendor-seam.md) (seam Vendor-а), [0109](../../docs/adr/0109-health-check-row-levels-and-feature-reports.md)
(строки Health check); spec [worfy-mcp-live](../worfy-mcp-live/spec.md) и его spike-и
[spike-mcp-live.md](../worfy-mcp-live/spike-mcp-live.md), [spike-claudeai-connectors.md](../worfy-mcp-live/spike-claudeai-connectors.md);
[CONTEXT.md](../../CONTEXT.md) — термины Project, Profile, Session, Machine, Linked machine, Autopilot, Wave, Health
check, Browser profile. Строки кода сверены с `ad2169058` (2026-11-20). Факты из документации и сети — раздел «Факты»,
у каждого ссылка и отметка «проверено» или «не проверено».
Зависит от: Epic-а [worfy-mcp-live](../worfy-mcp-live/spec.md) (13/14, ждёт приёмки владельцем, Ticket 08: chip «MCP
n/m», строки статуса, Restart с тем же разговором) и Epic-а worfy-auth-check (строки Health check, ADR-0109).
Ticket-ы: Epic `worfy-integrations` — 11 Ticket-ов: `issues/01`–`03`, `04a`, `04b`, `05`–`10` появятся после
принятия spec-а. Имена новых файлов ниже — предложение; implementer сверяет их с `main`.

## Проблема

- **Один сервис — один аккаунт.** У пользователя claude.ai connector сервиса один на аккаунт: просьба о нескольких
  аккаунтах одного connector-а открыта без ответа (`anthropics/claude-code#27302`), Slack connector видит один
  workspace (`#44243`), вход Atlassian по OAuth даёт один site за раз (Факт 5). Второй custom connector с тем же адресом
  claude.ai не принимает («A server with this URL already exists», `anthropics/claude-ai-mcp#178`). Владелец работает на
  нескольких клиентов: два Jira, два Slack — обычный случай, и сейчас его не собрать.
- **В worfy MCP-сервер нельзя добавить.** worfy только показывает серверы Claude Code и разрешает их по списку:
  «Добавление и удаление серверов из worfy … пользователь добавляет их как привык» стоит в «Не в этом Epic-е» у
  worfy-mcp-live (`.scratch/worfy-mcp-live/spec.md:258`). Сервер добавляют в терминале (`claude mcp add`) или в
  claude.ai, и он попадает во все Project-ы этой машины (scope user) или в один (scope local), но ни там, ни там нельзя
  сказать «Jira клиента A — Project-у A, Jira клиента B — Project-у B» без ручной правки `~/.claude.json` у каждого.
- **Два сервера на одном адресе worfy не различает.** Список `mcp.allowed` (ADR-0021) сверяет удалённый сервер только
  по адресу, как только в списке есть хоть одна запись `serverUrl` (поправка 2026-11-13, `docs/adr/0021-…:87-110`;
  код — `src/main/vendors/claude/mcp-addresses.ts`, `src/main/vendors/claude/options.ts:805-819`). Две Jira на
  `mcp.atlassian.com` разрешаются или запрещаются только вместе. Claude Code и сам склеивает две записи `.mcp.json` с
  одним адресом (Факт 2в, не проверено).
- **Вход хранит Claude Code, а не worfy.** Вход в удалённый сервер worfy делает недокументированным `mcpAuthenticate`
  (`src/main/vendors/claude/mcp.ts:27-33`); где и под каким ключом Claude Code хранит его token, документация и issues
  говорят по-разному (Факт 2г). У Autopilot (Run без человека) истёкший вход виден только как строка «needs-auth».
- **Codex.** worfy передаёт Codex только свои серверы (`src/main/vendors/codex/mcp.ts:1-12`, `:286-287`); серверы
  пользователя Codex берёт из своего `config.toml`, и список Project-а к ним не применяется (Q8 worfy-mcp-live,
  `.scratch/worfy-mcp-live/spec.md:255-257`).

## Что уже есть

- **Список MCP Project-а.** `mcp.allowed` в Profile читает `src/main/workflow/profile.ts:37`, `:567-578`; query Session
  собирает его в `src/main/vendors/claude/query.ts:341-367` и отдаёт `sessionOptions`. Там он становится policy tier
  Claude Code: `managedSettings.allowedMcpServers` с `allowManagedMcpServersOnly` (`options.ts:805-819`). Серверы,
  переданные в `mcpServers` при старте, policy tier не трогает (`options.ts:29-30`); сервер, добавленный на ходу
  через `setMcpServers`, policy tier отсекает («Blocked by enterprise policy», `spike-mcp-live.md:65-66`).
- **Свои серверы worfy.** `worfy-canvas`, `worfy-browser` и `worfy-mind-map` описаны один раз как `McpServer`
  (`src/main/vendors/mcp.ts:60-75`). Claude получает их SDK-сервером в процессе worfy (`src/main/vendors/claude/mcp.ts:209-231`,
  `options.ts:829-842`), Codex — через endpoint worfy на `127.0.0.1` с token-ом Session в переменной окружения, без
  аргументов процесса и файлов (`src/main/mcp/http-server.ts:1-23`, `src/main/vendors/codex/mcp.ts:9-12`, `:286-287`).
- **Статус серверов Session.** Chip «MCP n/m», строки статуса, Reconnect, Turn off, Allow и Sign in (Epic
  worfy-mcp-live; `src/renderer/session/McpChip.tsx`, `src/main/vendors/claude/mcp-inventory.ts`,
  `docs/features/mcp-servers.md`). Статус рядом со списком в Edit profile — `src/renderer/projects/EditProfile.tsx:404-407`.
- **Project settings.** Окно `src/renderer/shell/ProjectSettings.tsx` с разделами (шаблоны действий, Pull requests,
  Code stories, Team reviewer); настройки worfy о Project-е — `<Project data folder>/settings.json`
  (`src/main/projects/settings.ts:1`, `:25`), не Profile.
- **Секреты.** Связь Machine-ов держит секреты в `link/secrets.json` с правами 0600 в папке 0700 за интерфейсом
  `SecretStore`; Electron `safeStorage` отвергнут, потому что ad-hoc подпись worfy меняется с каждой сборкой и Keychain
  спрашивал бы доступ после каждого обновления Stable copy (`src/main/link/secrets.ts:1-11`, `:17-23`).
- **Образец «вход принадлежит Project-у, агент паролей не видит»** — Browser profile (CONTEXT.md, термин Browser
  profile; ADR-0078, пункт 10 — флажок «доступен Autopilot»).

## Решение

У Project-а появляется раздел **Integrations** в Project settings. Integration — один подключённый аккаунт одного
сервиса с меткой: «Jira — client A», «Jira — client B», «Slack — client A». worfy сам добавляет его (каталог сервисов
или свой адрес), сам входит (OAuth в своём окне или token), сам хранит вход на Machine и сам отдаёт каждой Session
Project-а ровно её Integration-ы как MCP-серверы с уникальными именами. Claude Code и Codex входа не видят: они
говорят с сервером worfy, а worfy — с сервисом. Поэтому предел «один connector на сервис и аккаунт» к Integration-ам
не относится, а `~/.claude.json`, `.mcp.json` и `config.toml` worfy не пишет.

Пять главных решений (подробно — «Решения по реализации», выбор — «Вопросы владельцу»):

1. **Session ходит к Integration через worfy** (Q1). Integration — `McpServer` worfy-proxy: worfy main держит
   соединение с сервисом (streamable HTTP, или stdio-процесс, который запускает сам worfy), а Session получает его как
   SDK-сервер в процессе worfy (Claude) или по адресу на `127.0.0.1` с token-ом Session (Codex) — тем же путём, что
   `worfy-canvas` сегодня. Token сервиса не попадает ни в аргументы процесса, ни в файлы Claude Code; обновление
   access token-а идёт в worfy без Restart Session; два аккаунта на одном адресе сервиса — два разных сервера с
   разными именами.
2. **Аккаунт живёт на Machine, включается в Project** (Q2). Integration заводят из Project settings, и она сразу
   включена в этом Project-е. Другой Project той же Machine включает её одной галочкой, без второго входа. Список всех
   Integration-ов Machine — в Settings → Integrations (выход, удаление, где используется).
3. **Вход — дело worfy** (Q3, Q4, Q5, Q10). Сначала — token-ы (API token, PAT, секреты stdio): с ними первая
   Integration работает раньше всего (Ticket 04a). Затем OAuth 2.1 с PKCE (Ticket 04b) на `OAuthClientProvider` пакета
   `@modelcontextprotocol/sdk` в окне worfy с отдельным cookie partition на Integration
   (два аккаунта Atlassian не мешают друг другу), регистрация клиента через Dynamic Client Registration; token-ы — в
   хранилище секретов worfy (0600, как у связи), не в Profile и не в репозитории. Где OAuth сервиса закрыт для
   стороннего клиента (Slack, GitHub) — API token или token приложения пользователя.
4. **Список `mcp.allowed` остаётся для серверов Claude Code** (Q9). Integration-ы в нём не живут: включение
   Integration в Project — в `<Project data folder>/settings.json`. Раздел Integrations показывает и серверы Claude
   Code (user, local, `.mcp.json`, connector-ы claude.ai) с нынешним Allow, и предупреждает, когда connector и
   Integration одного сервиса включены вместе.
5. **Autopilot и цена tools** (Q7, «Решено без владельца»). Integration доступна Autopilot-у только с флажком
   «Available to Autopilot» в Project-е, как Browser profile; вход Autopilot не открывает никогда, а tool отвечает
   «Sign-in needed» и Health check показывает строку. У каждой Integration в Project-е — фильтр tools (All, Read only,
   выбранные) с числом tools и их размером в token-ах: так ADR-0021 (цена tools в каждом ходе) соблюдается без
   отказа от второй Jira.

### Как пользователь идёт по экранам

1. Project settings → раздел **Integrations**. Две группы: «worfy integrations» (свои аккаунты) и «From Claude Code»
   (серверы и connector-ы Claude Code с нынешним Allow). Кнопка **Add integration**.
2. Окно **Add integration** — каталог: Jira and Confluence (Atlassian), Slack, Linear, Notion, GitHub, Sentry, Figma и
   **Custom server**. У каждого сервиса — как входят: «Sign in» или «API token». Integration, уже заведённая на Machine
   в другом Project-е, стоит сверху строкой «Use in this Project: Jira — client A (used in 2 Projects)».
3. Пользователь выбирает Jira. Поля: **Label** (по умолчанию «Jira», уникальна на Machine), способ входа
   (**Sign in with Atlassian** или **API token**: e-mail и token, ссылка на страницу token-ов Atlassian). Custom server
   — адрес `https://…` или команда stdio (command, args, переменные окружения; значения переменных, помеченные
   Secret, уходят в хранилище секретов).
4. **Sign in** открывает окно worfy со страницей входа сервиса. Пользователь входит и выбирает site (Atlassian даёт
   один site на вход). Окно закрывается само; строка Integration: «Jira — client A · signed in as a…@client-a.com ·
   client-a.atlassian.net · 41 tools». Ссылка «Open in system browser» в окне — для SSO и passkey.
5. Worfy сразу проверяет Integration (`initialize` и `tools/list`) и показывает число tools и их размер: «41 tools ·
   ~9k tokens». Фильтр **Tools**: All, Read only (по подсказке `readOnlyHint` сервера), Choose…
6. Галочка **Available to Autopilot** (по умолчанию выключена). Галочка **Enabled in this Project** — включена.
7. Пользователь повторяет шаги 2–6 для «Jira — client B» в другом Project-е. В первом Project-е её нет, пока он её не
   включит.
8. Новая Session Project-а получает серверы `jira-client-a` (и `worfy-canvas`, и разрешённые серверы Claude Code). В
   chip «MCP n/m» Integration — строка с источником «worfy integration» и меткой. Integration, включённую в работающей
   Session, подключает Restart with the same conversation (как Allow сегодня).
9. Вход истёк и не обновляется: строка Integration в Project settings, в chip и в Health check — «Sign-in needed», с
   кнопкой **Sign in**. Session, которая зовёт её tool, получает ответ «Sign-in needed: Jira — client A. Ask the user to
   sign in in worfy», а не молчание.
10. **Sign out** удаляет token-ы, cookie partition окна и (где сервис даёт revocation endpoint) отзывает token.
    **Remove** удаляет Integration с Machine, после подтверждения, если она включена ещё в других Project-ах.

### Экран (набросок)

```
Project settings — client-a-app
  Integrations
  ┌ worfy integrations ──────────────────────────────────────────────────────── [ Add integration ] ┐
  │ ● Jira — client A     client-a.atlassian.net · a…@client-a.com   41 tools ~9k  [All ▾] [✓ Autopilot] … │
  │ ● Slack — client A    client-a.slack.com                          12 tools ~3k  [Read only ▾] [ ] …    │
  │ ▲ Linear — client A   Sign-in needed                                             [ Sign in ]  …     │
  └──────────────────────────────────────────────────────────────────────────────────────────────────┘
  ┌ From Claude Code ─────────────────────────────────────────────────────────────────────────────────┐
  │ claude.ai Atlassian   connector   Not allowed  [ Allow ]   ⚠ Jira — client A is also enabled        │
  │ qmd                   user        Allowed      [ ✓ ]                                                │
  └──────────────────────────────────────────────────────────────────────────────────────────────────┘
  «…» — Test, Re-sign in, Rename, Sign out, Disable in this Project, Remove from Machine
```

## Факты

Проверено — прочитано на странице, в коде или получено запросом 2026-11-20. Не проверено — сообщение пользователя в
issue, вывод или вторичный источник.

1. **Connector-ы claude.ai.**
   а. В Claude Code connector виден под именем `claude.ai <имя>`, грузится только при входе подпиской claude.ai;
      выключается целиком `disableClaudeAiConnectors` или `ENABLE_CLAUDEAI_MCP_SERVERS=false`, по одному —
      `deniedMcpServers`. Сервер, добавленный в Claude Code на тот же адрес, прячет connector. —
      [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp), проверено.
   б. На Team и Enterprise custom connector добавляет Owner, пользователи входят каждый сам; у Free один custom
      connector. — [support.claude.com/…/11175166](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
      проверено.
   в. Один аккаунт на connector; второй connector с тем же адресом отвергается. —
      [anthropics/claude-code#27302](https://github.com/anthropics/claude-code/issues/27302),
      [anthropics/claude-ai-mcp#178](https://github.com/anthropics/claude-ai-mcp/issues/178), не проверено (issues
      пользователей, официального текста нет).
   г. Slack connector — один workspace на аккаунт claude.ai. —
      [anthropics/claude-code#44243](https://github.com/anthropics/claude-code/issues/44243), не проверено.
2. **Claude Code.**
   а. Scope-ы local (`~/.claude.json` под путём Project-а, по умолчанию), project (`.mcp.json`), user; порядок Local >
      Project > User > plugin > connector, запись берётся целиком. Дубли между scope-ами — по имени, plugin-ы и
      connector-ы — по адресу; другой path, query или порт — другой сервер. — [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp),
      проверено.
   б. `claude mcp add` 2.1.323: `-s local|user|project`, `-H/--header`, `--client-id`, `--client-secret`,
      `--callback-port`; `claude mcp login/logout <name>`. — `claude mcp --help`, `claude mcp add --help` на этой
      Machine, проверено.
   в. Две записи `.mcp.json` на один адрес под разными именами: вторая выпадает, Atlassian отвечает не тем site-ом;
      query в адресе (`?product=…`) помогает. — [anthropics/claude-code#89172](https://github.com/anthropics/claude-code/issues/89172),
      не проверено.
   г. Где лежит OAuth token удалённого сервера: документация — «per endpoint»; issue — по имени регистрации сервера;
      сообщения пользователей — в Keychain-записи «Claude Code-credentials», ключ `mcpOAuth` с именем и hash-ем. —
      [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) (проверено, «per endpoint»),
      [anthropics/claude-code#81934](https://github.com/anthropics/claude-code/issues/81934) (не проверено). Ключ
      хранения не проверен — дизайн от него не зависит (решение 1).
   д. `${VAR}` раскрывается в `url` и `headers`, `headersHelper` печатает заголовки командой; tool search откладывает
      MCP tools по умолчанию (`ENABLE_TOOL_SEARCH`). — [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp),
      проверено.
3. **Agent SDK.**
   а. `mcpServers` в Options — stdio, sse, http с `headers`, sdk (сервер в процессе хоста). SDK не открывает браузер и
      не ведёт OAuth: сервер получает `needs-auth`; хост, по документации, делает OAuth сам и передаёт access token в
      `headers`. — [code.claude.com/docs/en/agent-sdk/mcp](https://code.claude.com/docs/en/agent-sdk/mcp), проверено.
   б. `strictMcpConfig` отключает `.mcp.json`, настройки пользователя, plugin-ы и connector-ы; `mcpServers: {}`
      connector-ы не убирает. — [code.claude.com/docs/en/agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript),
      [claude-code-features](https://code.claude.com/docs/en/agent-sdk/claude-code-features), проверено.
   в. SDK передаёт `mcpServers` Claude Code аргументом процесса `--mcp-config <JSON>`: заголовок с token-ом виден в
      `ps` того же пользователя. — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` 0.3.289 (main checkout),
      проверено; на закреплённой в `package.json` 0.3.322 не проверено (spike, Ticket 01).
   г. `disallowedTools` убирает tool из контекста модели. — `sdk.d.ts` 0.3.289, строки 1600-1604, проверено.
   д. `setMcpServers` заменяет только серверы, добавленные им; изменённая конфигурация переподключается. —
      [typescript](https://code.claude.com/docs/en/agent-sdk/typescript), проверено; policy tier его серверы отсекает —
      `spike-mcp-live.md:65-66`, проверено.
4. **Codex.**
   а. `[mcp_servers.<id>]`: `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, `enabled_tools`,
      `disabled_tools`, `command`/`args`/`env`; `codex mcp login <name>`. —
      [learn.chatgpt.com/docs/config-file/config-reference](https://learn.chatgpt.com/docs/config-file/config-reference),
      проверено.
   б. OAuth token Codex хранит по ключу `<имя сервера>|<sha256 адреса>[..16]` (Keychain «Codex MCP Credentials» или
      `CODEX_HOME/.credentials.json`): два имени на одном адресе — два входа. —
      [codex-rs/rmcp-client/src/oauth.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/rmcp-client/src/oauth.rs),
      проверено (код).
   в. Ключи `config` у `thread/start` worfy уже использует для своих серверов: `mcp_servers.<имя>` с `url` и
      `bearer_token_env_var` (`src/main/vendors/codex/mcp.ts:168`, `:286-287`), проверено (код worfy).
   г. Project-ный `.codex/config.toml` читается только у доверенных Project-ов. —
      [config-advanced](https://learn.chatgpt.com/docs/config-file/config-advanced), проверено.
5. **Atlassian Rovo MCP Server.** Адрес `https://mcp.atlassian.com/v2/mcp`; OAuth 2.1 — один site на вход («you must
   complete the authorization flow for each site individually»); API token (Basic e-mail:token, у service account —
   Bearer) не привязан к site, но его должен включить admin организации. —
   [support.atlassian.com, troubleshooting](https://support.atlassian.com/rovo/kb/troubleshooting-atlassian-rovo-mcp-authorization-and-session-expiration-in-vs-code/),
   [configuring-authentication-via-api-token](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token),
   проверено.
6. **Slack MCP Server.** `https://mcp.slack.com/mcp`; клиент — зарегистрированное приложение Slack с фиксированным app
   ID (Marketplace или internal), confidential, `client_secret`; admin workspace одобряет клиентов. —
   [docs.slack.dev/ai/slack-mcp-server](https://docs.slack.dev/ai/slack-mcp-server/), проверено. Один workspace на
   вход — не проверено.
7. **Метаданные OAuth серверов** (запрос без входа 2026-11-20: `POST initialize` → 401 и `WWW-Authenticate`, затем
   `/.well-known/oauth-protected-resource` и `/.well-known/oauth-authorization-server`; проверено):

   | Сервис | Адрес | Dynamic Client Registration | Client ID Metadata Document | Публичный клиент (`none`) |
   |---|---|---|---|---|
   | Atlassian | `https://mcp.atlassian.com/v2/mcp` | да | да | да |
   | Linear | `https://mcp.linear.app/mcp` | да | да | да |
   | Notion | `https://mcp.notion.com/mcp` | да | да | да |
   | Sentry | `https://mcp.sentry.dev/mcp` | да | да | да |
   | Figma | `https://mcp.figma.com/mcp` | да (endpoint есть) | нет | нет, только `client_secret_*` |
   | Slack | `https://mcp.slack.com/mcp` | нет | нет | нет, только `client_secret_post` |
   | GitHub | `https://api.githubcopilot.com/mcp/` | нет (сервер авторизации `github.com/login/oauth`) | нет | — |

   Figma принимает только клиентов из своего каталога — [developers.figma.com](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/),
   не проверено. GitHub принимает PAT в `Authorization: Bearer` — пример в [agent-sdk/mcp](https://code.claude.com/docs/en/agent-sdk/mcp),
   проверено; Linear — API key Bearer, Notion — MCP token на Business и Enterprise ([linear.app/docs/mcp](https://linear.app/docs/mcp),
   [developers.notion.com](https://developers.notion.com/docs/get-started-with-mcp)), проверено.
8. **Спецификация MCP, авторизация** (версия 2026-07-28): RFC 9728 metadata обязателен серверу, `resource` (RFC 8707)
   обязателен клиенту в запросах авторизации и token-а; регистрация клиента по предпочтению — Client ID Metadata
   Document, затем заранее выданный client id, затем Dynamic Client Registration (помечена deprecated). —
   [modelcontextprotocol.io/specification/latest/basic/authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization),
   проверено.

Ответы на четыре вопроса исследования коротко:

- **claude.ai:** connector — один аккаунт на сервис; несколько site-ов Atlassian одним OAuth-входом не покрыть
  (покрывает API token); второй connector на тот же адрес claude.ai отвергает (не проверено, issues).
- **Claude Code:** три scope-а, дубли между scope-ами — по имени, у connector-ов — по адресу; две записи на один адрес
  в одном scope склеиваются (не проверено); ключ хранения token-а документация называет «per endpoint» (проверено),
  issues — именем (не проверено).
- **Agent SDK:** `mcpServers` в памяти, OAuth SDK не ведёт — хост входит сам и передаёт заголовок (проверено), но
  заголовок уходит в аргументы процесса (проверено на 0.3.289); SDK-сервер в процессе worfy этого не имеет.
- **Codex:** `mcp_servers` в `config.toml` и в `config` `thread/start`, Bearer из переменной окружения, свой OAuth с
  ключом «имя + hash адреса» (проверено).

## Решения по реализации

Строки ниже сверены с `ad2169058`.

- **Модель.** `src/shared/integrations/types.ts`: `Integration` — `id` (случайный), `service` (ключ каталога или
  `custom`), `label`, `transport` (`http` с `url` или `stdio` с `command`, `args`, `env` без секретов), `auth`
  (`oauth`, `bearer`, `basic`, `header`, `none`), видимые данные входа (аккаунт, site, когда вход) — без секретов.
  `src/shared/integrations/catalogue.ts` — шаблоны: адрес, способы входа, scope-ы, подсказка, где взять token, имя
  по умолчанию. Шаблоны — данные, новый сервис — строка каталога, не код.
- **Где лежит.** Machine: `<WORFY_DATA_DIR>/integrations/integrations.json` (список, без секретов) и
  `integrations/secrets.json` — `SecretStore` из `src/main/link/secrets.ts` со своим файлом (0600 в 0700), ключи
  `<id>:access`, `<id>:refresh`, `<id>:client`, `<id>:env:<NAME>` (Q3). Project: поле `integrations` в
  `<Project data folder>/settings.json` — `[{ id, enabled, tools: 'all' | 'read-only' | string[], autopilot }]`.
  Ни Profile, ни репозиторий, ни `~/.claude.json`, ни `.mcp.json`, ни `config.toml` worfy не пишет: Silent mode и
  Full mode одинаковы.
- **Имя сервера в Session.** Slug метки: латиница, цифры, `-`; не длиннее 24 символов (имена tools Claude Code —
  `mcp__<сервер>__<tool>`, предел длины имени tool-а не проверен); уникально в Project-е; не совпадает ни с сервером
  Claude Code из последнего ответа инвентаря (`mcp-inventory.ts`), ни с префиксом `worfy-`. Совпадение — суффикс `-2`
  и предупреждение в строке.
- **Proxy** (`src/main/integrations/proxy.ts`, Q1). Integration — `McpServer` worfy, у которого tools приходят от
  сервиса. Для этого `McpTool` получает второй вид входа — готовая JSON Schema сервиса вместо zod shape — и SDK-сервер
  Claude строится на низкоуровневом `Server` MCP SDK, а не на `createSdkMcpServer` (`src/main/vendors/claude/mcp.ts:220-228`
  принимает только zod). Сторона сервиса — `Client` пакета `@modelcontextprotocol/sdk` со
  `StreamableHTTPClientTransport` (с `Mcp-Session-Id`, если сервер его даёт) или stdio-процесс, который worfy
  запускает сам, с секретами в окружении, не в аргументах. Пакет становится прямой зависимостью worfy с версией
  1.32.0 — той же, что `pnpm-lock.yaml:3929-3932` уже ставит peer-ом `@anthropic-ai/claude-agent-sdk` 0.3.322 (диапазон
  peer-а `^1.29.0`, `pnpm-lock.yaml:212-215`); вторая копия пакета в сборку не попадает. Одно соединение с сервисом на
  Integration и Machine, общее для всех Session-ов; `tools/list` кэшируется на время Session. Заголовок входа по
  token-у (Ticket 04a) proxy берёт из `SecretStore` при каждом соединении. Для OAuth у transport-а есть место
  `authProvider`: transport сам обновляет истёкший access token и бросает `UnauthorizedError`, когда не может
  (`dist/esm/client/streamableHttp.d.ts:62-73` пакета 1.32.0, проверено). Ticket 05 оставляет это место пустым, Ticket
  04b вставляет туда своего provider-а, и refresh живёт в transport-е, а не в своём коде proxy. Отказ входа (401 при
  token-е, `UnauthorizedError` при OAuth) → ответ tool-а `isError` «Sign-in needed: <метка>…» и статус Integration
  `needs-sign-in`. Фильтр tools Project-а режет и `tools/list`, и `tools/call`. Первая версия proxy передаёт tools
  (текст, картинки, ссылки на ресурсы); `resources`, `prompts`, elicitation и sampling — «Не в этом Epic-е», если
  spike не покажет, что они нужны выбранным сервисам.
- **Session Claude.** `sdkQueryFactory` (`src/main/vendors/claude/query.ts:310-367`) получает Integration-ы Project-а
  вместе с canvas и отдаёт их `sessionOptions` в `mcpServers` как SDK-серверы (рядом с `worfy-canvas`,
  `options.ts:829-842`). Policy tier их не трогает (`options.ts:29-30`), `mcp.allowed` их не называет. Session вне
  Project-а их не получает. Subagent-ы наследуют набор Session. Turn off for this Session у Integration — Restart без
  неё, как у сервера пользователя (`docs/features/mcp-servers.md`).
- **Session Codex** (Q8). Тот же `McpServer` идёт через endpoint `src/main/mcp/http-server.ts` ключом
  `mcp_servers.<имя>` в `config` `thread/start` с `bearer_token_env_var` Session (`src/main/vendors/codex/mcp.ts:286-287`).
  Endpoint сегодня отвечает только `initialize`, `ping`, `tools/list`, `tools/call` (`http-server.ts:20-23`) — этого
  хватает tools-only proxy. Свой OAuth Codex не используется.
- **Вход по token-у — Ticket 04a** (`src/main/integrations/auth/tokens.ts`). Bearer (Linear API key, GitHub PAT,
  Notion MCP token, Atlassian service account), Basic (Atlassian e-mail и API token), свой заголовок (Custom server),
  переменные-секреты stdio — в `SecretStore`; проверка — `initialize` сервиса с этим заголовком. GitHub предлагает и
  token аккаунта `gh`, который worfy уже знает для Project-а, — с предупреждением о его scope-ах. Окна, DCR и живого
  сервиса в test-ах не нужно. Оговорка: Atlassian API token работает, только если admin организации клиента включил
  вход по token-у (Admin → Rovo → Rovo MCP server → Authentication, Факт 5); без этого Jira клиента входит только по
  OAuth, поэтому OAuth остаётся в Epic-е.
- **Вход OAuth — Ticket 04b** (`src/main/integrations/auth/oauth.ts`, Q4, Q5). Протокол не пишется заново:
  `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` 1.32.0 (`dist/esm/client/auth.d.ts:15`; там же
  `discoverOAuthProtectedResourceMetadata`, `startAuthorization` с `resource`, `refreshAuthorization`,
  `registerClient` — строки 268, 361, 418, 466; `clientMetadataUrl` — `:25`; проверено). worfy пишет только provider-а над `SecretStore` (client id и secret, token-ы,
  code verifier), окно и redirect. Discovery RFC 9728 и RFC 8414, Dynamic Client Registration один раз на Integration,
  PKCE S256 и `resource` (RFC 8707) делает пакет; Client ID Metadata Document — одно поле `clientMetadataUrl`, если
  Q5 когда-нибудь выберет (б). Один refresh на Integration за раз при параллельных вызовах — проверяет spike 01; если
  пакет так не делает, provider держит замок сам. Окно — `BrowserWindow` с
  partition `persist:integration-<id>`; redirect `http://127.0.0.1/worfy-oauth/<id>` перехватывается событием
  навигации окна, без listener-а; «Open in system browser» поднимает loopback listener на `127.0.0.1` со случайным
  портом (RFC 8252) и ждёт до 10 минут. Sign out — revocation endpoint (если есть), удаление ключей `SecretStore` и
  `session.fromPartition(…).clearStorageData()`.
- **Slack** (Q6, Ticket 04b). Шаблон Slack просит client id и client secret приложения Slack пользователя (internal
  app его workspace) и ведёт по шагам создания приложения; дальше — тот же OAuth с `client_secret_post`. Без приложения —
  connector claude.ai Slack для одного workspace, как сейчас.
- **Статус.** `IntegrationStatus`: `signed-in`, `needs-sign-in`, `error` (текст сервиса без token-ов), `checking`.
  Строки chip-а «MCP n/m» (`src/shared/agent/mcp-status.ts`) получают источник `integration` и метку; действие Sign
  in у строки Integration открывает окно worfy, а не `mcpAuthenticate`.
- **Health check.** Строка на каждую включённую Integration открытого Project-а: non-critical (ADR-0109), «Jira —
  client A: sign-in needed» с действием Sign in.
- **Autopilot** (Q7). Session без человека получает только Integration-ы с `autopilot: true`; набор фиксирован в
  начале Wave (как Q6 worfy-mcp-live). Окно входа без человека не открывается никогда; отказ — ответ tool-а и строка
  Health check, Run идёт дальше по своим правилам ошибок.
- **Linked machine.** Integration-ы живут на Machine Project-а. Read only — список и статус. Full access — включить,
  выключить, фильтр, Autopilot, Sign in (окно открывается на Machine Project-а, как Sign in сегодня,
  `docs/features/mcp-servers.md:168-175`). Ввод API token-а и Add integration — только на своей Machine: секрет по
  связи не идёт («Решено без владельца», 3).
- **Серверы Claude Code рядом.** Группа «From Claude Code» в разделе Integrations — тот же список, что Edit profile
  (`EditProfile.tsx:404-407`), с Allow и статусом; правка — тем же `bin/profile-set --field mcp.allowed`. Если
  connector или сервер пользователя имеет адрес из каталога, а Integration того же сервиса включена, строка
  предупреждает «two Jira tool sets» и предлагает выключить connector в этом Project-е. Перенос (Q9): у такой строки
  действие «Add as integration» создаёт Integration с тем же адресом и просит вход; `mcp.allowed` не меняется само.
- **Цена tools.** Размер tools Integration — длина JSON их описаний и схем, делённая на 4, как оценка token-ов; число и
  размер видны в строке и в chip-е. Read only — tools с `readOnlyHint: true`; у сервиса без подсказок Read only
  недоступен, и строка говорит почему.
- **ADR.** Новый ADR «Integrations — MCP-серверы, которые ведёт worfy»: proxy, хранение, вход, включение по Project-у,
  отношение к ADR-0021 (список остаётся для серверов Claude Code; Integration-ы — вне него) — поправка ADR-0021
  отдельной строкой Amendments.

## Решения по test-ам

- Stub сервиса MCP на `127.0.0.1` (streamable HTTP, 401 с `resource_metadata`, DCR, PKCE, refresh, revocation) и stub
  stdio-сервера — общие fixture-ы `test/fixtures/integrations/`. Настоящие Atlassian, Slack и Linear test-ы не зовут.
- Contract test-ы: две Integration-ы на одном адресе stub-а с разными token-ами отвечают каждая своим; token не
  появляется в аргументах процесса Claude Code и Codex, в логе, в Journal и в Flight recorder; фильтр tools режет и
  `tools/list`, и `tools/call`; refresh одним запросом при параллельных вызовах.
- Fake app-server Codex и fake query Claude (`src/main/agent/fake-query.ts`) — для пути Session; настоящий Codex
  binary test-ы и spike не запускают.
- e2e test: Add integration (Custom server на stub), Sign in в окне worfy, строка, chip новой Session.

## Риски

- **Proxy не покрывает сервис.** Сервис, чьи tools требуют elicitation, sampling, `resources` или поток от сервера,
  через tools-only proxy работает хуже. Мера: spike (Ticket 01) записывает `capabilities` выбранных сервисов; если
  нужны — Ticket 05 растёт, а сервис без поддержки помечается в каталоге.
- **Сервис закроет DCR.** Спецификация пометила DCR как deprecated (Факт 8). Мера: Client ID Metadata Document у пакета
  MCP SDK — одно поле `clientMetadataUrl` provider-а (Q5, вариант б), второго пути в коде нет.
- **Slack и Figma не пускают стороннего клиента.** Slack — только приложение с secret, Figma — каталог клиентов
  (Факты 6, 7). Мера: Slack — приложение пользователя; Figma — в каталоге с пометкой «may refuse worfy», вход через
  connector claude.ai остаётся.
- **Admin клиента запретил.** Atlassian API token включает admin, Slack-клиентов одобряет admin workspace. worfy
  показывает текст отказа сервиса и ссылку на страницу admin-а, а не «error».
- **Keychain или файл.** Файл 0600 читает любой процесс того же пользователя — как `~/.claude/.credentials.json` на
  Linux и Windows и файловый режим Codex. Правило владельца о соразмерной защите: угроза, которой нужны права самого
  пользователя, документируется, а не закрывается (Q3).
- **worfy закрыт — tools Integration-ов не работают.** Proxy живёт в main, как `worfy-canvas` для Codex сегодня.
  Session, пережившая рестарт worfy, получает ошибку tool-а до Restart.
- **Два набора одного сервиса в Session.** Connector claude.ai и Integration одного сервиса дают агенту два похожих
  набора tools; агент может выбрать не тот аккаунт. Мера: предупреждение в группе «From Claude Code», а в описание
  каждого tool-а Integration proxy дописывает метку («[Jira — client A]»).
- **Имя tool-а длиннее предела API.** Мера: имя сервера до 24 символов; spike проверяет предел.

## Вопросы владельцу

Вопросы о деньгах и необратимых шагах: регистрация приложения Slack или публикация документа CIMD — только варианты
(б) в Q5 и Q6.
Ответ «да» на вопрос принимает рекомендованный вариант (а).

1. **Q1. Как Session ходит к Integration?**
   - (а) Через worfy: Integration — сервер worfy-proxy; Claude получает его SDK-сервером в процессе worfy, Codex — по
     `127.0.0.1` с token-ом Session. Рекомендация: token сервиса не попадает в аргументы процесса (Факт 3в), refresh
     идёт без Restart, два аккаунта на одном адресе не склеиваются (Факт 2в), Claude и Codex — один код.
   - (б) Напрямую: запись `http` с `Authorization: Bearer` в `mcpServers` Session, вход ведёт worfy. Проще, но token в
     `ps`, refresh только Restart-ом, склейка по адресу не проверена.
   - (в) Через Claude Code: worfy пишет записи с уникальными именами в `~/.claude.json` и входит `claude mcp login`.
     Ломает правило «worfy не пишет конфигурацию пользователя» и зависит от непроверенного ключа хранения token-а.
2. **Q2. Кому принадлежит Integration?**
   - (а) Machine; включается в Project галочкой; заводится из Project settings и сразу включена там. Рекомендация:
     один вход на аккаунт, даже когда клиент A — это три репозитория.
   - (б) Только Project-у, как Browser profile. Второй Project того же клиента входит заново.
3. **Q3. Где хранить token-ы?**
   - (а) Файл 0600 в папке данных worfy за `SecretStore`, как секреты связи. Рекомендация: Electron `safeStorage` на
     Mac спрашивает Keychain после каждого обновления Stable copy (ad-hoc подпись, `src/main/link/secrets.ts:6-11`).
   - (б) `safeStorage` (Keychain на Mac, DPAPI на Windows) — после того как подпись worfy станет постоянной.
4. **Q4. Где идёт вход?**
   - (а) Окно worfy со своим cookie partition на каждую Integration, ссылка «Open in system browser». Рекомендация:
     второй аккаунт Atlassian не подхватывает вход первого из браузера.
   - (б) Только системный браузер: там менеджер паролей и SSO, но второй аккаунт — через выход из первого.
5. **Q5. Как worfy регистрируется у сервиса как OAuth-клиент?**
   - (а) Dynamic Client Registration на каждую Integration. Рекомендация: работает сегодня у Atlassian, Linear,
     Notion, Sentry (Факт 7), ничего не публикуем.
   - (б) Client ID Metadata Document: JSON-файл клиента worfy по постоянному `https`-адресу (например, страница
     публичного репозитория). Путь, который спецификация предпочитает, но нужен постоянный адрес.
   - (в) Без OAuth в этом Epic-е: только token-ы.
6. **Q6. Slack?**
   - (а) Шаблон Slack с приложением пользователя (client id и secret его internal app, шаги в окне). Рекомендация:
     Slack не пускает клиента без своего приложения (Факты 6, 7); connector claude.ai Slack для одного workspace
     остаётся.
   - (б) Своё приложение Slack у worfy (Marketplace) — отдельный Epic: регистрация, проверка Slack, secret в сборке.
   - (в) Slack вне Epic-а.
7. **Q7. Integration в Autopilot?**
   - (а) Только с галочкой «Available to Autopilot» в Project-е, по умолчанию выключена. Рекомендация: как Browser
     profile (ADR-0078, пункт 10): Run без человека не пишет в Jira клиента, пока пользователь этого не решил.
   - (б) По умолчанию включена.
8. **Q8. Codex — в этом Epic-е?**
   - (а) Да, тем же proxy (Ticket 06). Рекомендация: путь `127.0.0.1` уже есть у `worfy-canvas`, работы немного.
   - (б) Позже, Claude сначала.
9. **Q9. Что с нынешним `mcp.allowed`?**
   - (а) Остаётся для серверов Claude Code и connector-ов, как есть; автоматического переноса нет; у сервера с адресом
     из каталога — действие «Add as integration». Рекомендация: ничего у работающих Project-ов не ломается.
   - (б) Перенести серверы каталога из `mcp.allowed` в Integration-ы автоматически при первом запуске.
10. **Q10. Первая рабочая Integration — по token-у, OAuth — следующей Wave-ой?** Новый вопрос после возражения 3
    critic-а: он меняет порядок решения 3 («Вход — дело worfy»), а не его состав.
    - (а) Да: Ticket 04a (API token, PAT, секреты stdio) идёт раньше, и две Jira в двух Project-ах работают после
      Ticket-ов 03, 04a, 05 и 07 (конец Wave 4); Sign in через OAuth (Ticket 04b, та же Wave 4) кнопкой на экране
      появляется в Ticket-е 08 (Wave 5). Рекомендация: token покрывает Linear, GitHub, Notion и Atlassian, а token
      Atlassian ещё и не привязан к site (Факт 5). Оговорка: Atlassian API token работает, только если admin
      организации клиента его включил, поэтому OAuth в Epic-е остаётся.
    - (б) Нет: Sign in через OAuth — на первом же экране, первая рабочая Integration ждёт Ticket 04b (на одну Wave
      позже).

## Решено без владельца (подтвердить)

1. **Имя Epic-а** — `worfy-integrations`; термин UI и CONTEXT.md — Integration («Integrations» в Project settings и
   Settings).
2. **Фильтр tools по умолчанию — All**, с числом и размером tools на виду и Read only одним щелчком: пользователь видит
   цену и решает сам; ADR-0021 этим соблюдён без запрета.
3. **Секрет по связи не идёт.** Add integration и ввод token-а — только на Machine Project-а; Linked machine с Full
   access включает, выключает и запускает Sign in там.
4. **Первая версия proxy — только tools.** `resources`, `prompts`, elicitation и sampling — если spike покажет нужду.
5. **Каталог первой версии:** Jira and Confluence, Linear, Notion, Sentry (OAuth worfy и token-ы), GitHub (PAT или
   token `gh`), Slack (по Q6), Figma (с пометкой), Custom server (http и stdio).

## Ticket-ы

После critic-а (Split, 2026-11-20): Ticket 04 разрезан на 04a (вход по token-у) и 04b (OAuth на пакете
`@modelcontextprotocol/sdk`); в `Blocked by:` добавлены 05 ← 04a, 07 ← 05, 08 ← 06 (06 и 08 правят один файл,
`src/shared/agent/mcp-status.ts`). Первая рабочая Integration — после 03, 04a, 05 и 07 (конец Wave 4, Q10).

1. **01 — Spike: Integration через worfy в Claude Code и Codex; что нужно сервисам.** Сценарий `integrations` в
   `scripts/spikes/harness-plugin/probe.ts` (sandbox: HOME и CLAUDE_CONFIG_DIR во временной папке, без входа, без
   модели): две Integration-ы на одном stub-адресе с разными token-ами SDK-серверами в `mcpServers` рядом с
   `managedSettings` с записями `serverUrl` — обе connected, каждая со своим token-ом; `disallowedTools`
   `mcp__<имя>__<tool>` убирает tool из `system/init`; `--mcp-config` в аргументах 0.3.322; предел длины имени tool-а;
   Codex — по схеме app-server и fake app-server, без настоящего binary; на stub-е — делает ли `authProvider`
   transport-а пакета `@modelcontextprotocol/sdk` 1.32.0 один refresh при параллельных вызовах. Шаг владельца (10–15
   минут, по записке spike-а): вход `OAuthClientProvider` пакета (DCR и PKCE) из окна spike-а в Atlassian (два site-а
   — две Integration-ы) и Linear; записать `capabilities`, срок access token-а и refresh.
   Выход — `.scratch/worfy-integrations/spike-integrations.md` и решение «tools-only proxy достаточен: да/нет».
   Blocked by: —.
2. **02 — Прототип экранов**: Card с HTML на выдуманных данных — раздел Integrations, Add integration с каталогом,
   ввод token-а, окно входа, строка Integration, фильтр tools, строки chip-а, Settings → Integrations.
   Blocked by: —.
3. **03 — Модель, хранилище и ADR**: `src/shared/integrations/` (типы, каталог), `src/main/integrations/store.ts`
   (`integrations.json`, `SecretStore` со своим файлом), поле `integrations` в `settings.json` Project-а, каналы
   `integrations.*`, новый ADR и Amendment ADR-0021.
   Blocked by: —.
4. **04a — Вход по token-у**: Bearer, Basic, свой заголовок, переменные-секреты stdio, token аккаунта `gh` — в
   `SecretStore`; проверка `initialize` сервиса; Sign out для token-а (удаление ключей). Каталог помечает, что
   Atlassian API token работает, только если admin организации клиента включил вход по token-у; без этого — OAuth
   (04b).
   Blocked by: 03.
5. **04b — Вход OAuth**: `OAuthClientProvider` пакета `@modelcontextprotocol/sdk` над `SecretStore` (DCR, PKCE,
   `resource` и refresh делает пакет), окно `BrowserWindow` с partition, перехват redirect, «Open in system browser» с
   loopback listener-ом, Sign out с revocation, шаблон Slack с приложением пользователя (по Q6), канал
   `integrations.signIn`; provider вставляется в `authProvider` transport-а proxy 05. Кнопку Sign in на экран и в
   chip ставит 08.
   Blocked by: 01, 03, 05.
6. **05 — Proxy и Session Claude**: `@modelcontextprotocol/sdk` 1.32.0 — прямая зависимость в `package.json` (версия
   из `pnpm-lock.yaml`, как у peer-а Agent SDK); `McpServer` с JSON Schema сервиса, `Client` со
   `StreamableHTTPClientTransport` (место `authProvider` пустое до 04b) и stdio-процесс в main; заголовок token-а из
   04a; одно соединение на Integration, фильтр tools, ответ «Sign-in needed», метка в описании tool-а; SDK-серверы в
   `mcpServers` Session Project-а, имена без совпадений.
   Blocked by: 01, 03, 04a.
7. **06 — Codex**: Integration-ы через `src/main/mcp/http-server.ts` ключами `mcp_servers.<имя>`; строки Codex в chip-е
   (`src/shared/agent/mcp-status.ts`).
   Blocked by: 05.
8. **07 — Раздел Integrations в Project settings и Settings → Integrations**: группы «worfy integrations» и «From
   Claude Code», Add integration (каталог, Custom server http и stdio), метка, ввод token-а, статус, Test, фильтр с
   числом и размером tools (их даёт proxy 05), Available to Autopilot, Rename, Sign out, Disable, Remove с
   подтверждением; предупреждение о двух наборах; «Add as integration». После этого Ticket-а две Jira по token-у
   работают в двух Project-ах.
   Blocked by: 02, 03, 04a, 05.
9. **08 — Sign in, Session, Autopilot, Health check, Linked machine**: кнопка Sign in (OAuth 04b) в разделе
   Integrations и у строк Integration в chip-е (`src/shared/agent/mcp-status.ts`, тот же файл, что у 06), Restart для
   Integration, включённой на ходу; Autopilot — только `autopilot: true`, набор на Wave, без окна; строки Health
   check; права Linked machine.
   Blocked by: 04b, 06, 07.
10. **09 — Документы**: `docs/features/integrations.md` и перевод `docs/features/ru/integrations.md`, правка
    `docs/features/mcp-servers.md` и `projects.md`, термин Integration в `CONTEXT.md`, проверка, что ADR Ticket-а 03
    влит.
    Blocked by: 03, 04a, 04b, 05, 06, 07, 08.
11. **10 — Приёмка владельцем**: две Jira (два site-а) в двух Project-ах — по token-у и по OAuth, Linear или Slack,
    Claude и Codex, Session Autopilot со строкой «Sign-in needed», Mac Stable copy; решения без владельца.
    Blocked by: 01, 02, 03, 04a, 04b, 05, 06, 07, 08, 09.

## Волны

Таблица пересчитана из строк `Blocked by:` выше: Wave Ticket-а — на одну больше самой поздней Wave его блокеров.

| Wave | Ticket-ы | Blocked by | Почему так |
|---|---|---|---|
| 1 | 01, 02, 03 | — | spike (сценарий probe, записка), прототип (Card, файлов репозитория нет), модель и хранилище (`src/shared/integrations/`, `src/main/integrations/store.ts`, ADR): общих файлов нет |
| 2 | 04a | 03 | вход по token-у (`src/main/integrations/auth/tokens.ts`) стоит на хранилище 03 |
| 3 | 05 | 01, 03, 04a | proxy и Session Claude (`src/main/integrations/proxy.ts`, `package.json`, `src/main/vendors/claude/query.ts`, `options.ts`, `mcp.ts`): нужен ответ spike-а 01, модель 03 и заголовок 04a |
| 4 | 04b, 06, 07 | 04b — 01, 03, 05; 06 — 05; 07 — 02, 03, 04a, 05 | OAuth (`src/main/integrations/auth/oauth.ts`, окно входа), Codex (`src/main/vendors/codex/mcp.ts`, `src/shared/agent/mcp-status.ts`) и экран (`src/renderer/shell/ProjectSettings.tsx`, `src/renderer/integrations/`, `src/renderer/settings/`): общих файлов нет; после этой Wave первая Integration работает по token-у (03, 04a, 05, 07) |
| 5 | 08 | 04b, 06, 07 | Sign in на экране и в chip-е, Autopilot, Health check, Linked machine; правит `mcp-status.ts` после 06 |
| 6 | 09 | 03, 04a, 04b, 05–08 | документы по сделанному |
| 7 | 10 | 01–09 | приёмка |

Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave); таблица — прогноз по
Blocked by и спискам файлов.

## Готово, когда

- [ ] В Project settings пользователь добавляет Integration из каталога или свой сервер (http или stdio), с меткой.
- [ ] Две Integration-ы одного сервиса (два site-а Atlassian) работают в одной Machine: каждая в своём Project-е или
      обе в одном, и каждая отвечает данными своего аккаунта.
- [ ] Вход OAuth идёт в окне worfy, token-ы — в хранилище секретов worfy; ни token, ни секрет не появляются в
      Profile, в репозитории, в `~/.claude.json`, `.mcp.json`, `config.toml`, в аргументах процессов, в логе, Journal и
      Flight recorder.
- [ ] Истёкший access token обновляется без Restart Session; неудачный refresh даёт «Sign-in needed» в строке, chip-е,
      Health check и ответе tool-а.
- [ ] Session Claude и Session Codex Project-а получают ровно его включённые Integration-ы с фильтром tools.
- [ ] Autopilot получает только Integration-ы с «Available to Autopilot» и не открывает окно входа.
- [ ] Серверы Claude Code и connector-ы claude.ai видны в разделе с Allow, как раньше; `mcp.allowed` работает как раньше.
- [ ] Новый ADR, Amendment ADR-0021, страница Feature en и ru, термин Integration в `CONTEXT.md`.
- [ ] (manual) Владелец принял Epic.

## Не в этом Epic-е

- Запись серверов в конфигурацию Claude Code или Codex (`claude mcp add`, `.mcp.json`, `~/.claude.json`,
  `config.toml`): Session в терминале остаётся со своими серверами (ADR-0021, «Последствия»).
- Integration-ы в Terminal Node и Terminal AI: там Claude Code в терминале со своим `/mcp`.
- Своё приложение Slack у worfy в Marketplace (Q6, вариант б) и публикация документа CIMD (Q5, вариант б).
- `resources`, `prompts`, elicitation, sampling и MCP Apps через proxy (если spike не покажет нужду).
- Общий доступ к Integration-ам между Machine-ами и перенос token-ов по связи.
- Управление connector-ами claude.ai (добавить, удалить) — это делается в claude.ai.
- Применение `mcp.allowed` к серверам пользователя в Codex (Q8 worfy-mcp-live, решение позже).
