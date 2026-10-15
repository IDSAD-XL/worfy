# 11 — Реестр сочетаний клавиш и окно Keyboard shortcuts

Type: task
Status: blocked — ждёт gate full на Windows-ПК (ADR-0056, пункт 2): PR #328 VERIFIED по Mac, Windows-ПК выключен
Blocked by: 02, 03, 07, 10
Source: решения владельца 2026-10-09: 6 (Ctrl на Windows — в Ticket-е 11 worfy-windows, здесь не повторяется), 7 (центральный реестр сочетаний — один источник для подписей обработчиков и для окна; окно с подписями своей системы открывают Cmd/Ctrl+/, «?» вне текстового поля, пункт палитры «Keyboard shortcuts» и Settings → Shortcuts; Ticket реестра ждёт worfy-windows 11), 8 (Cmd/Ctrl+B — везде) ([spec.md](../spec.md), «Как устроено», «Сочетания клавиш»; «Пересечения», worfy-windows 11 и worfy-terminal-ai 06; риски 5 и 8); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенный PR); [worfy-windows 11](../../worfy-windows/issues/11-окно-меню-уведомления-и-ctrl-на-windows.md); [worfy-terminal-ai 06](../../worfy-terminal-ai/issues/06-command-request.md) (⌘I в Terminal-е)

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
- Проверки «без модификаторов» тоже читают `metaKey`, но не задают сочетание: `MessageInput.tsx:261`,
  `:271`, `SlashMenu.tsx:78`, `src/renderer/canvas/sources/epics.ts:131`; колесо с ⌘ или Ctrl
  масштабирует Canvas — `src/renderer/canvas/wheel-router.ts:72`.
- «Не в текстовом поле» определяют три копии: `isTextTarget` (`SelectionToolbar.tsx:38`), `isEditable`
  (`FocusEntry.tsx:17`, `:41`) и строка в `epics.ts:134-135`.
- Окна или списка сочетаний нет. Меню Help в worfy нет: `menuTemplate` — меню приложения (на Mac),
  File, Edit, View и Window (`src/main/menu.ts:11-34`).
