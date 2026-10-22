# 86 — Terminal на Windows: строки экрана после resize и reload, стрелки колеса в alternate screen

Type: task
Status: open
Blocked by: —
Source: прогон e2e PR #710 (Terminal e2e под PowerShell) на ПК 2026-10-22,
[комментарий](https://github.com/IDSAD-XL/worfy/pull/710#issuecomment-6329031641); решение Session на Mac
того же дня: test-ы не skip-аются, причина уходит в этот тикет.

## Что происходит

Три e2e test-а Terminal-а красные на Windows и на main `30031d93`, и с PR #710. PR #710 их не ухудшает:
это поведение приложения, не test-ов.

Номера строк — на main `54c1c59a` (после мержа PR #710).

1. `test/e2e/terminal.spec.ts:211` — «New terminal starts the shell in the Project root; resize, Session
   view and reload keep it; closing the Node ends it». Падает на `:273` (после reload окна):
   строка экрана `marker-onene'`. Вывод `marker-one` нарисован поверх хвоста
   набранной строки, которая переносилась при другой ширине (Node перед этим менял размер: 117×30 →
   69×16).
2. `test/e2e/focus.spec.ts:342` — «a Terminal in focus mode gets the size of its tile, and after leaving
   focus mode the pty has the size of the Canvas Node again». Падает в `sttySize` (`:314`), вызов
   `:396` (`tile-again`): после resize pty 21×81 → 44×150 → 21×81 → 44×150
   строка читается `tile-again=44x150y\AppData\Local\…` — после текста остались старые символы строки.
3. `test/e2e/wheel-over-nodes.spec.ts:324` — «a Terminal running a program in the alternate screen gets
   no arrow keys from the wheel until it is active». Падает на `:346`: после `printf '\033[?1049h'; cat -v`
   колесо над активным Terminal-ом не шлёт `^[[A`.

Предположение, не проверено:

- 1 и 2 — одна причина. После resize и xterm.js, и ConPTY перестраивают строки экрана, каждый по-своему,
  а ConPTY потом дорисовывает только то, что по его копии изменилось, и в xterm.js остаются старые
  символы. worfy не передаёт xterm.js опцию `windowsPty`
  (`src/renderer/canvas/nodes/TerminalNode.tsx:250`, `new Terminal({ … })`), которая говорит xterm.js,
  что под ним ConPTY.
- 3 — ConPTY сам обрабатывает переход в alternate screen (`?1049h`) и не передаёт его xterm.js. Тогда
  xterm.js не знает, что программа в alternate screen, и колесо прокручивает буфер вместо стрелок.

## Что делаем

- Проверить на ПК, что именно доходит до xterm.js после resize и после `?1049h` (сырые байты из pty).
- Если подтвердится — передать xterm.js `windowsPty` (backend `conpty`, номер сборки Windows) на Windows;
  для alternate screen — то, что покажет проверка.
- Если причина другая — записать её сюда и решить заново.

## Готово, когда

- [ ] Три test-а выше зелёные на ПК 3 прогона из 3, без skip и без `test.fail`.
- [ ] Поведение на macOS не меняется: те же три test-а зелёные на Mac.
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.

## Результат

Обе причины найдены на ПК 2026-10-22 (Windows 11 10.0.26200, node-pty 1.2.0-beta.15 с conpty.dll
пакета, xterm.js 6.0.0). Исправлен test 3; test-ы 1 и 2 остаются красными: их исправление — в
`src/main/terminal/pty.ts`, который в этом тикете трогать нельзя (тикет 42).

Как смотрели: probe-скрипт на node-pty из worktree запускал Windows PowerShell (`-NoProfile`) и Git
Bash на ConPTY, как `spawnShellPty`, с временными USERPROFILE/APPDATA/LOCALAPPDATA, писал сырые байты
pty, а xterm.js без экрана (`@xterm/headless`) играл роль main и вида: отвечал на `ESC[c` и `ESC[6n`.
Для test-а 3 — ещё отладочный лог в e2e (состояние xterm.js в окне), после замера убран.

### Test 3: колесо в alternate screen — исправлено

- Предположение тикета не подтвердилось: ConPTY не глотает `ESC[?1049h`. После
  `printf '\033[?1049h'; cat -v` из pty приходит `\u001b[?1049h` как есть, и с ответом на `ESC[c`, и
  без него. Стрелки `ESC[A` доходят до `cat`: после Enter он печатает `^[[A^[[AMARK`.
- Причина в приложении (на любой системе) — ошибка xterm.js 6.0. Пустой alternate buffer хранит место
  на столько строк, сколько было у терминала при его последней очистке: при создании это 80×24, потому
  что TerminalNode создаёт xterm.js до замера Node. Resize к меньшему числу строк это место не
  убирает, пока буфер пуст (`Buffer.resize` пропускает пустой буфер). На Windows ячейка выше, и Node
  560×340 получает 81×21. Программа в alternate screen, которая печатает ниже последней строки,
  получает до трёх строк «scrollback», и колесо прокручивает их, а не шлёт стрелки. Замер в окне e2e:
  `buffer=alternate length=23 baseY=2`, после колеса `viewportY` 2 → 0, `onData` пуст. На
  `@xterm/headless`: создан 80×24, затем resize до 81×21, 40 строк в alternate screen — `length=24
  baseY=3`; создан сразу 81×21 — `length=21 baseY=0`.
- Вторая причина — в самом test-е. На macOS echo терминала показывает стрелку как `^[[A` (echoctl).
  Консоль Windows (Git Bash) отдаёт в echo `ESC[A` как есть: xterm.js поднимает курсор, текста
  `^[[A` нет. test ждал `^[[A` в echo и поэтому на Windows не прошёл бы и без ошибки xterm.js. Проверка
  «стрелок нет» перед этим на Windows проходила вхолостую.
- Исправление:
  - `src/renderer/canvas/nodes/terminal-alt-buffer.ts`: после каждого resize пустой alternate buffer
    очищается заново под новое число строк (внутреннее `_core.buffers.alt` xterm.js, с проверкой
    формы; комментарий `shortcut:` говорит, когда убрать). Подключено в `TerminalNode.tsx`.
  - `test/e2e/wheel-over-nodes.spec.ts:324`: после MARK и после колеса test жмёт Enter и читает
    строку, которую печатает `cat -v`. Это работает на обеих системах и строже прежнего: мутант, который
    пропускает колесо в неактивный Terminal, красный с новой проверкой (`^[[A^[[BMARK`).
  - Unit test `test/unit/terminal-alt-buffer.test.tsx`: красный без очистки (2 из 6) и без проверки
    «буфер пуст» (1 из 6).

### Test-ы 1 и 2: экран после resize, reload и нового вида — не исправлено

- `windowsPty` не помогает. Для сборки ≥ 21376 xterm.js оставляет свой reflow включённым. Probe с
  `windowsPty: { backend: 'conpty', buildNumber: 26200 }` и без него дал одинаковые экраны
  (`diff` — 0 строк разницы), поэтому опция не добавлена.
- ConPTY пакета работает в режиме passthrough. После resize он не перерисовывает экран, а спрашивает
  позицию курсора (`ESC[6n`, отвечает main). Дальше PSReadLine рисует строку абсолютными позициями
  (`ESC[12;1H…`) по своей копии буфера.
- Причина падений — повтор сохранённого вывода (replay). Новый вид Terminal-а пишет весь сохранённый
  вывод одним куском при своём нынешнем размере. Так делает окно после reload (test 1, `:273`) и tile
  focus mode, смонтированный заново (test 2, `:396`). Но вывод рисовался при других размерах pty.
  Probe (PowerShell, resize 117×30 → 160×40 → 72×16): живой экран верный, а replay всего вывода при
  72×16 даёт `marker-onee'` и `b=160x40Host.UI…`. Это та же картина, что в e2e: `marker-onene'`,
  `b-size=117x30lexey\AppData…`. Replay того же вывода с resize-ами там, где они были, совпадает с
  живым экраном строка в строку.
- Что нужно сделать: main хранит вместе с сохранённым выводом размеры pty (смещение в выводе и
  cols×rows, плюс размер в начале сохранённого окна). `terminal.open` отдаёт их, а вид при replay
  вызывает `terminal.resize` между кусками и потом подгоняет себя под свой размер. Затрагивает
  `src/main/terminal/pty.ts` (буфер вывода, resize, open), `src/shared/ipc/terminal.ts` и
  `TerminalNode.tsx`.
- Попутно найдено, в e2e не участвует. Если приглашение PowerShell занимает строку ровно до
  последнего столбца, живой экран сбивается на одну строку. xterm.js отвечает на `ESC[6n` строкой
  приглашения (курсор ждёт переноса), а ConPTY считает, что курсор уже на следующей строке. Probe при
  69×16: `marker-one … >`; при 72×16 такого нет.

### Замеры на ПК

Каждый прогон e2e шёл под замком e2e. `@packaged` исключён: собранного `.app` на ПК нет.

| Прогон | Результат |
| --- | --- |
| До правки, сборка `54c1c59a`, три spec-а целиком | 16 passed, 4 failed: 1, 2, 3 и `@packaged` |
| Правка test-а без правки приложения, три spec-а | 16 passed, 3 failed: test 3 на `:351` (`MARK`, `MARK`, стрелок нет) |
| С правкой, три spec-а целиком | 17 passed, 2 failed: 1 (`:273`), 2 (`:396`) |
| С правкой, `--repeat-each=3` для трёх test-ов | test 3 — 3 из 3; 1 и 2 — 0 из 3 |
