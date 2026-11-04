# 55 — MCP server qmd из Harness не стартует в Codex

Type: bug
Status: open
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
- [ ] Владелец: в Codex (terminal и Session worfy) нет предупреждения про qmd, tool-ы qmd видны.
- [ ] Все unit и contract test-ы `src/main/harness/`, `pnpm typecheck`, `pnpm lint` — exit 0.
