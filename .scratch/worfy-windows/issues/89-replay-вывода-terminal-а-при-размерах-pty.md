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

## Результат

Ветка `worfy-windows/89` (от main `cacdafe6`), PR не открыт: коммит готов, push и PR — за оркестратором.

**Что сделано.**

- `src/main/terminal/replay-buffer.ts`: `ReplayBuffer` хранит размеры pty рядом с выводом. Конструктор берёт
  размер, с которым pty создан (`{ at: 0, cols, rows }`); `resize(cols, rows)` добавляет `{ at: end, cols, rows }`.
  Resize без вывода после прошлого заменяет его, resize в тот же размер ничего не добавляет. Когда старый вывод
  обрезается (предел 256 KB или конец OSC-последовательности), размеры, чей вывод весь выброшен, уходят, а
  `sizes()` сдвигает первый оставшийся на новое начало окна. Последний размер — нынешний размер pty.
- `src/main/terminal/pty.ts`: `applySize` пишет в буфер только resize, который node-pty принял; `open` отдаёт
  `sizes` (у только что запущенного shell — `[]`). У работающего Terminal-а `open` сначала даёт pty размер вида
  (если вид владеет размером), потом читает размеры, так что последний размер — тот, что у pty сейчас.
- `src/shared/ipc/terminal.ts`: `replaySizeSchema` и поле `sizes` в ответе `terminal.open`, необязательное: вид
  без него пишет replay одним куском, как раньше.
- `src/renderer/canvas/nodes/terminal-replay.ts` (новый): `writeReplay` пишет replay кусками, перед каждым
  куском ставит xterm.js его размер, следующий кусок — только когда xterm.js разобрал предыдущий (resize в
  xterm.js применяется сразу, мимо ещё не разобранного вывода). Смещения `at` — в счёте всего потока, как `end`.
- `TerminalNode.tsx`: replay через `writeReplay`; пока он идёт, ResizeObserver не подгоняет терминал под Node.
  После replay терминал берёт свой размер, как раньше: размер Node, а без layout — размер до replay. У вида,
  который владеет размером pty, это и есть нынешний размер pty. Вывод, пришедший до выхода shell во время
  replay, пишется после replay (раньше — сразу, но тогда replay был одним `write`, и порядок сохранялся).
  `terminal-alt-buffer.ts` работает по-прежнему: он слушает каждый resize, в том числе resize-ы replay.
- `tsconfig.test.node.json`: новый модуль вида внесён в список, как другие модули renderer с unit-test-ами.

**Проверки на ПК (Windows 11 10.0.26200).**

| Проверка | Код | Итог |
| --- | --- | --- |
| e2e `terminal.spec.ts:211` и `focus.spec.ts:342`, `--repeat-each=3`, main `cacdafe6` (до правки) | 1 | 6 failed: `:273` (`/^marker-one$/m`) и `focus` по 0 из 3 |
| то же с правкой | 0 | 6 passed: 3 из 3 каждый |
| e2e `terminal.spec.ts`, `focus.spec.ts`, `wheel-over-nodes.spec.ts`, `--grep-invert @packaged` | 0 | 19 passed |
| `test/unit/terminal-replay.test.ts` (14 test-ов: буфер, registry, `writeReplay` на `@xterm/headless`) | 0 | 14 passed |
| мутант: `ReplayBuffer.resize` ничего не делает | 1 | 6 из 14 красные |
| мутант: обрезка не трогает размеры | 1 | 3 из 14 красные |
| мутант: первый размер не сдвигается на начало окна | 1 | 3 из 14 красные |
| мутант: вид пишет replay одним куском, без resize-ов | 1 | 5 из 14 красные |
| contract `test/contract/terminal*.test.ts`, `node-pty.test.ts` (с новым test-ом размеров на настоящем PowerShell) | 0 | 15 файлов (с `terminal-replay` и `no-rmsync`): 208 passed, 140 skipped |
| unit-test-ы Terminal (`terminal-*.test.ts(x)`, `console-request`, `signin-replies`) | 0 | 430 passed |
| `pnpm lint`, `pnpm typecheck`, `no-rmsync.test.ts` | 0 / 0 / 0 | |

История PowerShell владельца (`ConsoleHost_history.txt`) до и после каждого прогона с настоящим shell —
190084 байт, SHA256 `856228828BFC…C148E`, без изменений.

**Не проверено.** На Mac прогона нет: `terminal.spec.ts`, `focus.spec.ts` и `wheel-over-nodes.spec.ts` там —
пункт для Mac (раздел «Mac checks» PR). Экран «Sign in with gh» (`projects.connect.signIn`) тоже делает
replay, но размеров не получает: его вид — вне следа тикета.

**Ревью, круг 1** (одна находка med в test-ах, три low; коммиты `a8211e50`, `efa6e775` поверх `0112005b`,
ветка на origin/main `1cee90d1`).

- Число размеров ограничено (`replay-buffer.ts`). Resize-ы, между которыми меньше 100 мс (`RESIZE_RUN_MS`), —
  одна серия, как при протягивании угла Node: серия хранит свой последний размер с того места, где она
  началась. Предел по числу символов не взят: в сценарии тикета между resize-ами стоит короткая команда
  (`'mark'+'er-one'`, около 150 символов), и такое слияние вернуло бы ошибку. Больше 64 размеров
  (`SIZES_LIMIT`) не хранится: два самых старых сливаются в один, это помечено `shortcut:`. Один resize
  `@xterm/headless` при полном scrollback (5000 строк) на ПК занимает 2,3 мс, значит 64 resize-а —
  около 0,15 с.
- Новые test-ы: серия resize-ов, возврат к прежнему размеру, предел 64. «Шторм» из 68 resize-ов по кадру
  с перерисовкой приглашения даёт 3 размера и тот же экран, что у живого вида.
- `terminal-replies.test.tsx`: вид, смонтированный после вывода и resize-ов через registry, рисует экран
  живого вида. Вызов ResizeObserver посреди replay подгоняет вид только после конца replay.
- Contract-test размеров считает `at` в счёте всего потока: вычитает `end - replay.length` и ограничивает
  `at` выводом до и после resize.

| Проверка | Код | Итог |
| --- | --- | --- |
| мутант: без флага `sizing` (refit во время replay) | 1 | 1 из 31 красный |
| мутант: `TerminalNode` не передаёт `sizes` | 1 | 2 из 31 красные |
| мутант: нет серий resize-ов | 1 | 3 из 31 красные |
| мутант: нет предела 64 | 1 | 1 из 31 красный |
| `terminal-replies.test.tsx` + `terminal-replay.test.ts` | 0 | 31 passed |
| contract Terminal + `node-pty` + `terminal-replay` + `no-rmsync` | 0 | 15 файлов, 212 passed, 140 skipped |
| unit-test-ы Terminal | 0 | 436 passed |
| e2e `terminal.spec.ts:211`, `focus.spec.ts:342`, `--repeat-each=3` | 0 | 6 passed |
| `pnpm lint`, `pnpm typecheck` | 0 / 0 | |

История PowerShell владельца до и после — 190084 байт, `856228828BFC…C148E`, без изменений.
