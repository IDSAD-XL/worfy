# 68 — Вывод плана `gate-resolve` — текст с tab-ами: ломается на имени папки с tab или переводом строки

Type: bug
Status: open
Blocked by: —
Source: заметки PR #711 (`worfy-harness` 64), 2026-10-21.

## Что происходит

Ticket 64 сделал вход `gate-resolve.mjs` NUL-разделённым. Выход плана остался строками, разделёнными tab-ами
(`harness/hooks/gate-resolve.mjs:4-7`, печать `:221`, `:236`). Папка workspace, в имени которой есть tab или перевод
строки, ломает разбор плана в `gate.mjs`. Предупреждение «changes outside workspaces» (`:244`) печатает путь с переводом
строки на двух строках — это только вид.

## Что делаем

1. Красный test: workspace в папке с tab и с переводом строки в имени получает свой scope.
2. Выход плана — JSON (или NUL-разделённые поля); предупреждение показывает путь в кавычках с экранированием.

## Готово, когда

- [ ] Test красный на main, зелёный с правкой; test-ы gate по файлам, `plugin-neutral.test.sh` — exit 0.

## Где в коде

- `harness/hooks/gate-resolve.mjs`, разбор плана в `harness/hooks/gate.mjs`.

## Риски

- Платформенный PR (`harness/hooks`): нужен Windows verdict.

## Итог

Заполняется при закрытии.
