# 68 — Ответы на `ESC[c`, DECRQM и OSC-запросы цвета: нет ответа без view, двойной ответ при двух view

Type: bug
Status: open
Blocked by: —
Source: follow-up [Ticket-а 39](39-ответы-экрана-считаются-вводом.md) (PR #512, влит 2026-10-19 как `77c473cb`):
«Итог» Ticket-а 39, «Что не проверено (на `fd2f054c`)» и ответ на ревью Mac круга 2 («Не в этом PR: ответы на
другие запросы … — Mac заводит отдельный Ticket»).

## Что происходит

- Программа в Terminal спрашивает терминал: атрибуты устройства (`ESC[c`), состояние режима (DECRQM,
  `ESC[?…$p`), цвета (OSC 10/11/4 с `?`). Отвечает xterm.js того view, который сейчас смонтирован; ответ
  уходит в pty как `terminal.input` с `reply: true`.
- С PR #512 main сам отвечает только на запрос позиции курсора (`ESC[6n`) на всех системах и на `ESC[c`
  консоли на Windows (`src/main/terminal/console-request.ts`). Остальные запросы — по-прежнему view
  (`src/main/terminal/cursor-answers.ts`, шапка файла).
- **Нет view — нет ответа.** Canvas снимает Node вне экрана, окно остаётся подписанным. Запрос, пришедший
  в это время, остаётся без ответа. На macOS это и `ESC[c`. Что делает программа (ждёт, печатает мусор) —
  не запускалось.
- **Два живых view — два ответа.** Каждый смонтированный view отвечает сам; main отбрасывает повтор только
  для ответа о позиции курсора (`TerminalRegistry.write`, `src/main/terminal/pty.ts:1029`).
- Экран без display в main (`@xterm/headless` в worker-е) уже разбирает весь вывод и сам вычисляет
  большую часть этих ответов; сейчас main берёт из них только ответ о позиции.

## Что делаем

1. Сначала замер: на Mac и на ПК — какие запросы приходят от shell-ов и обычных программ (`vim`, `less`,
   `fzf`, PowerShell у prompt-а), что отвечает xterm.js worker-а и что xterm.js view на каждый. Таблица —
   в «Итог».
2. main отвечает на каждый запрос, ответ на который у worker-а совпадает с ответом view, и отбрасывает тот
   же ответ от view (как сейчас для `ESC[6n`): один ответ при любом числе view, ноль или два.
3. Запрос, ответ на который зависит от view (например, цвета темы окна), остаётся за view; при двух view
   main пропускает только первый ответ. Решение и довод — в «Итог».

## Готово, когда

- [ ] Без смонтированного view `ESC[c`, DECRQM и каждый запрос из таблицы пункта 1, на который отвечает
      main, получают ровно один ответ — test на macOS и на Windows.
- [ ] Два смонтированных view: ровно один ответ на каждый запрос — test; мутант без отбрасывания —
      красный.
- [ ] Ввод человека, похожий на ответ (вставка текста `ESC[?1;2c`), доходит до shell-а — test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full на Mac и вердикт ПК (платформенный PR,
      ADR-0056, пункт 2).

## Тесты

- `test/contract/terminal-cursor.test.ts` — случаи без view и с двумя view для каждого запроса из таблицы.
- `test/unit/terminal-replies.test.tsx` — пометка `reply` у новых ответов view.

## Где в коде

- `src/main/terminal/cursor-answers.ts` — `WORKER_CODE` (`:77`) и что main берёт из ответов worker-а
  (`:212`).
- `src/shared/terminal/cursor-answer.ts` — `isCursorAnswer`: какие ответы view main отбрасывает.
- `src/main/terminal/pty.ts:1026-1030` — `TerminalRegistry.write` с `reply`.
- `src/main/terminal/console-request.ts` — ответ на `ESC[c` консоли Windows.
- `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/terminal-user-input.ts` — ответы
  view.

## Вне скоупа

- Скорость разбора вывода — [Ticket 67](67-разбор-вывода-terminal-worker-на-shell-или-пул.md).
- Старый клиент Linked machine без `reply` (версия протокола link 2) — вопрос из «Итог» Ticket-а 39.

## Итог

Заполняется при закрытии.
