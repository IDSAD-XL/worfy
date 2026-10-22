# 38 — Вывод после выхода shell не виден в открытом виде Terminal-а

Type: task
Status: open
Blocked by: —
Source: ревью корректности PR #740 (worfy-windows 89, replay при размерах pty), 2026-10-22; решение
Mac — завести тикетом в worfy-polish, это не только Windows. Строки — по main `343be106`.

## Что происходит

- На macOS и Linux main оставляет вывод, который приходит после выхода shell (не после закрытия
  Terminal-а): `deliver` в `src/main/terminal/pty.ts:616` отбрасывает его только при
  `terminal.closing` или на Windows. Вывод попадает в буфер для replay и рассылается экранам
  (`terminal.output`). Так задумано: комментарий `pty.ts:614` — «what comes after an exit that was not
  a close is kept for the next open».
- Открытый вид этот вывод не показывает. По событию `terminal.exit`
  (`src/renderer/canvas/nodes/TerminalNode.tsx:311`) вид ставит `attached = false` (`:313`), а
  подписка на вывод пишет на экран только при `attached` и копит только при `opening || replaying`
  (`:306-309`). Всё, что приходит после exit, теряется для этого вида.
- Вывод появится только при следующем открытии вида (reload окна, повторный mount Node-а): replay
  покажет его из буфера main. Пользователь видит разный экран у одного Terminal-а в зависимости от
  того, переоткрывал ли он вид.
- Так было и до PR #740: правка replay этого поведения не меняла.
- Когда это бывает: процесс, запущенный в shell в фоне, пишет в тот же pty после выхода shell; или
  последний кусок вывода самого shell node-pty отдаёт после события exit.

## Что делаем

- Открытый вид после `terminal.exit` продолжает писать на экран вывод этого Terminal-а, пока на Node
  не запущен новый shell (`terminal.started`). Счёт `written` (сколько вывода уже на экране) тот же,
  что для живого вида, чтобы replay при следующем открытии не повторил строки.
- На Windows ничего не меняется: там main этот вывод не оставляет (`pty.ts:616`).
- Проверить вместе с replay из PR #740: вывод, пришедший во время replay и после exit, пишется один раз
  и после replay.

## Готово, когда

- Unit-тест вида (`test/unit/terminal-replies.test.tsx` или рядом): после `terminal.exit` приходит
  `terminal.output`, и строка есть на экране; после `terminal.started` старый вывод на новый экран не
  попадает. Тест красный без правки.
- Contract-тест на настоящем shell macOS/Linux (`test/contract/terminal.test.ts`): фоновый процесс
  пишет после `exit` shell-а, открытый подписчик получает строку, повторное открытие показывает её ровно
  один раз.
- e2e Terminal-а (`terminal.spec.ts`, `focus.spec.ts`) зелёные на Mac и на Windows.

## Где в коде

- `src/main/terminal/pty.ts:609-622` — `deliver`, что main оставляет после exit.
- `src/renderer/canvas/nodes/TerminalNode.tsx:306-325` — подписки на вывод и exit у вида.
- `src/renderer/canvas/nodes/terminal-replay.ts` (после PR #740) — replay с очередью вывода.

## Итог

—
