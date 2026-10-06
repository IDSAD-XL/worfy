# Claude Code в worfy — нативный бинарник из пакета SDK по явному пути в app.asar.unpacked

Дата: 2026-10-05. Статус: принят.

Спецификация Epic-а `worfy-mvp` (риск 11) и Ticket 07 (движок Session-ов) описывали запуск так: SDK запускает `cli.js` под `node` (опция `executable`), путь `pathToClaudeCodeExecutable` указывает на `cli.js` из `app.asar.unpacked`, а `electron-builder.yml` распаковывает `node_modules/@anthropic-ai/claude-agent-sdk/**`. Spike Ticket-а 06 (`scripts/spikes/path-probe/`, `scripts/spikes/sdk-probe.ts`; SDK 0.3.289, Claude Code 2.1.289, Electron 44.5.1, macOS arm64) показал, что для текущего SDK это неверно.

**Решение.** worfy запускает нативный бинарник Claude Code из платформенного пакета SDK `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude` (зависимость `optionalDependencies` SDK). Опция `executable` не задаётся: `node` для запуска не нужен. В `pnpm dev` путь не задаётся, SDK находит бинарник сам. В собранном приложении `pathToClaudeCodeExecutable` задаётся явно: `<resourcesPath>/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`. `electron-builder.yml` получает `asarUnpack` с шаблоном `node_modules/@anthropic-ai/claude-agent-sdk-*/**`; эту строку добавляет Ticket 07 (Ticket 32 заводит файл с `asarUnpack` только для `node-pty` и прямо оставляет SDK Ticket-у 07).

**Почему.** В SDK 0.3.289 нет `cli.js`. Своим поиском SDK находит путь к бинарнику внутри `app.asar`, и запуск собранного приложения падает с `spawn ENOTDIR`. С явным путём в `app.asar.unpacked` — `system/init` и `result: ok`, `claude_code_version: 2.1.289`, в том числе с голым `PATH` приложения из Finder. electron-builder сам распаковывает исполняемые файлы (smart unpack), и копия в `app.asar.unpacked` есть и без `asarUnpack`; явный шаблон нужен, чтобы сборка не зависела от этой эвристики.

Затронуты: Ticket 07 (`src/main/agent/options.ts`, `test/unit/agent-executable.test.ts` — путь к бинарнику платформенного пакета, не к `cli.js`; `electron-builder.yml` — `asarUnpack`), спецификация Epic-а (риск 11 устарел).

## Considered Options

- `executable: 'node'` и `cli.js` из `app.asar.unpacked`, как в спецификации: в SDK 0.3.289 `cli.js` нет; закрепить старую версию SDK ради `cli.js` значило бы отстать от Claude Code, которым пользуется владелец.
- Положиться на поиск бинарника самим SDK: в собранном приложении он указывает внутрь `app.asar` (`spawn ENOTDIR`).
- Не задавать `asarUnpack` и положиться на smart unpack electron-builder: сейчас работает, но это эвристика сборщика, а не обещание.
- Бинарник `claude`, установленный у пользователя (`~/.local/bin/claude`): версия не совпадает с версией SDK, и протокол между ними не гарантирован; worfy зависел бы от отдельной установки.