- Ticket 11 worfy-windows влит 2026-10-10 (PR #215, `78fc03e`): `src/renderer/platform.ts` даёт
  `isMac`, `isPrimary`, `isOtherModifier`, `isTerminalKey`, `label`, `ariaKeyShortcuts` и
  `shortcutKey`; обработчики выше перешли на `isPrimary` (номера строк ниже сверить при claim);
  в Terminal Node на Windows Ctrl+K и Ctrl+F уходят в оболочку (его «Что делаем», пункты 1–3).
  Подписей «(⇧Enter)» и «⏎ select» в его списке нет — их переводит этот Ticket.
- После Ticket-ов 02, 03 и 10 этого Epic-а — ускорители меню (`src/main/menu.ts`): «Settings…»
  `CmdOrCtrl+,`; «Bigger», «Smaller», «Actual size» — `CmdOrCtrl+Alt+=`, `-`, `0`; «Toggle Sidebar»
  `CmdOrCtrl+B`; кнопки «Hide sidebar» в toolbar и полосе режима фокуса; helper e2e `clickMenuItem`
  (`test/e2e/menu.ts`). После Ticket-а 07 палитра рисует группы — `CommandPalette.tsx` общий, поэтому
  07 — блокер.
- Ticket 06 worfy-terminal-ai (открыт) вводит ⌘I — панель Command request — только в Terminal-е с
  интеграцией zsh и только на Mac: Ctrl+I в терминале — Tab, он остаётся у оболочки, Ctrl-ветки
  нет. Клавишу ловит `attachCustomKeyEventHandler` в `src/renderer/canvas/nodes/TerminalNode.tsx`,
  панель — `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (его «Что делаем», пункты 2–3).

## Что делаем

1. **Реестр** — `src/shared/shortcuts.ts` (новый): один список для обработчиков, подписей, меню и
   окна. У записи — id; клавиши без системы (`primary` — ⌘ на Mac и Ctrl на Windows, `shift`, `alt`,
   клавиша) или клавиши только одной системы; название действия — английское, как в UI; группа
   (Window, Canvas, Focus mode, Find, Session, Terminal); где действует. Main берёт оттуда ускорители
   меню, renderer — проверку события и подпись.
2. **Проверка и подпись** — `src/renderer/shortcuts/match.ts` (новый):
   - `matches(event, shortcut)` — через `isPrimary` и `isOtherModifier` из `src/renderer/platform.ts`
     (файл только читается);
   - `label(shortcut)` — подпись своей системы: «⌘K» / «Ctrl+K», «⇧⏎» / «Shift+Enter»;
   - правило Terminal Node из worfy-windows 11 — здесь, одно на все сочетания;
   - общий `isTextTarget` вместо копий в `SelectionToolbar.tsx` и `FocusEntry.tsx`; строка в
     `epics.ts` — не сочетание, она остаётся.
3. **Перевод на реестр.** Обработчики и подписи из «Что происходит» берут сочетание и подпись из
   реестра, в том числе «(⇧Enter)» и «⏎ select». Ускорители пунктов меню этого Epic-а — тоже из
   реестра. Поведение на Mac и Windows — как после worfy-windows 11. Проверки «без модификаторов» и
   колесо не меняются.
4. **Окно Keyboard shortcuts** — `src/renderer/shortcuts/ShortcutsOverlay.tsx` (новый) и
   `src/renderer/shortcuts/shortcuts.css` (новый): модальное, портал в `document.body` с `z-index`
   окна Settings, по группам; у строки — название и клавиши своей системы в `<kbd>`. Esc закрывает
   и дальше не идёт (`preventDefault`, `stopPropagation`): режим фокуса под окном остаётся.
   Открывают:
   - Cmd/Ctrl+/ — пункт «Keyboard Shortcuts» нового меню Help (роль `help`; на macOS у него
     системное поле поиска) с id для test-ов; клик шлёт `menu.command` со значением `shortcuts`
     (новое значение домена `src/shared/ipc/menu.ts`) окну из аргумента обработчика;
   - «?» вне текстового поля и вне Terminal Node;
   - пункт палитры «Keyboard shortcuts» (`src/renderer/palette/commands.ts`);
   - Settings → Shortcuts — `src/renderer/settings/ShortcutsSection.tsx` (новый, `order` 30,
     `title` «Shortcuts»): тот же список внутри окна Settings.

   Окно смонтировано в `src/renderer/shell/AppShell.tsx`.
5. **Ctrl+B и Ctrl+/ в Terminal на Windows** (spec, риск 5). Решение владельца 2026-10-09: внутри
   Terminal на Windows они остаются у оболочки; на Mac ⌘B и ⌘/ работают везде, в том числе в
   Terminal. Как это сделать — из «Итог» worfy-windows 11: отнимают ли ускорители меню клавиши у
   xterm. Отнимают — у этих пунктов на Windows `registerAccelerator: false`, а сочетание ловит
   renderer по реестру вне Terminal Node; не отнимают — правка не нужна, test это подтверждает.
6. **⌘I Ticket-а 06 worfy-terminal-ai.** Правило записано одинаково у обоих Ticket-ов и решается в
   момент мержа, а не claim: перед мержем Ticket перебазируется на свежий main; если другой Ticket
   уже в main, этот вносит ⌘I в реестр в том же PR. Кто вливается последним, тот и отвечает за
   запись. Запись — только для Mac (на Windows записи нет: Ctrl+I — Tab оболочки), область —
   Terminal Node с интеграцией zsh, группа Terminal; проверка в `TerminalNode.tsx` — через
   `matches`. Ticket 06 к мержу этого Ticket-а уже в main — этот Ticket правит `TerminalNode.tsx` и
   `TerminalAiRequest.tsx` (подпись ⌘I); нет — эти файлы не трогает, запись внесёт Ticket 06.

Решено в Ticket-е, подтверждено владельцем 2026-10-09: Cmd/Ctrl+/ — пункт нового меню Help ▸
«Keyboard Shortcuts»; группы окна — Window, Canvas, Focus mode, Find, Session, Terminal; внутри
Terminal на Windows Ctrl+B и Ctrl+/ — у оболочки, на Mac ⌘B и ⌘/ — везде (пункт 5).

**Не входит:** Ctrl вместо ⌘ на Windows (worfy-windows 11); смена сочетаний пользователем; e2e
с `Meta+…` (Ticket 14 worfy-windows); Ctrl+I на Windows (позже, вместе с Terminal AI для
PowerShell).

## Готово, когда

- [ ] Unit `test/unit/shortcuts.test.tsx` (новый, jsdom): id записей уникальны; у двух записей одной
  области нет одинаковых клавиш; `label` на Mac и Windows (система — параметр): «⌘K» / «Ctrl+K»,
  «⇧⏎» / «Shift+Enter», «⌥⌘=» / «Ctrl+Alt+=»; `matches` на Mac и Windows; запись с `primary` в
  Terminal Node на Windows не срабатывает; запись только для Mac на Windows не срабатывает и в окне
  не показывается.
- [ ] Unit `test/unit/shortcuts-overlay.test.tsx` (новый): «?» на Canvas открывает окно, «?» в
  `textarea` — нет; группы с заголовками; Esc закрывает окно и до `window` не доходит; Settings →
  Shortcuts показывает те же строки; пункт палитры «Keyboard shortcuts» открывает окно.
- [ ] Contract `test/contract/view-menu.test.ts`: меню Help есть, с ролью `help`; ускорители
  «Settings…», «Bigger», «Smaller», «Actual size», «Toggle Sidebar», «Keyboard Shortcuts» равны
  реестру; Help ▸ Keyboard Shortcuts с окном шлёт этому окну `menu.command` со значением `shortcuts`.
- [ ] e2e `test/e2e/shortcuts.spec.ts` (новый): «?» на Canvas открывает окно, Esc закрывает;
  `clickMenuItem` открывает; Settings → Shortcuts показывает список; ⌘K, ⌘F, ⌘↩ работают, как до
  перевода на реестр. Снимки `shortcuts` в светлой и тёмной теме.
- [ ] grep по файлам «Где в коде» этого Ticket-а: `metaKey` как модификатор сочетания (`event.metaKey
  &&`, `!event.metaKey ||` и подобное) — только в `src/renderer/shortcuts/` и
  `src/renderer/platform.ts`; проверки «без модификаторов» остаются. Подписи с ⌘, ⇧, ⏎, ⌥ в JSX
  этих файлов — только через `label` (комментарии не в счёт).
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
(`test/unit/platform-keys.test.ts`). Файлы unit-test-ов — `.test.tsx`: им нужен jsdom, а vitest
гоняет `.test.ts` в среде node (`vitest.config.ts`). В «Итог» — как падал первый test, решение по
пункту 5 и кто внёс ⌘I.

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
- `src/renderer/canvas/nodes/TerminalNode.tsx` (только если к мержу Ticket 06 worfy-terminal-ai уже в main)
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (создаёт Ticket 06 worfy-terminal-ai; правится, только если он к мержу уже в main)
- `test/unit/shortcuts.test.tsx` (новый)
- `test/unit/shortcuts-overlay.test.tsx` (новый)
- `test/contract/view-menu.test.ts`
- `test/e2e/shortcuts.spec.ts` (новый)

## Итог

Заполняется при закрытии.

Наблюдение до начала работы (Windows-ПК, 2026-10-14, [ответ в PR #297](https://github.com/IDSAD-XL/worfy/pull/297#issuecomment-6158507320)): в Terminal Node при русской раскладке `Ctrl+B` дал shell букву «и» (код клавиши `KeyB`), а не управляющий символ Ctrl+B. Панель при этом не переключилась, как и требует spec. При английской раскладке не проверено.
