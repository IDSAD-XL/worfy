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

1. `test/e2e/terminal.spec.ts:218` — «New terminal starts the shell in the Project root; resize, Session
   view and reload keep it; closing the Node ends it». Падает на `:280` (после reload окна; на ветке
   PR #710 — `:273`): строка экрана `marker-onene'`. Вывод `marker-one` нарисован поверх хвоста
   набранной строки, которая переносилась при другой ширине (Node перед этим менял размер: 117×30 →
   69×16).
2. `test/e2e/focus.spec.ts:341` — «a Terminal in focus mode gets the size of its tile, and after leaving
   focus mode the pty has the size of the Canvas Node again». Падает в `sttySize` (`:307`), вызов
   `:395` (`tile-again`; на ветке PR #710 — `:396`): после resize pty 21×81 → 44×150 → 21×81 → 44×150
   строка читается `tile-again=44x150y\AppData\Local\…` — после текста остались старые символы строки.
3. `test/e2e/wheel-over-nodes.spec.ts:321` — «a Terminal running a program in the alternate screen gets
   no arrow keys from the wheel until it is active». Падает на `:343`: после `printf '\033[?1049h'; cat -v`
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
