# 06 — Как Agent SDK ведёт себя в Electron main с настройками пользователя

Type: research
Status: claimed — 2026-10-05
Blocked by: 01
Source: [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md), абзац про `settingSources: user + project + local`; [spec.md](../spec.md), «Риски и открытые технические вопросы», пункты 1–3 и 5

## Что делаем

Движок Сессий (тикет 07) строится на предположениях, которые никто не проверял. Здесь их
проверяют одним spike-скриптом из Electron main (не из обычного Node: окружение отличается) на
репозитории самого worfy. Итог — факты с выводом команд, а не код для продакшена.

Ответить на вопросы:

1. `settingSources: ['user', 'project', 'local']` — подхватываются ли `~/.claude/CLAUDE.md`,
   hooks из `~/.claude/settings.json` (SessionStart `worktree-lock claim` пишет в реестр), skills
   (`/ship-ticket`, `/epic-wave` в `slash_commands` сообщения `system/init`), subagent-ы и
   MCP-сервера.
2. Stop hook `~/.claude/hooks/stop.sh` с exit 2 (воспроизвести: положить красный маркер Gate для
   worktree spike-а). Что приходит в поток SDK: продолжение хода, `system` с `stop_hook_summary`,
   результат с ошибкой? Чем кончается после двух блокировок?
3. Вход: с вычищенными `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` поле `apiKeySource` в
   `system/init` показывает вход по подписке. Что приходит, если Claude Code не залогинен.
4. `PATH`: приложение из Finder (запуск двойным щелчком) — находят ли hooks `node`, `pnpm`, `gh`.
   Сравнить с `PATH`, взятым из `$SHELL -lc env`. Для этого вопроса — отдельный spike
   `scripts/spikes/path-probe/`: своя точка входа Electron main и свой конфиг electron-builder,
   собирается в отдельную папку. `src/main/index.ts` и сборка приложения (тикет 32) не трогаются.
   Заодно: находит ли SDK `node` для запуска Claude Code и работает ли `cli.js` из `app.asar`
   без распаковки.
5. Поток событий: какие типы сообщений приходят за ход (`system/init`, `assistant`, `user`,
   `result`, `rate_limit_event`, события состояния сессии), есть ли `includePartialMessages` и
   нужно ли оно для живого текста.
6. Управление на ходу: `interrupt()`, `setPermissionMode()`, `setModel()`, как задаётся effort,
   `supportedCommands()`, `supportedModels()`.
7. Пишет ли SDK-сессия запись в `~/.claude/sessions/*.json` и транскрипт в
   `~/.claude/projects/<cwd>/` — то есть увидит ли её чтение внешних Сессий (тикет 13) как чужую.
8. `canUseTool`: форма запроса. Как разрешить инструмент до конца текущей Сессии, ничего не
   записав на диск: свой список в памяти main или `updatedPermissions` с `destination: 'session'`.
   Какие `destination` у `suggestions` пишут в файлы (`localSettings`, `projectSettings`,
   `userSettings`) — такие worfy не применяет никогда (тикет 21).
9. `permissionMode: 'bypassPermissions'` — нужен ли вдобавок `allowDangerouslySkipPermissions: true`,
   и что будет без него (ошибка, молчаливый откат в `default`, запросы разрешений). Ответ
   определяет опции тикета 07.

Если ответ меняет решение из spec или ADR — записать ADR со следующим свободным номером (0006
занят тикетом 02, значит 0007 и дальше) и назвать, что меняется.

## Готово, когда

- [ ] На каждый из девяти вопросов в «Итог» есть ответ с выводом spike-а (команда, код выхода, фрагмент сообщения).
- [ ] Spike лежит в `scripts/spikes/sdk-probe.ts`, spike `PATH` — в `scripts/spikes/path-probe/`; каждый запускается одной командой, описанной в его шапке.
- [ ] Перечислены поля сообщений SDK, на которые опирается тикет 07, с версией SDK и Claude Code.
- [ ] Если вывод противоречит spec или ADR — записан ADR-0007 или следующий свободный, и в «Итог» названы затронутые тикеты.

## Тесты

- Test-ов нет: результат — знание. Фрагменты реальных сообщений SDK сохраняются в `test/fixtures/sdk-messages/` для contract test-ов тикета 07 (без текста промптов и путей, которые нельзя публиковать).

## Где в коде

- `scripts/spikes/sdk-probe.ts`
- `scripts/spikes/path-probe/`
- `test/fixtures/sdk-messages/`
