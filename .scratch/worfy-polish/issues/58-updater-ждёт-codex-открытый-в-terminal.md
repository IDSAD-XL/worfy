# 58 — Updater отказывает, пока встроенный `codex` открыт в terminal-е

Type: bug
Status: open
Blocked by:
Source: приёмка worfy-multi-vendor 32, 2026-11-04 (владелец: «да» на ticket); перезапуск Stable ждал 3 минуты процесс
`codex` владельца из terminal-а

## Что происходит

Диалог одобрения hook-ов в Codex (worfy-polish 54) даёт команду, которая запускает встроенный binary Codex из папки
Stable: `<worfy-stable.app>/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-…/bin/codex`. Пользователь
оставляет его открытым в terminal-е. `install-stable` (`scripts/install-stable.mjs`, `runningCopies` и ожидание из
worfy-polish 53) считает любой процесс с путём внутри копии работающей копией. Поэтому «Restart now» ждёт до двух
минут и отказывает, пока в terminal-е открыт Codex. Внешний скрипт перезапуска 2026-11-04 так же простоял 3 минуты на
`codex` владельца. Из текста отказа не понятно, что закрыть нужно Codex в terminal-е.

## Что делаем

1. Процесс встроенного `codex`, запущенный не worfy (его родитель — не процесс копии), не ждать молча: отказ сразу
   называет его — «Codex is open in a terminal (pid N): close it, then press Restart now again» — или, если безопасно,
   не считать его работающей копией. Выбрать одно и записать почему в «Итог»: подменять папку, из которой исполняется
   binary, на macOS и Windows — разные риски (на Windows файл занят).
2. Процессы самой worfy (дочерние Session, `codex app-server`) — как в worfy-polish 53: ждать их выхода.
3. Тост отказа показывает этот совет целиком.

Глубина review — `medium`. Платформенный: поиск процессов и родителей на macOS и Windows — Windows-часть на ПК.

## Готово, когда

- [ ] Unit test `install-stable`: `codex` из копии с чужим родителем — отказ сразу с его pid и советом (или пропуск —
      по решению п. 1); дочерний процесс копии — ожидание, как в worfy-polish 53. win32 — с поданным листингом.
- [ ] Все unit и contract test-ы `src/main/update/` и `scripts/install-stable.mjs`, `pnpm typecheck`, `pnpm lint` —
      exit 0.
