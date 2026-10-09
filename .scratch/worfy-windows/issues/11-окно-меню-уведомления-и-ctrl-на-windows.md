# 11 — Окно, меню, уведомления и Ctrl вместо ⌘ на Windows

Type: task
Status: open
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

- [ ] Unit `test/unit/platform-keys.test.ts` (новый): `isPrimary` на Mac — `metaKey` без `ctrlKey`,
  на Windows — `ctrlKey` без `metaKey`; подписи `⌘K` / `Ctrl+K`, `⌘↩` / `Ctrl+Enter`, `⇧⏎` /
  `Shift+Enter`; `aria-keyshortcuts` `Meta+Enter` / `Control+Enter`.
- [ ] Unit (jsdom), система `win32`: Ctrl+K открывает палитру (`CommandPalette`); Ctrl+K с целью
  внутри `.xterm` палитру не открывает; Ctrl+F открывает поиск (`CanvasFind`); Ctrl+Z и
  Ctrl+Shift+Z на Canvas зовут `undo` и `redo` истории (`SelectionToolbar`). Система `darwin`: те же
  сочетания с ⌘ работают, Ctrl+K палитру не открывает.
- [ ] Unit `test/unit/window-options.test.ts` (новый): опции окна для `win32` — без `titleBarStyle`,
  `trafficLightPosition`, `vibrancy`, `visualEffectState`, с непрозрачным `backgroundColor`; для
  `darwin` — значения `window.ts:77-81`.
- [ ] Contract `test/contract/app-user-model-id.test.ts` (новый) по образцу
  `test/contract/startup-failure.test.ts` (mock `electron`, импорт `src/main/index.ts`): на `win32`
  `app.setAppUserModelId` вызван до первого `BrowserWindow`, в упакованной сборке — со значением
  `appId` из `electron-builder.yml`; на `darwin` не вызван.
- [ ] `test/contract/view-menu.test.ts`: на `win32` в шаблоне нет `appMenu`; если пункт 4 ввёл
  `registerAccelerator: false` — у этих пунктов на `win32` он есть, на `darwin` нет.
- [ ] Windows-ПК: `pnpm test test/unit/platform-keys.test.ts test/unit/window-options.test.ts test/contract/app-user-model-id.test.ts test/contract/view-menu.test.ts`
  — exit 0.
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода
  в отчёт. Пока Gate не на Node (Ticket 03) — `pnpm lint`, `pnpm typecheck`, `pnpm test` с кодами
  выхода и пометка «Gate не запускался». Падения `pnpm test` сверены со списком Ticket-а 02: новых
  нет.
- [ ] (вручную) Windows-ПК, `pnpm dev`: окно двигается за заголовок, разворачивается и закрывается
  кнопками Windows; sidebar и Canvas непрозрачные; слева в toolbar нет пустого места под traffic
  lights; меню File, Edit, View, Window открываются, View ▸ Show Minimap переключает мини-карту.
  Снимки в светлой и тёмной теме — `../evidence/11-окно-windows.png` и
  `../evidence/11-окно-windows-тёмная.png`. Как проверить: окно worfy.
- [ ] (вручную) Windows-ПК, `pnpm dev`: Ctrl+K, Ctrl+F, Ctrl+Enter работают; Ctrl+Z и Ctrl+Shift+Z
  отменяют и возвращают перетаскивание Node-а; Ctrl+= и Ctrl+- масштабируют Canvas, а не страницу;
  Ctrl+C и Ctrl+V в поле Session копируют и вставляют. Если Ticket 10 уже влит — в Terminal Node
  Ctrl+C прерывает `ping -t localhost`, а Ctrl+K палитру не открывает. Как проверить: окно worfy.
- [ ] (вручную) Windows-ПК, `pnpm dev`, `electron.exe` закреплён в меню Пуск (документация
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

Заполняется при закрытии.
