# 55 — MCP server qmd из Harness не стартует в Codex

Type: bug
Status: done 2026-11-04T10:47Z
PR: #1357
Blocked by:
Source: владелец 2026-11-04, приёмка worfy-multi-vendor 32 шаг 5 на Mac Stable `b09dfab0`: встроенный Codex 0.166.0 в
terminal-е, в папке Project-а, Harness `0.3.0+b09dfab09` установлен в Codex и его hook-и одобрены

## Что происходит

Codex при старте показывает предупреждение «MCP client for `qmd` failed to start: MCP startup failed: handshaking with
MCP server failed: connection closed: initialize response» и «MCP startup incomplete (failed: qmd)». Hook-и Harness в
той же Session работают (hook блокировки worktree ответил в первом же ходе).

MCP server объявлен в `harness/.mcp.json`: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp"]`. Тот же
файл лежит в кэше плагинов Codex без изменений. Сам server из кэша работает: `node <кэш>/bin/qmd-mcp` на запрос
`initialize` отвечает сразу (проверил Orchestrator, с `CLAUDE_PLUGIN_ROOT` и без). Вероятная причина — Codex не
подставляет `${CLAUDE_PLUGIN_ROOT}` в `args` MCP server-а (в `command` hook-ов его подставляет shell), и `node`
получает несуществующий путь; второй вариант — `node` нет в PATH процесса MCP. Не подтверждено.

## Что делаем

1. Найти причину: как Codex 0.166.0 раскрывает переменные в `.mcp.json` плагина (документация Codex, схема
   `PluginReadResponse` в `src/main/vendors/codex/protocol/`), с отдельным `CODEX_HOME` во временной папке, никогда
   не `~/.codex`, и без настоящего binary Codex в test-ах.
2. Исправить для Codex, не ломая Claude Code: путь, который Codex понимает (его переменная корня плагина, путь
   относительно плагина или запись при установке Harness в Codex, `src/main/harness/codex-install.ts`), и `node`
   по полному пути, если дело в PATH.
3. Проверить, есть ли qmd в Session на Codex, которую ведёт сам worfy (`codex app-server`), — и записать в «Итог».

Глубина review — `medium`. Платформенный: на Windows путь и запуск `node` другие — проверка на ПК.

## Готово, когда

- [ ] Test установки Harness в Codex: MCP server qmd записан так, что Codex находит `bin/qmd-mcp` (по фактам п. 1).
  - evidence: test-run pass · `pnpm test test/contract/harness-codex-install.test.ts test/unit/harness-codex-manifest.test.ts` exit 0 · mac - · 470098339d1bf45c43ce4f09f5ac02b4a9145f80
- [ ] Владелец: в Codex (terminal и Session worfy) нет предупреждения про qmd, tool-ы qmd видны.
- [ ] Все unit и contract test-ы `src/main/harness/`, `pnpm typecheck`, `pnpm lint` — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 470098339d1bf45c43ce4f09f5ac02b4a9145f80

## Итог

Ветка `worfy-polish/55`, base `origin/main` `70765bb93`.

**Причина (п. 1), по исходникам Codex на теге `rust-v0.166.0`** (github.com/openai/codex, binary не запускался):

- Codex ищет манифест плагина в порядке `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`
  (`codex-rs/exec-server-protocol/src/protocol.rs`, `DISCOVERABLE_PLUGIN_MANIFEST_PATHS`). У Harness есть только
  второй, без `mcpServers`, поэтому Codex читает `.mcp.json` плагина (`codex-rs/core-plugins/src/loader.rs`,
  `default_mcp_config_paths`).
- Для манифеста этого формата Codex не подставляет переменные в `command`/`args`: `parse_plugin_mcp_config` только
  приклеивает относительный `cwd` к корню плагина (`codex-rs/codex-mcp/src/plugin_config.rs`,
  `normalize_plugin_mcp_server_value`). `${PLUGIN_ROOT}` раскрывается лишь в формате Agent Plugins (корневой
  `plugin.json` со `$schema`, `agent_plugin_config.rs`). `CLAUDE_PLUGIN_ROOT` Codex кладёт только в окружение hook-ов
  (`codex-rs/hooks/src/engine/discovery.rs`), поэтому hook-и работают.
- Без `cwd` server стартует в папке Session (`codex-rs/rmcp-client/src/stdio_server_launcher.rs`, `fallback_cwd`).
  Итого `node` получает буквальный путь `${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp` относительно папки Project-а, падает с
  «Cannot find module», и Codex видит закрытое соединение до ответа на `initialize`.
- Окружение MCP server-а Codex фильтрует: только `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER`, `LANG`, `LC_ALL`, `TERM`,
  `TMPDIR`, `TZ` и `__CF_USER_TEXT_ENCODING` (`codex-rs/rmcp-client/src/utils.rs`, `DEFAULT_ENV_VARS`). `node` ищется
  в `PATH` самого Codex; на Windows — через `which` с `PATHEXT` (`program_resolver.rs`).

**Исправление (п. 2).** Перед каждым `codex plugin add worfy@worfy-harness` worfy пишет в свою копию Harness
(`<harnessHome>/plugin`; решено без владельца, подтверждено владельцем 2026-11-04) файл `.codex-plugin/plugin.json`: манифест Claude Code плюс `mcpServers` из `.mcp.json`, где
`${CLAUDE_PLUGIN_ROOT}` заменён полным путём копии (`codexPluginManifest`, `writeManifest` в
`src/main/harness/codex-install.ts`; на Windows путь нормализуется с обратными слэшами). `cwd` не задаётся (решено без владельца, подтверждено владельцем 2026-11-04), поэтому
`qmd-mcp` по-прежнему стартует в папке Session и читает Profile Project-а (язык документов). Так же агенты Codex уже
получают путь копии вместо переменной (`codex-agents.ts`). `harness/` не меняется: Claude Code читает
`.claude-plugin/` и `.mcp.json` как раньше. Ошибка записи — ошибка шага `plugin add`, и `codex plugin add` не запускается.

Решено без владельца, подтверждено владельцем 2026-11-04: манифест пишется при установке, а не лежит в `harness/` статично. Статичный файл с
относительным `cwd: "."` тоже нашёл бы `bin/qmd-mcp`, но server стартовал бы в папке плагина, и `qmd-mcp` не видел бы
Profile Project-а (русская модель расширения запроса не выбиралась бы).

У владельца Harness уже стоит в Codex с версией `b09dfab09`: манифест появится при первом обновлении Harness в Codex
со сборкой, где есть это исправление (Install или Update Harness in Codex).

**Session worfy через `codex app-server` (п. 3), по исходникам, без живой проверки.** MCP server-ы плагинов загружает
тот же загрузчик для любого thread (`load_configured_plugin_mcp_servers` в `loader.rs`). worfy в `thread/start` добавляет
только свои ключи `mcp_servers.<name>` (`src/main/vendors/codex/mcp.ts`) и плагины не трогает, а `cwd` thread-а — папка
Project-а. Значит, qmd в такой Session будет, если в `PATH` app-server-а есть `node`. Риск: app-server стартует с
окружением процесса worfy (`appServerOptions` в `src/main/vendors/codex/session.ts` не задаёт `env`), а у worfy,
открытого из Finder, `PATH` — системный, без `node` (так сказано в `mcp.ts`). Тогда qmd в Session worfy упадёт уже на
запуске `node`, хотя в terminal-е заработает. Fake app-server MCP server-ы плагинов не запускает, проверить это test-ом
нельзя — нужна проверка владельцем (пункт «Готово» 2).
