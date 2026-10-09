# 11 — Реестр сочетаний клавиш и окно Keyboard shortcuts

Type: task
Status: blocked — ждёт мержа Ticket-а 11 Epic-а worfy-windows (Ctrl вместо ⌘ на Windows: `src/renderer/platform.ts` с `isPrimary`, `isOtherModifier` и подписями своей системы); оба Ticket-а правят одни и те же обработчики клавиш. После его мержа Orchestrator ставит этому Ticket-у `open`
Blocked by: 02, 03, 10
Source: решения владельца 2026-10-09: 6 (Ctrl на Windows — в Ticket-е 11 worfy-windows, здесь не повторяется), 7 (центральный реестр сочетаний — один источник для подписей обработчиков и для окна; окно с подписями своей системы открывают Cmd/Ctrl+/, «?» вне текстового поля, пункт палитры «Keyboard shortcuts» и Settings → Shortcuts; Ticket реестра ждёт worfy-windows 11) ([spec.md](../spec.md), «Как устроено», «Сочетания клавиш»; «Пересечения», worfy-windows 11 и PR #202; риски 5 и 8); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенный PR); [worfy-windows 11](../../worfy-windows/issues/11-окно-меню-уведомления-и-ctrl-на-windows.md)

## Что происходит

На main 2026-10-09; номера строк сверить при claim — их сдвинут worfy-windows 11 и Ticket-ы 03 и 10.

- Реестра сочетаний нет: каждый компонент вешает свой `keydown` на `window`, ⌘ зашит в проверку:
  - ⌘K — палитра (`src/renderer/palette/CommandPalette.tsx:324`);
  - ⌘F — поиск по Canvas (`src/renderer/find/CanvasFind.tsx:462`);
  - ⌘↩ — режим фокуса (`src/renderer/canvas/overlays/FocusEntry.tsx:40`);
  - ⌘Z и ⇧⌘Z — история Canvas; выход при любом `ctrlKey` (`src/renderer/canvas/overlays/SelectionToolbar.tsx:59-61`);
  - ⌘= и ⌘− — масштаб Canvas (`src/renderer/canvas/Canvas.tsx:436`); ⌘ при перетаскивании — без
    привязки к сетке (`:376`, `:387`); `zoomActivationKeyCode="Meta"` (`:523`);
  - режим фокуса глушит масштаб Canvas (`src/renderer/focus/FocusMode.tsx:227`).
- Подписи с глифами: «⌘K» (`CommandPalette.tsx:348`); «⌘↩» и `aria-keyshortcuts="Meta+Enter"`
  (`FocusEntry.tsx:65-66`); «last ⌘F» (`CanvasFind.tsx:423`); «(⇧Enter)» (`CanvasFind.tsx:430`);
  «⇧⏎ new line» (`src/renderer/session/MessageInput.tsx:361`); «⏎ select»
  (`src/renderer/session/SlashMenu.tsx:96`).
- Клавиши composer-а без модификатора: Enter — отправить, ⇧Enter — новая строка, Esc — прервать
  ход, ↑ и ↓ — история (`MessageInput.tsx:258-275`).
- «Не в текстовом поле» уже определяет `isTextTarget` — своя функция
  `SelectionToolbar.tsx:38`.
- Окна или списка сочетаний нет.
- Ticket 11 worfy-windows (открыт, ведёт Session на Windows-ПК): `src/renderer/platform.ts` —
  `isMac`, `isPrimary`, `isOtherModifier`, подписи ⌘/Ctrl; обработчики выше переходят на `isPrimary`;
  в Terminal Node на Windows Ctrl+K и Ctrl+F уходят в оболочку (его «Что делаем», пункты 1–3).
  Подписей «(⇧Enter)» и «⏎ select» в его списке нет; Session на Windows согласилась их добавить.
- После Ticket-ов 02, 03 и 10 этого Epic-а — ускорители меню (`src/main/menu.ts`): «Settings…»
  `CmdOrCtrl+,`; «Bigger», «Smaller», «Actual size» — `CmdOrCtrl+Alt+=`, `-`, `0`; «Toggle Sidebar»
  `CmdOrCtrl+B`; кнопки «Hide sidebar» в toolbar и полосе режима фокуса.
- Ticket 06 Epic-а `worfy-terminal-ai` (PR #202) вводит Cmd/Ctrl+I в Terminal Node через
  `platform.ts`.

## Что делаем

1. **Реестр** — `src/shared/shortcuts.ts` (новый): один список для обработчиков, подписей, меню и
   окна. У записи — id; клавиши без системы (`primary` — ⌘ на Mac и Ctrl на Windows, `shift`, `alt`,
   клавиша); название действия — английское, как в UI; группа (Window, Canvas, Focus mode, Find,
   Session); где действует. Main берёт оттуда ускорители меню, renderer — проверку события и
   подпись.
2. **Проверка и подпись** — `src/renderer/shortcuts/match.ts` (новый):
   - `matches(event, shortcut)` — через `isPrimary` и `isOtherModifier` из `src/renderer/platform.ts`
     (файл только читается);
   - `label(shortcut)` — подпись своей системы: «⌘K» / «Ctrl+K», «⇧⏎» / «Shift+Enter»;
   - правило Terminal Node из worfy-windows 11 — здесь, одно на все сочетания;
   - общий `isTextTarget` вместо своего в `SelectionToolbar.tsx`.
3. **Перевод на реестр.** Обработчики и подписи из «Что происходит» берут сочетание и подпись из
   реестра, в том числе «(⇧Enter)» и «⏎ select». Ускорители пунктов меню этого Epic-а — тоже из
   реестра. Поведение на Mac и Windows — как после worfy-windows 11.
4. **Окно Keyboard shortcuts** — `src/renderer/shortcuts/ShortcutsOverlay.tsx` (новый) и
   `src/renderer/shortcuts/shortcuts.css` (новый): модальное, по группам; у строки — название и
   клавиши своей системы в `<kbd>`. Esc закрывает. Открывают:
   - Cmd/Ctrl+/ — пункт меню Help ▸ «Keyboard Shortcuts» с id для test-ов; клик шлёт
     `menu.command` со значением `shortcuts` (новое значение домена `src/shared/ipc/menu.ts`);
   - «?» вне текстового поля и вне Terminal Node;
   - пункт палитры «Keyboard shortcuts» (`src/renderer/palette/commands.ts`);
   - Settings → Shortcuts — `src/renderer/settings/ShortcutsSection.tsx` (новый, `order` 30,
     `title` «Shortcuts»): тот же список внутри окна Settings.

   Окно смонтировано в `src/renderer/shell/AppShell.tsx`.
5. **Ctrl+B и Ctrl+/ в Terminal на Windows** (spec, риск 5): по «Итог» worfy-windows 11 — если
   ускорители меню отнимают клавиши у xterm, этим пунктам на Windows `registerAccelerator: false`, а
   сочетание ловит renderer по реестру вне Terminal Node.
6. **Cmd/Ctrl+I** Ticket-а 06 `worfy-terminal-ai`: влит к claim — вносится в реестр здесь; нет — его
   Ticket вносит сам.

Решено в Ticket-е, подтвердить у владельца: Cmd/Ctrl+/ — ускоритель пункта Help ▸ «Keyboard
Shortcuts»; группы окна — Window, Canvas, Focus mode, Find, Session.

**Не входит:** Ctrl вместо ⌘ на Windows (worfy-windows 11); смена сочетаний пользователем; e2e
с `Meta+…` (Ticket 14 worfy-windows).

## Готово, когда

- [ ] Unit `test/unit/shortcuts.test.ts` (новый): id записей уникальны; у двух записей одной
  области нет одинаковых клавиш; `label` на Mac и Windows (система — параметр): «⌘K» / «Ctrl+K»,
  «⇧⏎» / «Shift+Enter», «⌥⌘=» / «Ctrl+Alt+=»; `matches` на Mac и Windows; запись с `primary` в
  Terminal Node на Windows не срабатывает.
- [ ] Unit `test/unit/shortcuts-overlay.test.tsx` (новый): «?» на Canvas открывает окно, «?» в
  `textarea` — нет; группы с заголовками; Esc закрывает; Settings → Shortcuts показывает те же строки;
  пункт палитры «Keyboard shortcuts» открывает окно.
- [ ] Contract `test/contract/view-menu.test.ts`: ускорители «Settings…», «Bigger», «Smaller»,
  «Actual size», «Toggle Sidebar», «Keyboard Shortcuts» равны реестру; Help ▸ Keyboard Shortcuts шлёт
  `menu.command` со значением `shortcuts`.
- [ ] e2e `test/e2e/shortcuts.spec.ts` (новый): «?» на Canvas открывает окно, Esc закрывает; пункт
  меню по id открывает; Settings → Shortcuts показывает список; ⌘K, ⌘F, ⌘↩ работают, как до
  перевода на реестр. Снимки `shortcuts` в светлой и тёмной теме.
- [ ] grep: `metaKey` в `src/renderer` — только в `src/renderer/platform.ts` и
  `src/renderer/shortcuts/`; подписи с ⌘, ⇧, ⏎, ⌥ в JSX — только через `label` (комментарии не в
  счёт).
- [ ] Mac: e2e с `Meta+…` (`test/e2e/palette-find.spec.ts`, `test/e2e/focus.spec.ts` и остальные)
  зелёные без правок.
- [ ] (вручную) `pnpm dev`: ⌘/ открывает окно на Canvas, в Session и в режиме фокуса; подписи — с ⌘.
  Как проверить: окно worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.
- [ ] Windows-ПК: gate full — строка вердикта и код выхода в PR (платформенный PR: `src/main/menu.ts`,
  `src/renderer/platform.ts`).

## Тесты

Сначала падающий test — unit «`label` записи палитры на Windows — Ctrl+K»: реестра нет. Затем
перевод обработчиков: поведение держат существующие e2e и unit-test-ы worfy-windows 11
(`test/unit/platform-keys.test.ts`). В «Итог» — как падал первый test и решение по пункту 5.

## Где в коде

- `src/shared/shortcuts.ts` (новый)
- `src/renderer/shortcuts/match.ts` (новый)
- `src/renderer/shortcuts/ShortcutsOverlay.tsx` (новый)
- `src/renderer/shortcuts/shortcuts.css` (новый)
- `src/renderer/settings/ShortcutsSection.tsx` (новый)
- `src/shared/ipc/menu.ts`
- `src/main/menu.ts`
- `src/renderer/shell/AppShell.tsx`
- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/palette/CommandPalette.tsx`
- `src/renderer/palette/commands.ts`
- `src/renderer/find/CanvasFind.tsx`
- `src/renderer/canvas/overlays/FocusEntry.tsx`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/focus/FocusMode.tsx`
- `src/renderer/session/MessageInput.tsx`
- `src/renderer/session/SlashMenu.tsx`
- `test/unit/shortcuts.test.ts` (новый)
- `test/unit/shortcuts-overlay.test.tsx` (новый)
- `test/contract/view-menu.test.ts`
- `test/e2e/shortcuts.spec.ts` (новый)

## Итог

Заполняется при закрытии.
