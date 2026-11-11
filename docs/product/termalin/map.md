# Termalin в worfy — карта

Тема Product Session `termalin`, начата 2026-11-10. Вопрос владельца: можно ли внедрить Termalin
(https://github.com/termalinapp, https://termal.in) в worfy и как именно.

## Destination

Владелец решил, подключать ли агентов worfy к Termalin и каким путём. Другой исход — отложить тему,
пока у агентов нет работы на серверах.

## Notes

- Skills темы: `worfy:grilling` для вопросов, `worfy:research` для фактов (заметки — в этой папке).
- Заметка о Termalin: [research-termalin.md](research-termalin.md), прочитано 2026-11-10. Главное из неё:
  - Termalin — закрытый SSH-клиент для Windows, macOS, Linux и iOS.
  - Проект называет себя «small pre-revenue project». Public beta вышла в July 2026, v0.1.50 — 2026-10-29.
  - Юрлицо не названо. Все публичные коммиты сделал один автор.
  - Локальный MCP server `termalin-mcp` идёт с desktop app. Транспорт stdio, 22 tools, бесплатен на всех планах.
  - Ключи остаются в ssh-agent самого приложения.
  - Пользователь видит вживую только tools `terminal_*`. Вызовы `ssh_exec` и `session_*` попадают только
    в recordings и audit log.
  - Подтверждения отдельной команды человеком до запуска нет.
  - Hosted MCP server `https://termal.in/mcp` работает только с Pro ($10 в месяц) или trial.
  - Hosted путь достаёт только серверы с Connector. Connector ставится через `sudo sh`.
  - Вывод команд на hosted пути идёт через termal.in.
  - Команды агентов сервер Termalin сам отправляет в Anthropic API на проверку злоупотреблений.
  - REST API, SDK, URL scheme и partner program нет. Поэтому встроить окно Termalin (вкладки, watch grid)
    в Canvas нельзя: остаётся только MCP.
- Факты о worfy на 2026-11-10 (main `40dfdadc9`):
  - Session в Project-е получает только MCP server-ы из списка Profile `mcp.allowed`
    ([ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md),
    [options.ts](../../../src/main/vendors/claude/options.ts), строки 15–22).
  - Без поля `mcp.allowed` список такой: `plugin_worfy_qmd`, `worfy-canvas`
    ([profile.ts](../../../src/main/workflow/profile.ts), строка 45). В Profile worfy этого поля нет.
  - Codex Session: worfy добавляет свои server-ы по одному ключу. Комментарий в коде: «the user's own
    servers stay as they are» ([codex/mcp.ts](../../../src/main/vendors/codex/mcp.ts), строки 153–154).
    Вывод: server пользователя из настроек Codex попадает в Codex Session без списка Profile. Запуском не
    проверено.
  - Agent SDK 0.3.289 подключает HTTP MCP server с headers, то есть с API key как Bearer. Ещё он задаёт
    правило на отдельный tool: `always_allow`, `always_ask` или `always_deny` (`sdk.d.ts`, типы
    `McpHttpServerConfig` и `McpServerToolPolicy`).
  - Autopilot Session идёт в `bypassPermissions` (options.ts, строка 691;
    [ADR-0022](../../adr/0022-unattended-session-refuses-permission-mode-change.md)). Список Profile у неё
    тот же, отдельного флага «только с человеком» для MCP server-а нет.
  - Terminal Node — для пользователя, агенты им не пользуются
    ([terminal.md](../../features/terminal.md), строка 10).
  - Образец для «агент работает во внешней системе и не видит секретов» — Browser profiles
    ([ADR-0078](../../adr/0078-browser-node.md), [browser.md](../../features/browser.md)):
    - пользователь входит сам;
    - у профиля allowlist origin-ов;
    - флаг «Available to Autopilot» по умолчанию выключен;
    - пока агент работает, виден знак «Claude is driving», пользователь может перехватить управление.
  - `worfy-terminal-ssh` (SSH в Terminal worfy для Terminal AI, 0/10) вне рамок roadmap: владелец
    2026-11-08 «да» ([карта roadmap](../roadmap-worfy/map.md), Out of scope).
  - В его Ticket-е 01 записано: «Агент на серверы владельца сам не ходит»
    ([Ticket 01](../../../.scratch/worfy-terminal-ssh/issues/01-spike-обёртка-ssh-и-osc-633-на-сервере-владельца.md),
    строки 33–34).
  - У Project-ов Harness своего Linux-сервера в Profile нет. У worfy деплоя нет. Один Project деплоится
    джобой CI в PaaS. У остальных деплой не задан.
  - У PaaS бывает свой MCP server: у Railway он теперь в CLI, команда `railway mcp`
    (https://github.com/railwayapp/railway-mcp-server, README).

## Decisions so far

## Not yet specified

- Есть ли у владельца серверы, где агентам worfy нужна работа, и какая (логи, проверка деплоя, правки).
- Если есть: можно ли туда Autopilot — полностью, только чтение или нельзя.
- Если путь выбран: нужен ли worfy общий механизм внешних MCP server-ов. Это Settings, секрет в Keychain,
  «Available to Autopilot» и правило на tool — вместо правки `mcp.allowed` руками.

## Out of scope
