# 11 — Окно, меню, уведомления и Ctrl вместо ⌘ на Windows

Type: task
Status: done — 2026-10-10, [PR #215](https://github.com/IDSAD-XL/worfy/pull/215)
Blocked by: 02
Source: решения владельца 2026-10-07: Q1 (полный порт worfy под Windows), Q24 (Windows 10 21H2+ и 11, x64) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port» (пункт 1; «Последствия» — окно, меню, хоткеи и `AppUserModelId`); [ADR-0006](../../../docs/adr/0006-ipc-contract-by-declaration-merging.md) (preload не знает каналов)

## Что происходит

- **Окно.** `createMainWindow` (`src/main/window.ts:68-88`) задаёт рамку дизайна F для macOS:
  `titleBarStyle: 'hiddenInset'`, `trafficLightPosition`, `vibrancy: 'sidebar'`,
  `visualEffectState` и прозрачный `backgroundColor: '#00000000'` (`:74-81`). Ветки по системе нет.
- Renderer рассчитан на эту рамку:
  - фон `body` прозрачный (`src/renderer/theme/tokens.css:140-142`), sidebar полупрозрачный
    (`--sidebar-translucent`, `tokens.css:76-77`, `:127`; `src/renderer/shell/shell.css:9-18`);
  - место под traffic lights: `padding-left: 80px` у toolbar без sidebar (`shell.css:55-58`) и у
    полосы режима фокуса (`src/renderer/focus/focus.css:20`, `:28`), пустая полоса
    `.w-sidebar__titlebar` высотой с toolbar (`shell.css:20-24`, `src/renderer/shell/Sidebar.tsx:15`);
  - toolbar и эти полосы — области перетаскивания окна (`-webkit-app-region: drag`, `shell.css:23`,
    `:53`; `focus.css:31`).
- На ПК владельца `pnpm dev` открывает окно worfy на экране First run. Снимок после Ticket-а 02
  (`../evidence/02-pnpm-dev.png`, evidence Ticket-а 01, раздел 27): рамка — уже обычная рамка
  Windows (заголовок «worfy», кнопки свернуть, развернуть, закрыть), под ней меню `File Edit View
  Window`; в строке поиска подпись `⌘K`. Работу клавиш, прозрачность и отступы под traffic lights
  никто не проверял.
- Renderer систему не знает. Preload отдаёт только `invoke`, `on` и `off` (`src/preload/index.ts:10-29`),
  в `src/renderer` проверок системы нет.
- **Меню.** `menuTemplate` (`src/main/menu.ts:11-34`) уже не ставит `appMenu` вне macOS (`:13`).
  Роли `fileMenu`, `editMenu`, `windowMenu` и пункты View (`:14-32`) Electron строит сам под
  систему, их ускорители — `CmdOrCtrl`, на Windows это Ctrl. Значит, на Windows Ctrl+= и Ctrl+- —
  ускорители View `zoomIn` и `zoomOut` (`:23-25`), а Ctrl+Z, Ctrl+C и Ctrl+V — роли `editMenu`
  (`:15`). Срабатывает ли ускоритель меню раньше обработчика keydown страницы — на Windows не
  проверялось.
- **Уведомления** — `new Notification` (`src/main/notify.ts:198-199`). `app.setAppUserModelId` в
  `src/` не вызывается (grep). На Windows его вызывают до первого окна со значением `appId`
  (`dev.worfy.app`, `electron-builder.yml:3`): без него уведомления не показываются или идут без
  значка worfy (ADR-0054; документация Electron и electron-builder, NSIS). Уведомления ставятся в
  `src/main/index.ts:87`, первое окно — `:90`. Для
  dev-сборки документация Electron (Notifications, раздел Windows) просит ярлык
  `node_modules\electron\dist\electron.exe` в меню Пуск и `app.setAppUserModelId(process.execPath)`.
- **Сочетания клавиш с ⌘** (`metaKey` в renderer):
  - ⌘K — палитра (`src/renderer/palette/CommandPalette.tsx:324`); ⌘F — поиск по Canvas
    (`src/renderer/find/CanvasFind.tsx:462`); ⌘↩ — режим фокуса
    (`src/renderer/canvas/overlays/FocusEntry.tsx:40`); ⌘Z и ⇧⌘Z — история Canvas
    (`src/renderer/canvas/overlays/SelectionToolbar.tsx:54`); ⌘= и ⌘− — масштаб Canvas
    (`src/renderer/canvas/Canvas.tsx:421`); ⌘ при перетаскивании — без snapping (`Canvas.tsx:366`,
    `:377`, параметр `free` у `planFor`, `:307`); режим фокуса глушит ⌘= / ⌘− / ⌘0
    (`src/renderer/focus/FocusMode.tsx:227`); React Flow — `zoomActivationKeyCode="Meta"`
    (`Canvas.tsx:508`); Delete и Backspace без ⌘ удаляют выделение (`SelectionToolbar.tsx:57`).
  - Эти обработчики отвергают Ctrl: `CommandPalette.tsx:324`, `CanvasFind.tsx:462`,
    `FocusEntry.tsx:40`, `Canvas.tsx:421`. `SelectionToolbar.tsx:48` выходит при любом `ctrlKey` —
    на Windows Ctrl+Z до истории Canvas не дойдёт, даже если заменить только `metaKey`.
  - Правка не нужна: проверки «без модификаторов» уже отвергают и ⌘, и Ctrl — `Canvas.tsx:439`,
    `src/renderer/session/MessageInput.tsx:238`, `:248`, `src/renderer/session/SlashMenu.tsx:78`.
    `src/renderer/canvas/wheel-router.ts:72` отдаёт Canvas колесо и с Ctrl, и с ⌘: на Windows
    Ctrl+колесо уже масштабирует Canvas.
- **Подписи с ⌘ и ⇧:** `⌘K` (`CommandPalette.tsx:348`); `⌘↩` и `aria-keyshortcuts="Meta+Enter"`
  (`FocusEntry.tsx:65-66`); «Only the Nodes selected at the last ⌘F» (`CanvasFind.tsx:423`);
  «⇧⏎ new line» (`MessageInput.tsx:337`).
- **Terminal.** В Terminal Node (xterm) Ctrl+K, Ctrl+F и Ctrl+C — клавиши оболочки. Обработчики
  палитры и поиска слушают `window` и на xterm не смотрят (`CommandPalette.tsx:322-327`,
  `CanvasFind.tsx:460-465`): на Windows Ctrl+K в Terminal откроет палитру.
- e2e жмут `Meta+…` (51 вхождение в 12 файлах `test/e2e` по брифу фактов) — это Ticket 14.

## Что делаем

1. **Система в renderer.** Модуль `src/renderer/platform.ts` (новый):
   - `isMac` — по `navigator.userAgent`, без нового канала IPC и без правки preload (ADR-0006);
   - `isPrimary(event)` — ⌘ без Ctrl на Mac, Ctrl без ⌘ на Windows; `isOtherModifier(event)` —
     Ctrl на Mac, ⌘ на Windows;
   - подписи: `⌘K` / `Ctrl+K`, `⌘↩` / `Ctrl+Enter`, `⇧⏎` / `Shift+Enter`, `⌘F` / `Ctrl+F`;
     `aria-keyshortcuts` `Meta+Enter` / `Control+Enter`;
   - система передаётся параметром — для test-ов.

   `src/renderer/main.tsx` ставит `data-platform` на `<html>` до первого рендера.
2. **Сочетания.** Обработчики из «Что происходит» берут `isPrimary`. На Windows работают Ctrl+K,
   Ctrl+F, Ctrl+Enter, Ctrl+Z и Ctrl+Shift+Z, Ctrl+= и Ctrl+-, Ctrl при перетаскивании (без
   snapping); режим фокуса глушит Ctrl+= / Ctrl+- / Ctrl+0. `SelectionToolbar.tsx:48` отвергает
   `isOtherModifier`, а не всегда `ctrlKey`. `zoomActivationKeyCode` — `Meta` на Mac, `Control` на
   Windows. Подписи — из `platform.ts`. На Mac поведение и подписи прежние.
3. **Terminal.** Цель события внутри Terminal Node (`.xterm`) — на Windows Ctrl+K и Ctrl+F уходят в
   оболочку, палитра и поиск не открываются. На Mac ⌘K и ⌘F из Terminal работают, как сейчас.
4. **Меню на Windows.** На ПК проверить, отнимают ли ускорители меню у страницы Ctrl+Z, Ctrl+= и
   Ctrl+-, а у Terminal — Ctrl+C. Если отнимают — у этих пунктов на Windows
   `registerAccelerator: false`; подпись сочетания в меню остаётся. Тогда же проверить, что Ctrl+C
   и Ctrl+V в поле Session копируют и вставляют. `appMenu` уже только на Mac (`menu.ts:13`).
5. **Окно на Windows.** Опции окна собирает чистая функция от системы.
   - Windows — обычная рамка Windows с меню. Без `titleBarStyle`, `trafficLightPosition`, `vibrancy`
     и `visualEffectState`. `backgroundColor` непрозрачный: `--bg` светлой или тёмной темы по
     `nativeTheme.shouldUseDarkColors` (`#f7f7f9` и `#121110`, `tokens.css:36`, `:83`).
   - Mac — прежние значения (`window.ts:77-81`).
   - CSS по `html[data-platform]`, правила — в `shell.css` и `focus.css`; `tokens.css` не меняется.
     На Windows фон `body` — `--bg`, sidebar — непрозрачный `--sidebar` (`tokens.css:39`, `:86`),
     отступов 80 px под traffic lights нет. Полоса `.w-sidebar__titlebar` остаётся: она выравнивает
     sidebar с toolbar.

   Решено в Ticket-е, подтвердить у владельца: обычная рамка Windows, а не своя полоса заголовка
   (`titleBarOverlay`) — меню видно, кнопки окна системные. Снимки окна — в Итог.
6. **Уведомления.** На Windows до `installNotifications` и первого окна (`index.ts:87-90`) —
   `app.setAppUserModelId`: в упакованной сборке `dev.worfy.app` (то же значение, что `appId` в
   `electron-builder.yml:3`, test их сверяет), в dev — `process.execPath` (документация Electron).
   Шапка `notify.ts:1-18` («macOS notifications») говорит про обе системы.

**Не входит:** `Meta` в e2e-test-ах (Ticket 14); уведомление из установленного worfy — ярлык с
AppUserModelId в меню Пуск создаёт установщик Ticket-а 12; оболочка Terminal (Ticket 10).

## Готово, когда

- [x] Unit `test/unit/platform-keys.test.ts` (новый): `isPrimary` на Mac — `metaKey` без `ctrlKey`,
  на Windows — `ctrlKey` без `metaKey`; подписи `⌘K` / `Ctrl+K`, `⌘↩` / `Ctrl+Enter`, `⇧⏎` /
  `Shift+Enter`; `aria-keyshortcuts` `Meta+Enter` / `Control+Enter`.
- [x] Unit (jsdom), система `win32`: Ctrl+K открывает палитру (`CommandPalette`); Ctrl+K с целью
  внутри `.xterm` палитру не открывает; Ctrl+F открывает поиск (`CanvasFind`); Ctrl+Z и
  Ctrl+Shift+Z на Canvas зовут `undo` и `redo` истории (`SelectionToolbar`). Система `darwin`: те же
  сочетания с ⌘ работают, Ctrl+K палитру не открывает.
- [x] Unit `test/unit/window-options.test.ts` (новый): опции окна для `win32` — без `titleBarStyle`,
  `trafficLightPosition`, `vibrancy`, `visualEffectState`, с непрозрачным `backgroundColor`; для
  `darwin` — значения `window.ts:77-81`.
- [x] Contract `test/contract/app-user-model-id.test.ts` (новый) по образцу
  `test/contract/startup-failure.test.ts` (mock `electron`, импорт `src/main/index.ts`): на `win32`
  `app.setAppUserModelId` вызван до первого `BrowserWindow`, в упакованной сборке — со значением
  `appId` из `electron-builder.yml`; на `darwin` не вызван.
- [ ] `test/contract/view-menu.test.ts`: на `win32` в шаблоне нет `appMenu`; если пункт 4 ввёл
  `registerAccelerator: false` — у этих пунктов на `win32` он есть, на `darwin` нет.
- [x] Windows-ПК: `pnpm test test/unit/platform-keys.test.ts test/unit/window-options.test.ts test/contract/app-user-model-id.test.ts test/contract/view-menu.test.ts`
  — exit 0.
- [x] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены по именам (не со списком
  Ticket-а 02 — main с тех пор ушёл далеко): первый прогон — с полным прогоном main `558dd67` на
  том же ПК, прогоны после перебазирований — с предыдущим прогоном ветки и с отдельными
  прогонами упавших файлов на main. Падений от правок этого PR нет. Новые по именам есть в каждом
  прогоне — это test-ы, которые падают и на main, и timeout-ы под нагрузкой; список и числа — в
  «Итог».
- [ ] (вручную) Windows-ПК, `pnpm dev`: окно двигается за заголовок, разворачивается и закрывается
  кнопками Windows; sidebar и Canvas непрозрачные; слева в toolbar нет пустого места под traffic
  lights; меню File, Edit, View, Window открываются, View ▸ Show Minimap переключает мини-карту.
  Снимки в светлой и тёмной теме — `../evidence/11-окно-windows.png` и
  `../evidence/11-окно-windows-тёмная.png`. Как проверить: окно worfy.
- [ ] (вручную) Windows-ПК, `pnpm dev`: Ctrl+K, Ctrl+F, Ctrl+Enter работают; Ctrl+Z и Ctrl+Shift+Z
  отменяют и возвращают перетаскивание Node-а; Ctrl+= и Ctrl+- масштабируют Canvas, а не страницу;
  Ctrl+C и Ctrl+V в поле Session копируют и вставляют. При русской раскладке Ctrl+K, Ctrl+F и
  Ctrl+Z работают так же. Как проверить: окно worfy. Проверки внутри Terminal Node — Ctrl+C
  прерывает `ping -t localhost`, Ctrl+K палитру не открывает, Ctrl+_ (Ctrl+Shift+−) остаётся у
  оболочки и на Canvas, и в плитке режима фокуса, Canvas при этом не масштабируется — переходят
  в Ticket 10: пока он не влит, Terminal на Windows не работает, и эти три вещи проверены только
  test-ами (unit этого PR и прогон ревьюера на Mac с настоящим xterm).
- [x] (вручную) Windows-ПК, `pnpm dev`, `electron.exe` закреплён в меню Пуск (документация
  Electron): окно worfy не в фокусе, Session закончила ход — приходит уведомление, клик по нему
  открывает Session. Как проверить: уведомление Windows и окно worfy.
- [ ] Mac: e2e с `Meta+…` (`test/e2e/palette-find.spec.ts`, `test/e2e/focus.spec.ts`,
  `test/e2e/epic-frame-undo.spec.ts` и остальные) зелёные без правок; gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

## Тесты

Сначала падающий test — unit палитры на `win32`: Ctrl+K сейчас палитру не открывает
(`CommandPalette.tsx:324`). Затем unit `isPrimary` и опций окна.

Система передаётся параметром, поэтому ветка Windows проверяется на Mac и в Linux CI. jsdom не
рисует окно и не знает ускорителей меню: рамку, меню и уведомления на Windows проверяют ручные
пункты на ПК. В «Итог» — как test-ы падали до правки и ввёл ли пункт 4 `registerAccelerator: false`.

## Где в коде

- `src/main/window.ts`
- `src/main/menu.ts`
- `src/main/index.ts`
- `src/main/notify.ts`
- `src/renderer/platform.ts` (новый)
- `src/renderer/main.tsx`
- `src/renderer/shell/shell.css`
- `src/renderer/focus/focus.css`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/overlays/FocusEntry.tsx`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/focus/FocusMode.tsx`
- `src/renderer/find/CanvasFind.tsx`
- `src/renderer/palette/CommandPalette.tsx`
- `src/renderer/session/MessageInput.tsx`
- `test/unit/platform-keys.test.ts` (новый)
- `test/unit/window-options.test.ts` (новый)
- `test/contract/app-user-model-id.test.ts` (новый)
- `test/contract/view-menu.test.ts`

## Итог

Заполняет Session на Windows-ПК. Ручная проверка владельца проведена; что ещё открыто — в «Осталось».

- **Что сделано.**
  - `src/renderer/platform.ts`: `platformOf` по user agent, `currentPlatform` (читает `data-platform`
    у `<html>`, иначе user agent), `markPlatform` (его зовёт `main.tsx` до первого рендера),
    `isMac`, `isPrimary`, `isOtherModifier`, `isTerminalKey`, подписи `label` и `ariaKeyShortcuts`
    над одной записью `KeyCombo` (`primary`, `shift`, `alt`, `key`). Модуль не берёт типов DOM —
    его test идёт в Node. Системы три: `mac`, `windows`, `linux`; всё, что не macOS, — Ctrl.
  - Обработчики на `isPrimary`: палитра, поиск, режим фокуса (вход и глушение масштаба), история
    Canvas, масштаб Canvas, перетаскивание без snapping. `SelectionToolbar` отвергает
    `isOtherModifier`, а не любой `ctrlKey`. `zoomActivationKeyCode` — `Meta` / `Control`.
  - Terminal: на Windows Ctrl+K и Ctrl+F с целью внутри `.xterm` палитру и поиск не открывают.
  - Подписи из `label`: `⌘K`, `⌘↩` и `aria-keyshortcuts`, «last ⌘F», «(⇧Enter)», подсказки поля
    ввода `⇧⏎ new line` и `⏎ select` (`src/renderer/session/hints.ts`). Два последних места
    Orchestrator попросил добавить сверх списка Ticket-а.
  - Окно: `src/main/window-frame.ts`, `frameOptions(platform, dark)` — значения macOS прежние; вне
    macOS обычная рамка системы и непрозрачный `backgroundColor` (`--bg` темы, test сверяет с
    `tokens.css`). CSS по `html[data-platform]` в `shell.css` и `focus.css`.
  - Уведомления: `src/main/app-id.ts`, `appUserModelId(platform, packaged, execPath)`; `index.ts`
    зовёт `app.setAppUserModelId` в начале `start()`, до `whenReady`.
  - `test/setup-dom.ts` ставит jsdom-test-ам `data-platform="mac"`: user agent jsdom не называет
    ни macOS, ни Windows, и без этого любой jsdom-test шёл бы как Linux на любой машине.
- **Как test-ы падали до правки.** Первым написан test палитры на Windows: `expected '⌘K' to be
  'Ctrl+K'`, палитра по Ctrl+K не открывалась. На неизменённом коде падали все случаи Windows:
  палитра, подписи, перетаскивание с Ctrl (`move` в (16, 24) вместо (13, 21)), Ctrl+Z, Ctrl+F,
  Ctrl+=, Ctrl+Enter (`expected '⌘↩' to be 'Ctrl+Enter'`). Случаи macOS с ⌘ (перетаскивание,
  масштаб, фокус) на старом коде проходили.
- **Отступления от текста Ticket-а.**
  - Чистая функция окна — в новом `src/main/window-frame.ts`, а не в `window.ts`: так её test не
    подменяет `electron`.
  - Test входа renderer — отдельный файл `test/unit/platform-entry.test.tsx`; test-ы сочетаний —
    `test/unit/platform-shortcuts.test.tsx` (палитра, подписи) и новый блок в
    `test/unit/canvas.test.tsx` (поиск, история, масштаб, фокус, перетаскивание — на настоящем
    Canvas, с подменённым `offsetParent`).
  - `test/contract/app-user-model-id.test.ts` запускает `start()` из `index.ts` с подменённым
    `process.platform`; окно, уведомления и link-сервис заменены, как в `main-ipc-wiring.test.ts`.
  - `nativeTheme` и `app.setAppUserModelId` добавлены в подмены `electron` у
    `startup-failure.test.ts` и `main-ipc-wiring.test.ts`.
- **Первый круг ревью PR #215.**
  - **Буквенные сочетания при нелатинской раскладке.** Палитра, поиск и история сверяли
    `event.key` (`k`, `f`, `z`); при русской раскладке на Windows клавиша K даёт `key: 'л'`,
    `code: 'KeyK'`, и Ctrl+K, Ctrl+F, Ctrl+Z не работали. Теперь `shortcutKey(event)` в
    `platform.ts`: латинская буква берётся с клавиши (`key`), а при нелатинской раскладке — по
    месту клавиши (`code`, `KeyK`). Не «всегда по `code`», как предлагал ревьюер: на QWERTZ клавиша
    с буквой Y стоит на месте Z, и Ctrl+Y (в других программах — возврат) стал бы отменой.
  - **AltGr.** `isPrimary` вне macOS не считает основным модификатором нажатие с состоянием
    `AltGraph`: AltGr на Windows приходит как Ctrl+Alt и набирает символ. Ctrl+Alt двумя клавишами
    остаётся основным — на нём масштаб интерфейса worfy-ui (Ctrl+Alt+=).
  - **Ctrl+_ в Terminal на Windows** — отмена в оболочке (readline). Режим фокуса и масштаб Canvas
    это нажатие из Terminal больше не забирают (`FocusMode.tsx`, `Canvas.tsx`).
  - `test/contract/main-ipc-wiring.test.ts` ждёт старт с явным пределом 10 с вместо 1 с по
    умолчанию: на Mac файл падал 6 раз из 40, на ПК, запущенный отдельно, — всегда.
  - Test-ы на выживших мутантов ревьюера: Alt и Shift в поиске, входе в фокус, истории и масштабе;
    направляющие во время перетаскивания; опции, которые `createMainWindow` передаёт в
    `BrowserWindow`; подписи в полосе поиска, под полем ввода и в slash-меню на месте вызова;
    `zoomActivationKeyCode` (колесо с зажатой клавишей масштабирует или двигает Canvas).
  - Комментарий `test/setup-dom.ts` исправлен: user agent jsdom не называет ни macOS, ни Windows,
    и без этой настройки любой jsdom-test шёл бы как Linux на любой машине.
- **Второй круг ревью PR #215.**
  - `shortcutKey` сужен: по месту клавиши читается только одиночная буква нелатинского письма
    (`\p{L}` и не `\p{Script=Latin}`), и не во время набора через метод ввода (`isComposing`).
    Раньше по месту читалось всё, что не a–z: `Process`, `Dead`, `Unidentified`, знаки и буквы с
    диакритикой латинских раскладок — на Dvorak Ctrl+; (там `;` на месте Z) отменял бы, на BÉPO —
    Ctrl+à.
  - Test-ы исключения Ctrl+_ в Terminal: под режимом фокуса масштаб Canvas не меняется, остальные
    клавиши масштаба из плитки Terminal глушатся; вне режима фокуса клавиши масштаба внутри
    Terminal Node масштабируют Canvas в обе стороны на обеих системах, кроме Ctrl+_ на Windows.
  - `main-ipc-wiring.test.ts`: у `beforeAll` свой предел 20 с — выше ожидания старта (10 с);
    предел hook-а по умолчанию (10 с) обрезал бы это ожидание.
- **Мутанты:** первый набор — 34 из 34 валят test-ы (`platform.ts` — 11, обработчики и подписи — 17,
  окно — 2, AppUserModelId — 4); один выжил в первом прогоне (Backspace с «другим» модификатором
  удалял бы выделение) — добавлен test. После первого круга ревью — ещё 24 из 24: выжившие у
  ревьюера и код этого круга (`shortcutKey`, Ctrl+_ в Terminal). После второго круга — ещё 10 из 10 (сужение `shortcutKey`, исключение Ctrl+_ в обе стороны). После третьего — 4 из 4: три выживших у ревьюера и перенос `+` в уменьшение.
- **Windows-ПК** (Session Claude Code; Gate не запускался — он на bash, Ticket 03). Ветка трижды
  меняла базу, поэтому база названа у каждой строки:
  - ветка на main `e21ce65`, после второго круга: `pnpm install --frozen-lockfile` — 0,
    `pnpm typecheck` — 0, `pnpm lint` — 0 (на базе `baf7a14` `pnpm lint` был 1 при `eslint .` 0:
    `check-handoff` считал байты рабочей копии с CRLF; на main это исправил PR #219);
  - ветка на main `558dd67`, до ревью: `pnpm build` — 0; после не повторялся;
  - ветка на main `558dd67`, до ревью: `pnpm test test/unit/platform-keys.test.ts
    test/unit/window-options.test.ts test/contract/app-user-model-id.test.ts
    test/contract/view-menu.test.ts` — exit 0. В полном прогоне на `e21ce65` эти четыре файла
    тоже проходят;
  - ветка на main `558dd67`, до ревью: `pnpm test` — exit 1, как main `558dd67` (его полный
    прогон сделан перед этим): по именам 3 новых — timeout в `check-handoff` и два случая
    `startup-failure`, которые падают и на main `0f4bf19`;
  - ветка на main `baf7a14`, после первого круга: `pnpm test` — exit 1: 51 failed | 137 passed
    файлов, 625 failed | 3110 passed | 29
    skipped. Main `baf7a14` целиком на ПК не прогонялся; сверка по именам — с прогоном head-а
    PR #209 (`02e6f27`, это main до двух следующих PR). Новых по именам 37:
    - 35 — в `first-run-checks.test.ts` и `harness-install.test.ts`: их test-ы пришли в main с PR
      #216 (worfy-harness/30). На main `baf7a14` эти два файла, запущенные отдельно, дают те же 55
      падений, что и на ветке, имя в имя;
    - `link-server` «1009» — известное падение (Итог Ticket-а 08);
    - `canvas.test.tsx` › `collectNodeTypes`… — timeout 5000 мс у первого test-а файла (он платит
      за загрузку реестра Node-ов). На main `baf7a14` файл, запущенный отдельно, падает на том же
      test-е 2 раза из 2, на ветке — 3 из 3; остальные 37 случаев файла на ветке проходят.
  - ветка на main `e21ce65`, после второго круга: `pnpm test` — exit 1: 52 failed | 136 passed
    файлов, 630 failed | 3116 passed | 29 skipped. Против предыдущего прогона ветки по именам — 5
    новых, от PR ни одного: 4 — test-ы, пришедшие в main после `baf7a14` (`harness-evals` ×3,
    `harness-scripts` › `epic-wave-ship-ticket.test.sh`), на main `e21ce65` отдельно они падают так
    же; пятый — timeout 5000 мс в `check-handoff` под нагрузкой, отдельно файл проходит (13 из 13).
- **Пункт «Готово, когда» про падения `pnpm test`** переписан под то, что было сделано, теми же
  словами: первый прогон сверен с полным прогоном main `558dd67`, прогоны после перебазирований —
  с предыдущим прогоном ветки и с отдельными прогонами упавших файлов на main; со списком
  Ticket-а 02 не сверялось. Новых по именам: 3, затем 37, затем 5 (выше), от PR — ни одного.
- **Третий круг ревью PR #215** — только test-ы и текст: нажатие Ctrl+_ в плитке Terminal режима
  фокуса доходит до самого терминала (а остальные клавиши масштаба — нет); `+` увеличивает
  масштаб Canvas; латинская буква при `isComposing` остаётся буквой клавиши, и Ctrl+K открывает
  палитру, как на main.
- **Ручная проверка владельца на ПК, 2026-10-10** (`pnpm dev`, head `0ba7b21`; ответы владельца —
  «да» / «нет» по списку, сам я окна не видел).
  - Settings: Ctrl+`,` открывает окно, Esc закрывает, Tab и Shift+Tab ходят внутри — **прошло**.
  - Ctrl+K открывает палитру, Ctrl+F — поиск по Canvas — **прошло**.
  - Ctrl+= и Ctrl+- масштабируют Canvas — **прошло**. Отдельно спрошено про Ctrl+-: уменьшается
    только Canvas, не вся страница.
  - Ctrl+Z и Ctrl+Shift+Z после перетаскивания — **с первой попытки «нет», со второй «всё
    работает»**. Вторая попытка — по шагам: Note перетащен за заголовок, Ctrl+Z нажат сразу. Чем
    отличалась первая (какой Node, за что взят, где был фокус), **не установлено**. Перед второй
    попыткой я на время вставил в рабочую копию отладочный слушатель клавиш — страница dev-сборки
    из-за этого перезагрузилась, код обработчиков он не менял; слушатель удалён, в коммиты не попал.
    Между попытками я прогнал на собранном приложении пробу (Playwright `_electron`, нажатия через
    CDP, spec удалён): Note за заголовок, фокус на обёртке Node, Control+z возвращает (304, 124) →
    (120, 100), Control+Shift+z — обратно; с фокусом в тексте Note Ctrl+Z остаётся у текста.
  - Русская раскладка: Ctrl+K, Ctrl+F, Ctrl+Z — **прошло**.
  - Окно: двигается за заголовок, кнопки Windows работают, sidebar и Canvas непрозрачные, пустого
    места слева в toolbar нет, меню открываются, Show Minimap переключает — **прошло**. Снимков в
    двух темах пока нет.
  - Ctrl+Enter: на Note режим фокуса не открылся, на остальных Node открывается. Если фокус был в
    тексте Note, это прежнее поведение (`FocusEntry` оставляет сочетание полю ввода;
    `test/e2e/focus.spec.ts` — «⌘↩ typed in a text field stays with the field»); с щелчком по
    заголовку Note владелец не перепроверял.
  - Ctrl+C и Ctrl+V в поле Session — ответа пока нет.
  - Уведомление при закреплённом `electron.exe` — **прошло** («работает»); под каким именем оно
    пришло, не уточнено.
  - AltGr — владелец не проверял.
- **Пункт 4 (ускорители меню) закрыт без правки:** `registerAccelerator: false` не введён,
  `menu.ts` этим PR не изменён (его test «on Windows is the first item of File…» из PR #209 уже
  проверяет, что на `win32` нет пунктов `appMenu`). По ручной проверке Ctrl+- уменьшает только
  Canvas, а Ctrl+Z отменяет перетаскивание — ускорители меню `zoomOut` и `undo` эти нажатия у
  страницы не отнимают. Ctrl+C в Terminal — в Ticket-е 10.
- **Осталось:** снимки окна в светлой и тёмной теме (`../evidence/11-окно-windows.png`,
  `../evidence/11-окно-windows-тёмная.png`) и ответ про Ctrl+C / Ctrl+V в поле Session.
- **Не проверено вживую.**
  - Выставляет ли Chromium на Windows `AltGraph` для AltGr (на ПК нет раскладки с AltGr). От
    AltGr защищают две проверки: `getModifierState('AltGraph')` в `isPrimary` и `altKey`, который
    отвергают сами обработчики палитры, поиска, фокуса, истории и масштаба (AltGr приходит с
    `altKey`). Третья линия — символ в `event.key`: `ą` и `€` (польская, немецкая) `shortcutKey`
    оставляет как есть, и сочетание не совпадает; по месту клавиши он прочитал бы только
    одиночную букву нелатинского письма, а через AltGr такие буквы почти нигде не набираются.
  - Что при русской раскладке Chromium на Windows отдаёт `code: 'KeyK'` для Ctrl+K — войдёт в
    ручную проверку сочетаний.
- **Долги** (первый круг ревью, low).
  - Непрозрачный фон окна на Windows и Linux выбирается один раз, по
    `nativeTheme.shouldUseDarkColors` при создании окна; при смене темы ОС он не обновляется
    (`nativeTheme.on('updated')` нет). Виден только до первой отрисовки страницы.
  - macOS, ⌘ и ⌃ вместе: `isPrimary` на Mac — `metaKey && !ctrlKey`, а main в перетаскивании и в
    режиме фокуса смотрел только `metaKey`. Перетаскивание с ⌘⌃ теперь привязывается, режим фокуса
    не глушит ⌘⌃= и ⌘⌃−. На практике не наблюдается.
  - Правило CSS непрозрачной боковой панели (`shell.css`) проверяется только глазами или e2e: jsdom
    стили не применяет.
  - Раскладки, где на месте буквы стоит не буква: Devanagari InScript держит на KeyF знак `ि`
    (категория Mc, не L), и Ctrl+F на Windows и Linux поиск не открывает; то же — знаки на
    Shift+Z в некоторых нелатинских раскладках (третий круг ревью).
  - macOS: ⌘ с нелатинской буквой срабатывает как сочетание только со сторонней раскладкой без
    латинской карты для ⌘; с раскладками Apple ⌘ всегда отдаёт латинскую букву, и до чтения по
    месту клавиши дело не доходит (третий круг ревью).
- **Известные падения на Windows, не от этого PR** (для Ticket-а 14, gate full на Windows):
  - `test/contract/main-ipc-wiring.test.ts`: до этого PR, запущенный отдельно, падал на уровне
    файла (предел 1 с в `beforeAll`); с явным пределом выполняется, и 5 случаев из 11 падают, как
    в полном прогоне (сравнение `file://`-адреса с путём macOS);
  - `pnpm lint` и CRLF в `HANDOFF.md` — исправлено на main PR-ом #219 (`3478cc4`);
  - `test/contract/first-run-checks.test.ts` и `test/contract/harness-install.test.ts` — 55 падений
    на main `baf7a14` (test-ы пришли с PR #216); на ветке те же, имя в имя. Причина не разбиралась;
  - `test/unit/canvas.test.tsx` › `collectNodeTypes maps each kind to its component…` — timeout
    5000 мс первого test-а файла; на main `baf7a14` файл, запущенный отдельно, падает на нём 2 из 2;
  - `test/contract/link-server.test.ts` «1009» — описан в Итоге Ticket-а 08;
  - `test/contract/startup-failure.test.ts` — 11–12 падений из 35, набор меняется от прогона к
    прогону (зависит от скорости ПК).
