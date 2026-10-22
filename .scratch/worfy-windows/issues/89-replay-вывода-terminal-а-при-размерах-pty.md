# 89 — Terminal: replay сохранённого вывода при тех размерах pty, при которых он рисовался

Type: task
Status: open
Blocked by: 42
Source: «Результат» [Ticket-а 86](86-terminal-на-windows-экран-после-resize-и-alternate-screen.md) (PR #736),
ответ Session на Mac на вопросы PR #736, 2026-10-22. Строки — по main `b9a64940`.

## Что происходит

На Windows красные два e2e test-а Terminal-а:

- `test/e2e/terminal.spec.ts:211` «New terminal starts the shell in the Project root; resize, Session view and
  reload keep it; closing the Node ends it». Падает на `:273`: окно после reload не находит строку
  `marker-one` (`expect.poll(() => screenText(reloaded)).toMatch(/^marker-one$/m)`).
- `test/e2e/focus.spec.ts:342` «a Terminal in focus mode gets the size of its tile, and after leaving focus
  mode the pty has the size of the Canvas Node again». Падает на `:396`: tile focus mode, смонтированный
  заново, видит экран не таким, каким его нарисовал shell.

На Mac оба test-а зелёные. На ПК — 0 из 3 (`--repeat-each=3`) до и после PR #736.

Причина — replay, то есть повтор сохранённого вывода. Новый вид Terminal-а (окно после reload, tile, смонтированный
заново) пишет весь сохранённый вывод одним куском при своём нынешнем размере. Но этот вывод рисовался при других
размерах pty.

На macOS это не видно: shell после resize сам перерисовывает строку. На Windows ConPTY из node-pty
(`useConptyDll`) работает в режиме passthrough. После resize он не перерисовывает экран, а спрашивает позицию
курсора (`ESC[6n`, отвечает main через `cursor-answers.ts`). Дальше PSReadLine рисует строку абсолютными
позициями (`ESC[12;1H…`) по своей копии буфера. Такой вывод верен только при том размере, при котором он
пришёл.

## Доказательства (probe на ПК, 2026-10-22)

Probe — скрипт на node-pty с `useConptyDll`, как `spawnShellPty`. Shell — Windows PowerShell 5.1 с `-NoProfile`,
временные USERPROFILE/APPDATA/LOCALAPPDATA. `@xterm/headless` стоит на месте main и вида.

- Сценарий: старт 117×30, команда, resize 160×40, команда `'mark'+'er-one'`, resize 72×16.
- Живой экран (xterm.js получал вывод и resize-ы по ходу) верный.
- Replay всего записанного вывода одним куском при 72×16 даёт `marker-onee'` и `b=160x40Host.UI…`. Это та же
  картина, что в e2e: `marker-onene'` и `b-size=117x30lexey\AppData…`.
- Replay того же вывода с resize-ами в тех же местах совпадает с живым экраном строка в строку.
- `windowsPty: { backend: 'conpty', buildNumber: 26200 }` не помогает: экраны с ним и без него одинаковые
  (`diff` — 0 строк). Для сборки ≥ 21376 xterm.js оставляет reflow включённым.

## Что делаем

1. main хранит вместе с сохранённым выводом размеры pty: для каждого resize — смещение в выводе и cols×rows,
   плюс размер pty в начале сохранённого окна (когда старый вывод обрезается, первый размер сдвигается вместе
   с ним).
2. `terminal.open` отдаёт эти размеры вместе с выводом.
3. Вид при replay пишет вывод кусками и между кусками ставит себе размер, при котором шёл следующий кусок. Потом
   подгоняет себя под свой размер, как сейчас.
4. На macOS поведение не меняется: те же размеры там просто совпадают с тем, что shell перерисовал сам.

## Готово, когда

- [ ] `terminal.spec.ts:211` и `focus.spec.ts:342` зелёные на ПК 3 из 3 (`--repeat-each=3`), без skip.
- [ ] Unit- или contract-test на хранение размеров: обрезка старого вывода сдвигает первый размер; test красный
      без правки.
- [ ] На Mac `terminal.spec.ts`, `focus.spec.ts` и `wheel-over-nodes.spec.ts` зелёные, как до правки.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `src/main/terminal/pty.ts` — resize, `terminal.open`; `replay-buffer.ts` — буфер сохранённого вывода (его
  выносит туда PR тикета 42, поэтому тикет ждёт 42).
- `src/shared/ipc/terminal.ts` — ответ `terminal.open`.
- `src/renderer/canvas/nodes/TerminalNode.tsx` — replay в новом виде.
- `test/e2e/terminal.spec.ts:211`, `:273`; `test/e2e/focus.spec.ts:342`, `:396`.

## Попутно, не в этом тикете

Если приглашение PowerShell занимает строку ровно до последнего столбца, живой экран сбивается на одну строку.
xterm.js отвечает на `ESC[6n` строкой приглашения (курсор ждёт переноса), а ConPTY считает, что курсор уже на
следующей строке. Probe при 69×16: `marker-one … >`; при 72×16 этого нет. В e2e не участвует.
