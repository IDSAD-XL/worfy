# Termalin: что это и что из него можно взять в worfy — research

Прочитано 2026-11-10, источники — ниже у каждого факта.

## Коротко

- У Termalin два разных MCP server. Локальный `termalin-mcp` входит в desktop app, работает через stdio, имеет 22 tools и бесплатен на всех планах. Hosted `https://termal.in/mcp` имеет 24 tools и требует Pro или trial (https://termal.in/docs/mcp-tools/).
- Локальный server агент подключает как stdio command: `claude mcp add termalin -- <path>/termalin-mcp`. Путь показывает сам app. Локальный HTTP port нигде не упомянут (https://termal.in/docs/).
- В UI видна работа только tools `terminal_*`. Агент открывает подсвеченный tab или пишет в tab пользователя. Пользователь кликает tile в watch grid и вводит текст сам. Вызовы `ssh_exec` и `session_*` в UI не видны, только в recordings и audit log (https://termal.in/watch-grid/).
- Подтверждения отдельной команды человеком до запуска нет ни в одном источнике. Контроль — переключатели согласия, policy хоста (full / allowlist / blocked) и ручной ввод в ту же сессию (вывод).
- Hosted путь достаёт только серверы с Connector. Connector ставится через `sudo sh` или с правами администратора, держит исходящий WebSocket и настраивает sshd доверять SSH CA Termalin (https://termal.in/connector/).
- Команды, которые AI-агент выполняет через account, сервер Termalin сам отправляет в Anthropic API на проверку злоупотреблений. Это происходит без запроса пользователя. Из текста он хранит только метку серьёзности с короткой причиной (https://termal.in/privacy). Вывод команд проходит через termal.in (https://github.com/termalinapp/termalin-plugin/blob/main/README.md).
- Цены: Free $0. Pro $10/мес помесячно или $8/мес при оплате за год. Team $19 или $15 за пользователя. Lifetime Pro $149. Connector, hosted MCP и API keys — только с Pro (https://termal.in/pricing/).
- Публичного REST API, SDK, URL scheme и partner program не найдено. Сторонняя программа может работать через stdio MCP, hosted MCP (OAuth 2.1 + PKCE + DCR или API key) и стандартный ssh-agent socket приложения (https://termal.in/docs/).
- Зрелость: public beta 0.1.0 — July 2026, v0.1.50 — 2026-10-29. Проект называет себя «small pre-revenue project». Юрлицо не названо. В issue tracker 0 issues. Все публичные коммиты сделал один человек (https://termal.in/security/, https://github.com/termalinapp/termalin).
- Плагины для Claude Code и Codex содержат только hosted MCP URL и 5 skills. Hooks, commands и agents в них нет (https://github.com/termalinapp/termalin-plugin).

## 1. Зрелость: кто стоит за продуктом, хостинг, релизы, issues, стек

- Privacy не называет юрлицо: «Termalin ("we") is the desktop SSH client and cloud service at termal.in» (https://termal.in/privacy).
- Terms не называют юрлицо, применимое право и юрисдикцию. Контакт — hello@termal.in (https://termal.in/terms).
- About перечисляет только адреса и соцсети, без имён людей и компании (https://termal.in/about/).
- «Termalin is a small pre-revenue project and there is no reward budget» (https://termal.in/security/).
- Все коммиты во всех пяти публичных репозиториях сделал один автор. В его профиле GitHub нет company и location (https://api.github.com/repos/termalinapp/termalin-plugin/commits). Посты блога подписаны «Termalin Team» (https://termal.in/blog/take-it-out-of-the-map-rust-sessions/).
- Хостинг: «The backend runs in Docker behind Cloudflare, with TLS 1.2+ (Let's Encrypt certificates)». База доступна только с localhost хоста (https://termal.in/security/).
- «Independent third-party penetration test — Planned before GA». SOC 2 — «On the roadmap». Bug bounty нет (https://termal.in/security/).
- About пишет «We release on a roughly monthly cadence» (https://termal.in/about/). Changelog показывает другое: 0.1.0–0.1.13 в July, 0.1.14–0.1.41 в August, 0.1.42 в September, 0.1.43–0.1.50 в October 2026. Серверные изменения есть и в November 2026 (https://termal.in/changelog/).
- На GitHub 11 releases: от v0.1.28 (2026-08-06, только Windows) до v0.1.50 (2026-10-29). Восемь из них вышли в October 2026. Версий 0.1.31–0.1.41 на GitHub нет, они есть только в changelog (https://api.github.com/repos/termalinapp/termalin/releases).
- Issues: в `termalinapp/termalin` за всё время 0 issues, ни открытых, ни закрытых. По всей org тоже 0 (GitHub search API, запросы `repo:termalinapp/termalin` и `org:termalinapp`). README называет репозиторий «release notes and the issue tracker» (https://github.com/termalinapp/termalin).
- Hosted server есть в official MCP Registry как `in.termal/termalin-web`: v1.0.0 от 2026-08-05, v1.1.0 от 2026-11-04 (https://registry.modelcontextprotocol.io/v0/servers?search=in.termal).
- Стек: «Rust core + tab hibernation», терминал — «Real xterm-256color sessions» (https://termal.in/features/). SSH-слой — russh, async runtime — tokio (https://termal.in/blog/take-it-out-of-the-map-rust-sessions/).
- Windows: установщик Inno Setup, `termalin.exe` загружает `termalin_core.dll` (https://github.com/termalinapp/scoop-termalin/blob/main/bucket/termalin.json). macOS: bundle `termalin.app`, bundle id `in.termal.desktop`, Developer ID и notarization (https://github.com/termalinapp/homebrew-termalin/blob/main/Casks/termalin.rb).
- Standalone .exe для Windows не подписан, SmartScreen пишет «unknown publisher». Сборка из Microsoft Store подписана (https://termal.in/download/).

Неизвестно: юрлицо, страна регистрации, применимое право; регион серверов и данных; UI framework desktop app — ни один источник не называет Electron, Tauri, Flutter или native UI (отдельная `termalin_core.dll` рядом с exe говорит о схеме «UI + Rust core library», вывод); скорость ответа мейнтейнеров (issues нет); состояние сервиса — https://status.termal.in/ рендерится только JavaScript, текст не получен.

## 2. Локальный MCP server в desktop app

Подключение:
- `termalin-mcp` — бинарник из комплекта desktop app. Транспорт — stdio, 22 tools (https://termal.in/docs/mcp-tools/).
- Claude Code: `claude mcp add termalin -- <path>/termalin-mcp`. Config для Claude Desktop, Cursor и других: `{"mcpServers":{"termalin":{"command":"<path>/termalin-mcp"}}}` (https://termal.in/mcp/).
- Codex: `[mcp_servers.termalin]` и `command = "<path>/termalin-mcp"` в `~/.codex/config.toml`, или `codex mcp add termalin -- <path>/termalin-mcp` (https://termal.in/codex-ssh/).
- Путь и команду app показывает в Settings → Security → "Agent Access (MCP)" → "Connect an assistant". Там есть Copy command и Run it for me для Claude Code и готовый config для Claude Desktop, Cursor, Windsurf, Cline (https://termal.in/docs/).
- Локальный HTTP port или HTTP transport не упомянуты ни в одном прочитанном источнике.

Account, план, запущенный app:
- «The local server is free on every plan» (https://termal.in/docs/).
- Desktop app «works without an account» (https://termal.in/terms) и «works fully offline» (https://termal.in/docs/). Значит, account для локального MCP не нужен (вывод).
- Tools `terminal_*` управляют запущенным app «through its consent-gated control server». Tools `data_*` требуют запущенный и разблокированный app (https://termal.in/docs/mcp-tools/).
- Про остальные tools источники расходятся. `session_open` — «the agent's own headless connection — no app needed» (https://termal.in/docs/mcp-tools/). Troubleshooting велит сначала проверить, «that the app is running» (https://termal.in/docs/).
- Ключи держит ssh-agent самого app. Поэтому для хостов с ключом app, скорее всего, должен работать и быть разблокирован (вывод).

Какие хосты видит агент:
- Только хосты, отмеченные в Settings → MCP. Агентский доступ выключен по умолчанию (https://termal.in/ssh-for-ai-agents/).
- App пишет для MCP server host inventory «with agent-only auth entries — no passwords or keys land in that file» (https://termal.in/blog/connect-claude-code-to-your-server-over-ssh/).
- Переключатели согласия раздельные и выключены по умолчанию: "Agent in Terminal", "Let agents run commands", "Let agents use the local terminal", "Let agents query your databases" (https://termal.in/docs/).
- `terminal_hosts` и `terminal_sessions` требуют "Agent in Terminal". `terminal_open`, `terminal_run`, `terminal_run_many` требуют "Let agents run commands" (https://termal.in/docs/mcp-tools/).

Tools, 22 штуки (https://termal.in/docs/mcp-tools/):
- Общие с hosted: `hosts_list`, `generate_password`, `ssh_exec`, `sftp_list`, `data_tables`, `data_schema`, `data_query` (`maxRows` 200 по умолчанию).
- Только локальные: `session_open/exec/close/list`, `tunnel_open/close/list` (local forward или SOCKS5), `sftp_get` (до 4 MB, бинарное — base64), `sftp_put`, `terminal_hosts`, `terminal_sessions`, `terminal_open`, `terminal_run`, `terminal_run_many` (`timeoutSeconds` 120 по умолчанию, до 3600), `data_list`.
- `ssh_exec` открывает новое соединение на каждый вызов. `cd` и переменные между вызовами не сохраняются.

Как пользователь видит работу агента:
- `terminal_open` открывает «a background tab in your app that glows». `terminal_run` выполняет команду в tab пользователя «as if you typed it», и tab подсвечивается (https://termal.in/docs/mcp-tools/).
- Watch grid показывает каждый открытый tab как live tile. Tiles read-only, пока пользователь не кликнет. Выбранный tile принимает ввод с клавиатуры: «the same session, live, no reconnect» (https://termal.in/watch-grid/).
- Вызовы `ssh_exec`, `session_*` и hosted MCP «run outside the app and do not appear as tiles». Их видно только в recordings и audit log (https://termal.in/watch-grid/).
- Подтверждения отдельной команды до запуска нет ни в одном источнике. Approvals блог Termalin упоминает только у других продуктов: tufantunc/ssh-mcp v2 и ssh.bot (https://termal.in/ssh-for-ai-agents/, https://termal.in/blog/ssh-clients-for-ai-agents-2026/).
- Agent prompt из docs просит агента самого ждать «explicit go-ahead» перед необратимыми шагами (https://termal.in/docs/).

Key custodian:
- Это собственный SSH key agent приложения. Он «speaks the standard SSH agent protocol — a named pipe (\\.\pipe\termalin-ssh-agent) on Windows, and a Unix socket in a private per-user directory on macOS and Linux» (https://termal.in/docs/).
- Ключи «are never written back to disk in plaintext». Per-key timeout снова блокирует ключ. Settings → Security → "Agent Keys" задаёт, какие ключи agent использует для AI-агента (https://termal.in/docs/).
- Агент не получает ни ключ, ни файл ключа: «no ssh-add, no key file for the agent to read» (https://termal.in/ssh-for-ai-agents/).
- "Also lock SSH keys" при блокировке app перестаёт отдавать ключи агентам. "Pause AI agents while locked" выключен по умолчанию, то есть агенты работают при заблокированном app (https://termal.in/docs/). Changelog 0.1.43 утверждал обратное: «While the app is locked, it refuses requests from local AI tools» (https://termal.in/changelog/).

Policy, recordings, audit log:
- Policy на хост: full, allowlist или blocked. Задаётся в Settings → MCP или в форме хоста (https://termal.in/blog/per-host-command-allowlists-for-ai-agents/).
- `session_exec` проверяет allowlist на каждую команду. `tunnel_open` и `sftp_put` разрешены только на full-access хостах (https://termal.in/docs/mcp-tools/).
- Recordings: формат asciicast. Пишутся только вывод и маркеры событий, нажатия клавиш — никогда. Команды агента — зелёные маркеры, команды пользователя — янтарные. Включаются глобально или на хост. Локально — на всех планах (https://termal.in/docs/).
- Маркер «agent ▸ command» пишется до запуска команды. Recording «on by default» (https://termal.in/watch-grid/). Локальные recordings шифруются AES-256-GCM ключом из OS keystore (https://termal.in/security/).
- Audit log пишет «every host connection, file operation and agent command» (https://termal.in/ssh-for-ai-agents/). Activity log привязан к account: 30 дней на Free, год на Pro, два года на Team (https://termal.in/privacy). Агентские команды пишутся «to a server-side audit log» (https://termal.in/enterprise/).

Отличие от hosted:
- Это другой путь. Локальный server работает с «the inventory you export from the app», hosted — с серверами с Connector (https://termal.in/docs/).
- Наборы tools разные, общих имён 7. Auth разный: key agent против short-lived certificate (https://termal.in/docs/mcp-tools/).
- В MCP Registry есть только hosted server, локального package там нет (https://registry.modelcontextprotocol.io/v0/servers?search=in.termal).

Неизвестно: точный путь `termalin-mcp` на каждой ОС; протокол между `termalin-mcp` и app («control server»: socket, pipe или port); работают ли `ssh_exec` и `session_*` при закрытом app; формат и место host inventory; пишется ли audit log без account; синтаксис allowlist на локальном пути.

## 3. Hosted MCP server

Endpoint и auth:
- `https://termal.in/mcp` (OAuth, его используют connectors claude.ai и ChatGPT) и `https://termal.in/api/v1/mcp` (API key) — «two URLs onto the same handler» (https://termal.in/docs/mcp-tools/).
- API key принимается и на `https://termal.in/mcp` в заголовке `Authorization: Bearer tk_live_…` (https://termal.in/docs/).
- Transport — streamable HTTP (https://github.com/termalinapp/termalin-plugin/blob/main/mcp.json). Endpoint «speaks JSON-RPC 2.0 over plain HTTPS», его вызывают обычным curl (https://termal.in/blog/agent-ssh-access-in-ci-cd/).
- OAuth metadata: resource `https://termal.in/mcp`, scope `mcp`; `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`; grant types `authorization_code`, `refresh_token`; PKCE `S256`; client auth `none`, `client_secret_post`, `client_secret_basic` (https://termal.in/.well-known/oauth-protected-resource, https://termal.in/.well-known/oauth-authorization-server).
- Claude Code: `claude mcp add --transport http termalin https://termal.in/mcp`, затем `/mcp`. Codex: `codex mcp add termalin --url https://termal.in/mcp`. Cursor: `"url": "https://termal.in/mcp"` в mcp.json (https://termal.in/docs/).

Tools, 24 штуки, с параметрами (https://termal.in/docs/mcp-tools/):
- `hosts_list` возвращает id, name, online, runsAs, lastSeen, country, ip, ownerNote, policy, allowedCommands, tags, groups. Необязательный фильтр `tag`.
- `ssh_exec`: host, command; необязательные username и `timeout` (60 с по умолчанию, до 300). На Windows-сервере команда идёт в PowerShell.
- `ssh_exec_many`: command и hosts (до 10) или tag; timeout на сервер.
- `job_start`, `job_status`, `job_stop`, `job_list`. Job работает на сервере в `~/.termalin/jobs/<id>/` и переживает конец хода агента, разрыв соединения и update. Останавливает её только reboot. `job_status` отдаёт хвост лога: 40 строк по умолчанию, до 500.
- `server_metrics` (host, hours — 6 по умолчанию), `alerts_list`, `updates_list` (host, tag, cve).
- `backup_create`, `backup_list`, `backup_job_create`. Черновик backup job запускается только после подтверждения владельцем в cabinet.
- `web_link_create`, `web_link_list`, `web_link_update`, `web_link_delete` — internal sites.
- `sftp_list`, `sftp_read` (только текст, до 512 KB), `sftp_write` (текст, до 512 KB).
- `data_tables`, `data_schema`, `data_query` (engine, database, username, `allowWrites` только при full access, `timeoutSeconds` 60/300). Работают через клиент БД на сервере и local trust, пароль БД не передаётся.
- `generate_password`: length 20 по умолчанию, от 8 до 128.
- Вступление той же страницы говорит «23» tools, FAQ — 24 и перечисляет 24. Changelog: после `updates_list` — «24 tools in all» (https://termal.in/changelog/).

Лимиты:
- Около 60 запусков команд в минуту на account. Вызов ограничен 60 с по умолчанию, максимум 300 с (https://termal.in/docs/). Страница /mcp/ пишет «rate-limited and time-boxed per API key» (https://termal.in/mcp/).
- «calls past about 90 seconds are often cut off by the network first». Интерактивные и TUI программы не работают (https://termal.in/blog/agent-ssh-access-in-ci-cd/).
- API keys: до 10 на Pro, до 25 на Team. Нужен подтверждённый email, есть 7 дней отсрочки. Срок: 90 дней по умолчанию, 30 дней, год или Never (https://termal.in/docs/). Страница /mcp/ даёт 30 / 90 / 365 дней (https://termal.in/mcp/).

Policy:
- Каждое подключение AI app и каждый API key имеют одно правило: Full access, Only listed commands или Read-only — «no commands or file writes» (https://termal.in/docs/).
- У Connector своя настройка "What AI may run here". Действует более строгое из двух правил (https://termal.in/docs/mcp-tools/).
- Allowlist — это список команд. Shells, interpreters и editors отклоняются, даже если они в списке. `sudo` проверяется по команде после него. Флаги, которые заставляют `tar`, `find`, `git`, `docker`, `kubectl`, `rsync`, `ssh`, `curl` запускать программы или писать, отклоняются (https://termal.in/changelog/).
- Подключения с Allowlist и Read-only всегда входят пользователем Connector (https://termal.in/changelog/). Allowlist запрещает запись файлов (https://termal.in/docs/mcp-tools/).
- Точный синтаксис списка не опубликован. В примерах — имена команд: «git, docker, systemctl» (https://termal.in/blog/agent-ssh-access-in-ci-cd/).

Consent, audit, отключение:
- При первом подключении клиент открывает страницу входа Termalin. Пользователь «signs in, ticks the servers the client may reach and approves» (https://github.com/termalinapp/termalin-plugin/blob/main/llms-install.md).
- AI access у Connector включён по умолчанию. Его выключают на каждом Connector отдельно (https://termal.in/docs/).
- Каждое действие попадает в audit log cabinet («Ran a command»). С опцией "Keep command output" вывод пишется в лог, зашифрованный master password (https://termal.in/docs/).
- Для каждого tool call хранятся время, app, tool, сервер, результат, длительность и команда или путь файла. Вывод и содержимое файлов не хранятся. Срок — 30 дней (https://termal.in/privacy).
- Отключение: карточка "AI apps" в account → Disconnect, он «kills that app's tokens instantly» (https://termal.in/chatgpt-ssh/). API key отзывается в любой момент (https://termal.in/mcp/).

Неизвестно: лимит размера вывода `ssh_exec` и `job_status`; лимит строк `data_query` на hosted пути; срок жизни OAuth access и refresh tokens; формат audit log и способ его выгрузки; вид consent screen, кроме выбора серверов.

## 4. Безопасность и поток данных

- Sync: hosts, keys, passwords, snippets и recordings шифруются на устройстве. Ключ выводится из master password: PBKDF2-HMAC-SHA256, 600 000 итераций, затем AES-256-GCM (https://termal.in/security/).
- Таблица «What our servers see» про команды AI apps через hosted MCP: «Yes — the command text is in your activity log; its output is kept only if you turn that on, encrypted to a key only you hold» (https://termal.in/security/).
- Там же: сервер видит metadata recordings, включая «whether an AI agent acted», и метрики серверов с Connector (https://termal.in/security/).
- Поток данных hosted пути: «The commands, file contents and query results Claude requests travel from your server through its Termalin Connector to termal.in and back to the chat» (https://github.com/termalinapp/termalin-plugin/blob/main/README.md).
- Connector «moves opaque SSH bytes» до sshd на localhost сервера (https://termal.in/connector/). Значит, SSH-клиентом на hosted пути работает backend termal.in, и команду с выводом он видит открытым текстом во время выполнения (вывод).
- Claude (Anthropic) проверяет команды, которые AI-агенты выполняют через account. Проверка «runs on our side to catch misuse». В Anthropic API уходит «the command text an AI agent ran». Termalin хранит метку серьёзности с короткой причиной (https://termal.in/privacy).
- Connector ставится одноразовой ссылкой, она действует час. Linux/macOS: `curl -fsSL https://termal.in/i/<token> | sudo sh`. Windows: `irm https://termal.in/i/<token>.ps1 | iex`, установщик сам запрашивает права администратора (https://termal.in/connector/).
- Установщик скачивает static binary, регистрирует хост и ставит службу. Linux: systemd unit `termalin-agent.service` или `termalin-agent run` без systemd. macOS: launchd daemon и включённый Remote Login. Windows: служба `TermalinAgent`, OpenSSH Server при его отсутствии, PowerShell как shell для SSH (https://termal.in/docs/).
- «the Linux Connector service runs with only the access it needs» (https://termal.in/changelog/).
- Connector «dials out to Termalin over a single WebSocket and holds it open; it never listens on a port». К серверу с Connector нельзя подключиться обычной командой `ssh` с машины пользователя, только через hosted сторону Termalin (https://termal.in/blog/ssh-behind-nat-without-port-forwarding/).
- SSH CA: при регистрации sshd начинает доверять SSH CA Termalin. Каждый вход идёт с short-lived certificate, выпущенным в момент входа. sshd принимает только principal своего tenant (https://termal.in/connector/).
- Connector обновляется сам. Он проверяет подписанный список версий, размер, checksum и подпись бинарника, делает пробный запуск. Если новая версия не подключилась за 10 минут, он возвращает старую (https://termal.in/changelog/).
- Updates desktop app подписаны offline Ed25519 key. Перед установкой app проверяет подпись manifest и SHA-256 установщика (https://termal.in/security/).
- Принятый отчёт исследователя: «OAuth client-registration hardening in the MCP authorization flow (Sept 2026)» (https://termal.in/security/).
- Whitepaper не найден. Архитектуру описывают security page, страница Connector и блог.

Неизвестно: хост и порт WebSocket Connector; срок жизни SSH certificate; где хранится ключ CA; что именно меняется в `sshd_config`; с какими правами работает служба Connector на macOS и Windows.

## 5. Цены и планы

- Free — $0. Весь desktop app без лимита хостов, ключей и устройств. Включены local MCP server, watch grid и recording на устройстве. Нет sync, web cabinet, Connectors и API keys (https://termal.in/pricing/, https://termal.in/docs/).
- Pro — $10/мес помесячно или $8/мес при оплате за год (https://termal.in/pricing/). Docs: «$10/mo, or $96/year» (https://termal.in/docs/).
- Team — $19 за пользователя в месяц помесячно или $15 при оплате за год (https://termal.in/pricing/).
- Enterprise — цена по запросу. В нём SAML SSO, SCIM, SLA и «Agent governance preview» (https://termal.in/pricing/).
- Founders Lifetime Pro — $149 одним платежом (https://termal.in/pricing/).
- Trial Pro — 14 дней без карты, 28 дней по приглашению, «one trial per device or server» (https://termal.in/docs/).
- Доп. хранилище: +100 GB за $2.99/мес, +1 TB за $19.99/мес (https://termal.in/pricing/). Оплата картой или криптой через Creem и NOWPayments, в iOS — через Apple (https://termal.in/privacy).

Агентские функции по планам (https://termal.in/pricing/, https://termal.in/docs/):

| Функция | Free | Pro | Team |
|---|---|---|---|
| Local MCP server | да | да | да |
| Watch grid, recording на устройстве | да | да | да |
| Hosted MCP (OAuth и API keys) | нет | да | да |
| API keys | нет | 10 | 25 |
| Connector | нет | да, без лимита | да |
| «Command rules and an audit trail for every AI app» | нет | да | да |
| Cloud recordings | нет | 90 дней, файл до 100 MB | 1 год, до 500 MB |
| Activity log | 30 дней | 1 год | 2 года |
| Monitoring и alerts | нет | 90 дней истории | 2 года |
| "Pause AI agents while the app is locked" | да | да | да |

- Противоречие. `llms-install.md` в plugin repo пишет «The Free plan covers one server; the hosted MCP server needs Pro or the 14-day trial». README того же repo — «The Free plan is enough to try it». Docs: «Connectors are a Pro feature; Free has none» (https://github.com/termalinapp/termalin-plugin/blob/main/llms-install.md, https://termal.in/docs/).

Неизвестно: цена Enterprise; скидки за объём.

## 6. Terms и privacy

- Terms (Last updated: October 2026) отдельно про AI-агентов и автоматическое использование не говорят (https://termal.in/terms).
- Acceptable use запрещает доступ к чужим системам, сканирование и атаки, «including through servers connected with a Connector». При подозрении Termalin может «pause an account's Connectors and API access while we review it» (https://termal.in/terms).
- Сервис идёт «as is». Ответственность ограничена суммой, уплаченной за 12 месяцев до претензии, на Free — $0 (https://termal.in/terms).
- Desktop app «licensed, not sold» (https://termal.in/terms). Scoop manifest: `"license": "Freeware"` (https://github.com/termalinapp/scoop-termalin/blob/main/bucket/termalin.json).
- Privacy (Last updated: 24 October 2026). Метаданные AI tool calls — 30 дней. Activity log — 30 дней на Free, год на Pro, два года на Team. Лог исходящих соединений — 180 дней. Server logs — «kept briefly» (https://termal.in/privacy).
- Проверка команд AI-агентов через Anthropic идёт по commercial terms Anthropic, «no training on it» (https://termal.in/privacy).
- После удаления account 12 месяцев хранится зашифрованная запись. В ней в том числе «any review of the account for misuse, in full, including the evidence it holds — which can include the commands that started the review». Платёжные записи хранятся до 10 лет (https://termal.in/privacy).
- Crash reports и feedback отправляются только по выбору пользователя, opt-in (https://termal.in/privacy). «no analytics SDKs, no ad trackers» (https://termal.in/security/).
- «The landing site sets no cookies and runs no analytics» (https://termal.in/privacy). При этом скрипт страниц пишет в localStorage first-touch attribution (utm и referrer) и invite code для формы регистрации (HTML-код https://termal.in/).
- Место хранения данных не указано. Получатели данных: «infrastructure providers that host the service (server & email delivery)», Creem, NOWPayments, Apple, Anthropic (https://termal.in/privacy).

Неизвестно: юрисдикция и применимое право; страна хранения данных; имена infrastructure providers; есть ли DPA.

## 7. Поверхности для интеграции стороннего desktop app

- Local stdio MCP server `termalin-mcp` для любого MCP client на той же машине (https://termal.in/docs/mcp-tools/).
- Hosted MCP: JSON-RPC 2.0 через HTTPS. Auth — OAuth 2.1 + PKCE с dynamic client registration или API key `tk_live_…` (https://termal.in/.well-known/oauth-authorization-server, https://termal.in/docs/). Объявлен только scope `mcp`, так что OAuth даёт доступ только к MCP (вывод).
- Строка «REST API and API keys» есть в таблице pricing (https://termal.in/pricing/). Документации REST API нет: в sitemap из docs только /docs/ и /docs/mcp-tools/ (https://termal.in/sitemap-0.xml). robots.txt закрывает `/api/` (https://termal.in/robots.txt).
- Публичный read-only endpoint `https://termal.in/api/v1/updates/latest?platform=macos|windows` отдаёт версию и sha256. Его используют Homebrew и Scoop (https://github.com/termalinapp/homebrew-termalin/blob/main/Casks/termalin.rb).
- SSH key agent app работает по стандартному протоколу ssh-agent через named pipe или Unix socket. «other tools that speak the protocol can use it too» (https://termal.in/docs/). «git and your CLI can sign through it too» (https://termal.in/features/).
- Импорт хостов: `~/.ssh/config`, CSV, Termalin JSON backup, PuTTY, MobaXterm. Экспорт: JSON backup, SSH config, CSV (https://termal.in/docs/).
- Webhooks только исходящие: alerts, подписанные HMAC-SHA256 (https://termal.in/docs/). Входящие webhooks не найдены.
- Найдена одна deep link — ссылка cabinet на internal site `https://termal.in/account#open-site=<id>` (https://termal.in/docs/mcp-tools/). URL scheme desktop app (`termalin://` и подобные) нет ни на одной прочитанной странице.
- CLI: скрипт установки на Linux добавляет в PATH команду `termalin` (https://termal.in/download/). Её аргументы не описаны.
- Browser extension для Chrome и Edge входит в account как AI app (https://termal.in/docs/).
- В local terminal tab Termalin запускают `claude`, `codex`, `gemini` (https://termal.in/features/).
- SDK, embedding и partner program не найдены. Есть только referral program: 10% от платежей приглашённых кредитом на счёт (https://termal.in/pricing/).

Неизвестно: принимает ли `/oauth/register` любого клиента; аргументы команды `termalin`; есть ли API для чтения audit log.

## 8. Упаковка для Claude Code и Codex

- Repo `termalinapp/termalin-plugin`: MIT, создан 2026-10-12, последний push 2026-11-07, версия plugin 1.1.0 (https://github.com/termalinapp/termalin-plugin).
- `.claude-plugin/marketplace.json`: marketplace `termalin`, owner Termalin (support@termal.in), один plugin `termalin` с `"source": "./"` (https://github.com/termalinapp/termalin-plugin/blob/main/.claude-plugin/marketplace.json).
- `.claude-plugin/plugin.json` содержит только метаданные: name, version, description, author, homepage, license, keywords, icon и ссылки на docs, support, privacy, terms. MCP server в нём не указан (https://github.com/termalinapp/termalin-plugin/blob/main/.claude-plugin/plugin.json).
- MCP server описан в корневом `.mcp.json`: `{"type":"http","url":"https://termal.in/mcp"}` (https://github.com/termalinapp/termalin-plugin/blob/main/.mcp.json).
- Установка в Claude Code: `/plugin marketplace add termalinapp/termalin-plugin`, затем `/plugin install termalin@termalin` (https://termal.in/mcp/).
- `chatgpt/.codex-plugin/plugin.json`: name `app-6aa2c81fc7c48191a06e101858e41837`, version 2.1.7, `"mcpServers": "./.mcp.json"` с тем же URL, `"skills": "./skills/"`, блок `interface` с текстами, capabilities, defaultPrompt и иконками (https://github.com/termalinapp/termalin-plugin/blob/main/chatgpt/.codex-plugin/plugin.json).
- `chatgpt/BUILD.md`: пакет — ZIP в plugin layout OpenAI из `.codex-plugin/plugin.json`, `.mcp.json`, `skills/` и `assets/`. Его загружают на platform.openai.com → Plugins (https://github.com/termalinapp/termalin-plugin/blob/main/chatgpt/BUILD.md).
- Skills — Markdown с frontmatter `name` и `description` (https://github.com/termalinapp/termalin-plugin/tree/main/skills):
  - `server-health`: сначала `alerts_list` и `server_metrics`, дальше только read-only команды;
  - `incident-triage`: диагностика read-only, исправление только после согласия пользователя на конкретный шаг;
  - `run-commands`: ограниченный вывод, `job_start` для долгих задач, копия конфига перед правкой, без секретов в чате, без разрушительных команд без согласия;
  - `deploy-check`: службы и порты, логи, внешний curl, сертификат, метрики;
  - `database-access`: `data_tables`, затем `data_schema`, затем `data_query` с LIMIT; `allowWrites` только после согласия на конкретный запрос.
- Сверх MCP URL пакеты добавляют только skills. Hooks, commands, agents и локального кода нет. README: «The plugin itself stores nothing and runs no code on your machine» (https://github.com/termalinapp/termalin-plugin/blob/main/README.md).
- Все манифесты указывают на hosted `https://termal.in/mcp`. Локальный `termalin-mcp` не упомянут ни в одном (https://github.com/termalinapp/termalin-plugin).
- Расхождения с docs. `run-commands` пишет, что ответ обрезается примерно на 90 секундах, docs дают 60 с по умолчанию и 300 с максимум (https://termal.in/docs/). `run-commands` называет пункт «Add → Tunnel», docs — Add Connector.
- Другие манифесты в том же repo: корневые `plugin.json` и `mcp.json` (Agent Plugins, `streamable-http`), `gemini-extension.json` с `GEMINI.md`, `.grok-plugin/`, `.antigravity-plugin/`, `openclaw.plugin.json`, `lhm.plugin.json`, `mcp_config.json`, `llms-install.md` (https://github.com/termalinapp/termalin-plugin).

## Источники

Все прочитаны 2026-11-10.

- Сайт: https://termal.in/ · https://termal.in/features/ · https://termal.in/about/ · https://termal.in/download/ · https://termal.in/pricing/ · https://termal.in/enterprise/ · https://termal.in/changelog/
- Агенты и MCP: https://termal.in/mcp/ · https://termal.in/docs/ · https://termal.in/docs/mcp-tools/ · https://termal.in/ssh-for-ai-agents/ · https://termal.in/claude-ssh/ · https://termal.in/claude-code-ssh/ · https://termal.in/codex-ssh/ · https://termal.in/cursor-ssh/ · https://termal.in/chatgpt-ssh/ · https://termal.in/watch-grid/ · https://termal.in/connector/
- Безопасность и право: https://termal.in/security/ · https://termal.in/privacy · https://termal.in/terms · https://termal.in/abuse/
- Служебные: https://termal.in/robots.txt · https://termal.in/sitemap-0.xml · https://termal.in/.well-known/oauth-protected-resource · https://termal.in/.well-known/oauth-protected-resource/mcp · https://termal.in/.well-known/oauth-authorization-server · https://status.termal.in/ (только JavaScript, текста нет)
- Blog index https://termal.in/blog/ (58 постов). Открыты посты про MCP, агентов, безопасность и архитектуру: https://termal.in/blog/connect-claude-code-to-your-server-over-ssh/ (2026-08-04) · https://termal.in/blog/give-a-local-llm-safe-ssh-access/ (2026-08-07) · https://termal.in/blog/agent-ssh-access-blast-radius/ (2026-08-13) · https://termal.in/blog/take-it-out-of-the-map-rust-sessions/ (2026-08-21) · https://termal.in/blog/manage-servers-from-claude-chatgpt/ (2026-08-25)
- Ещё посты: https://termal.in/blog/agent-ssh-access-in-ci-cd/ (2026-09-13) · https://termal.in/blog/audit-what-an-ai-agent-does-on-your-servers/ (2026-09-13) · https://termal.in/blog/per-host-command-allowlists-for-ai-agents/ (2026-09-14) · https://termal.in/blog/watch-many-ssh-agent-sessions-live/ (2026-09-14) · https://termal.in/blog/ssh-behind-nat-without-port-forwarding/ (2026-09-29)
- Поиском по тексту: https://termal.in/blog/ssh-clients-for-ai-agents-2026/ · https://termal.in/blog/connect-codex-to-your-server-over-ssh/ · https://termal.in/blog/let-an-ai-agent-deploy-without-your-ssh-keys/
- GitHub через `gh api`: https://github.com/termalinapp (org) · https://github.com/termalinapp/termalin (README, releases, issues) · https://github.com/termalinapp/termalin-plugin (все манифесты, `chatgpt/BUILD.md`, `llms-install.md`, README, пять `skills/*/SKILL.md`, commits) · https://github.com/termalinapp/homebrew-termalin (`Casks/termalin.rb`) · https://github.com/termalinapp/scoop-termalin (`bucket/termalin.json`)
- GitHub search API: `repo:termalinapp/termalin` и `org:termalinapp`, оба `total_count: 0`.
- MCP Registry: https://registry.modelcontextprotocol.io/v0/servers?search=in.termal
