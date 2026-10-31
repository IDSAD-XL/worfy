# 115 — Stop hook `qmd-refresh` на Windows: exit 127 и «Stop hook error occurred» в конце каждого хода

Type: bug
Status: done 2026-10-31T04:28Z
PR: #1103
Blocked by: —
Source: находка ПК 2026-10-31 при проходе onboarding 12 (через мост): в демо-Project-е в конце каждого хода пользователь
видит «Stop hook error occurred» (журнал 02:23:15Z и 02:25:57Z, ход не блокируется). Новый пользователь Windows видит это
с первого хода. Ticket заведён Orchestrator-ом; держит приёмку onboarding 12 (шаг 5).

## Что происходит

- `harness/hooks/hooks.json:107` — Stop hook `"${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh" --quiet`.
- `harness/bin/qmd-refresh` — скрипт с `#!/bin/zsh`. На Windows zsh нет: запуск кончается «cannot execute: required file
  not found», exit 127, и Claude Code показывает ошибку hook-а.
- Остальные hook-и плагина запускаются через `node "${CLAUDE_PLUGIN_ROOT}/…"` и на Windows работают.
- Две другие zsh-обёртки qmd (`qmd-mcp`, `qmd-sync-main`) проверяет Wave windows 07 / Ticket 15; решение «qmd или grep на
  Windows» ещё не принято.

## Что делаем

1. Stop hook не показывает ошибку там, где zsh нет: запуск через node-обёртку (`node "${CLAUDE_PLUGIN_ROOT}/bin/…"`), которая
   на win32 или без zsh в PATH тихо выходит с 0, а иначе запускает `qmd-refresh --quiet` как сейчас. Поведение на Mac и Linux
   не меняется.
2. Не решаем здесь, работает ли qmd на Windows (это Ticket 15): только убираем ложную ошибку в конце хода.

## Готово, когда

- [ ] Contract test: hooks.json не вызывает zsh-скрипт напрямую ни в одном hook-е (каждая команда начинается с `node`).
- [ ] Test обёртки: на win32 (или без zsh в PATH) — exit 0 без вывода; с zsh — `qmd-refresh` вызван с `--quiet` (stub в PATH).
- [ ] Windows-job CI зелёный (платформенный PR, ADR-0056).
- [ ] Пределы test-ов не подняты; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `harness/hooks/hooks.json`, новая node-обёртка в `harness/bin/` или `harness/hooks/`
- test-ы harness (найти соседние test-ы hooks.json)

Только читать: `harness/bin/qmd-refresh`.

## Итог

Заполняется при закрытии.
