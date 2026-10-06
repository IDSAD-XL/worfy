# 13 — Terminal: выделение мышью при масштабе и размер pty после focus mode

Type: task
Status: blocked — blocked by 06, 07, 08, 09
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C; Ticket-ы 27 и 28 worfy-mvp (Terminal, focus mode)

## Что делаем

Две ошибки Terminal Node-а.

**1. Выделение мышью уезжает при масштабе Canvas ≠ 100%.** xterm живёт внутри CSS
`transform: scale`. xterm.js считает координаты мыши без учёта transform — это известная проблема
xterm.js. В `src/renderer/canvas/nodes/TerminalNode.tsx` её никто не обрабатывает.

**2. Ширина pty остаётся шириной плитки после выхода из focus mode.** Вывод из кода, не
воспроизведён:

- focus mode (`src/renderer/focus/FocusMode.tsx:95-98`) рисует второй TerminalNode с тем же `nodeId`
  в плитке, а Canvas держит свою копию смонтированной;
- оба шлют `terminal.resize` (`TerminalNode.tsx:106-108`), и побеждает последний;
- после выхода размер коробки Canvas-копии не изменился, поэтому ResizeObserver (`:112-116`) не
  срабатывает, и pty остаётся с размером плитки.

**Первый шаг — воспроизвести обе ошибки e2e-ом.** Итог — в «Итог».

**Правки:**

- **(1)** Перевести координаты мыши с учётом масштаба Canvas. Или выбрать другой способ, найденный
  при воспроизведении, — например, рисовать Terminal без transform. Выбор — в «Итог».
- **(2)** Вариант первый: при выходе из focus mode Canvas-копия явно подгоняет размер (fit) и шлёт
  `terminal.resize`. Вариант второй: Canvas-копия не монтируется под слоем focus mode.
- Шапка `TerminalNode.tsx` описывает attach/detach, но не два одновременных view одного shell. Если
  правка меняет это устройство — ADR (номер с 0022).

## Готово, когда

- [ ] При масштабе 50% и 150% выделение мышью от символа A до символа B выделяет ровно A…B: e2e читает выделение xterm.
- [ ] После входа в focus mode и выхода `stty size` в Terminal равен размеру Canvas-копии (cols × rows по `fittedSize`, `:46-51`).
- [ ] Ввод и вывод в Terminal после focus mode работают: существующий `terminal.spec.ts` зелёный.
- [ ] Снимки Terminal на Canvas и в focus mode в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/terminal.spec.ts` — выделение при масштабе.
- `test/e2e/focus.spec.ts` — `stty size` после выхода из focus mode.
- Сначала падающий test: после выхода из focus mode `stty size` равен размеру плитки.

## Где в коде

- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/focus/FocusMode.tsx`
- `test/e2e/terminal.spec.ts`
- `test/e2e/focus.spec.ts`
