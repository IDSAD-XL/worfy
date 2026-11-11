# Инвентарь: overlay-, menu- и feedback-примитивы renderer-а

Дата: 2026-11-11. Код: `main` на `e66d9cf4f`. Метод: чтение кода, `grep`, `git log` (только чтение). Ничего не запускалось: ни pnpm, ни test-ы, ни приложение.
Пути — от корня репозитория. `file:line` — строка, где это видно. Команды всех подсчётов — в приложении в конце.
Поведение библиотек (Radix, Floating UI, cmdk, Sonner, Vaul) сверено с их исходниками на GitHub (ветки `main`/`master` на 2026-11-11); в `node_modules` этих библиотек нет. Что не сверено, помечено «не проверено».

## Сводка

| Вид | Реализаций | LOC | Мест вызова | a11y | Заменит библиотека |
|---|---|---|---|---|---|
| Dialog / modal / confirm | 19 модальных, общего компонента нет (один общий frame на 2 диалога); 4 inline `alertdialog`; 8 native-диалогов в main | 6 100 в 21 файле вместе с формами; оболочка ≈ 40–145 на диалог | 23 JSX | partial | да; 3 окна — только вместе с их guard-ом |
| Popover | 11 ad-hoc; общий только hook `useDismiss` (2 импорта) | ≈ 1 340 в 9 файлах + части 4 файлов | 9 JSX + 3 через overlay slot | partial | да (8 из 11); частично — 3 |
| Menu / menu button (вкл. «Modes») | 6: `ActionMenu` (общий, 2 места) + 5 ad-hoc | ≈ 1 140 | 7 | partial (full у 4 из 6) | да |
| Context menu | DOM: 5 ad-hoc; native context menu: 0; native menu bar: 1 | ≈ 380 | 5 (2 через slot) | partial | DOM — да; native — нет |
| Tooltip | своих 0, только native `title` | 0 | 335 `title=` в 105 `.tsx` + 46 `writeAction(` | partial | да, но это 335 мест |
| Hover card / preview | 1 (`HoverCard` комментария к цитате) | 47 + таймеры в `QuoteComments.tsx` | 1 | none | частично |
| Toast / notification | 1 общая система + 4 модуля-обёртки; 1 OS notification в main | 556 + 599 | 57 `showToast(` в 28 файлах | full | частично |
| Command palette + Find bar | palette 1; find bar 2 | 1 316 + 1 685 | 1 + 3 | partial / partial | palette — частично; find — нет |
| Select / combobox / autocomplete | общий `Select` 1; native `<select>` 1; slash menu 1 | 525 + 190 | 18 + 1 + 1 | Select full; slash partial | Select — да, но выигрыша почти нет; slash — частично |
| Side panel / sheet / drawer | 4 overlay-панели + слой focus mode; общего нет | ≈ 1 040 + 1 391 | 5 | partial | нет; частично — как non-modal dialog |

Главное в шести строках:

- Ни одной UI-библиотеки нет. В `package.json:28-77` нет Radix, Floating UI, cmdk, Sonner.
- Общих примитивов четыре: `Select`, `ActionMenu`, toast-система и hook `useDismiss`. Остальное — копии одного приёма в каждом файле.
- Из 19 модальных dialog у 13 нет focus trap, у 12 нет возврата фокуса.
- Позиционирование везде ручное: 52 вызова `getBoundingClientRect`. Переворот вверх/вниз (flip) умеют только `Select`, всплывашки цитат и карточка Mind map.
- Шкалы z-index нет: 79 объявлений, уровни overlay от 2 до 3000, именованных констант две (110 и 120).
- Главный риск миграции не в компонентах, а в трёх модульных guard-ах клавиатуры и в соглашениях о нажатии Esc (раздел 10).

## 1. Dialog / modal / confirm

### 1.1. Модальные dialog (19 реализаций)

Общего компонента нет. У всех одна схема: `createPortal` в `document.body`, затемнённый backdrop, `role="dialog"` с `aria-modal="true"`.
Цвет backdrop `rgba(0, 0, 0, 0.25)` скопирован в 17 файлов.
Общие кусочки: helper `focusablesOf` (`src/renderer/settings/settings-window.ts:69`) импортируют 5 модулей; frame `MachineDialogFrame` обслуживает 2 диалога; рамку `.w-apstart` делят два окна Autopilot.
Анимации открытия и закрытия нет ни у одного: в CSS этих файлов нет `@keyframes` и `transition` на появление.

Колонки: Esc — чем закрывается; Tab — есть ли focus trap; Фокус — куда ставится при открытии и возвращается ли; Backdrop — закрывает ли нажатие на фон.

| Dialog | Файл (LOC) | Portal | z-index | Esc | Tab | Фокус: вход / возврат | Backdrop | a11y |
|---|---|---|---|---|---|---|---|---|
| Settings | `settings/SettingsDialog.tsx` (141) + guard `settings/settings-window.ts` (144) | :94 | 110 (:97; `settings-window.ts:24`) | :69-77 и guard `settings-window.ts:97-119` | :78-91 и guard | раздел :38-39 / да :43 | нет, только `preventDefault` :99-101 | full |
| Keyboard shortcuts | `shortcuts/ShortcutsOverlay.tsx` (118) + guard `shortcuts/shortcuts-window.ts` (86) | :90 | 110 (:93) | guard `shortcuts-window.ts:74-76` | guard :77-82 | список :82 / да :85 | да :96 | full |
| worfy Guide | `guide/GuideWindow.tsx` (213) + guard `guide/store.ts:97-128` | :144 | 110 (:147) | guard `store.ts:101-105` | guard `store.ts:107-113` | тема :137 / да :140 | да :150 | full |
| Change address, Remove machine (общий `MachineDialogFrame`) | `machines/ChangeAddressDialog.tsx:30-82` (168), `machines/MachineDialogs.tsx` (94), `machines/machine-dialogs.ts` (71) | :44 | 120 (`machine-dialogs.ts:29,32`) | :60-62 | :63-73 + focusin :34-42 | первый control :38 / нет | да :47-49 | partial (нет возврата) |
| Start Autopilot | `autopilot/StartAutopilotModal.tsx` (587) + `autopilot/autopilot-modal.css` (360) | :447 | 120 (`autopilot-modal.css:23`) | window capture :413 | :421-428 + focusin :432-438 | Cancel :401 / да :403 | нет | full |
| Start now? | `autopilot/StartNowModal.tsx` (136) | :104 | 120 (та же рамка) | window capture :76-79 | :80-87 + focusin :91-97 | Cancel :65 / да :67 | нет | full |
| First run | `shell/FirstRun.tsx` (152) | :85 | 90 (:22) | :97 (не во время переноса) | нет | dialog :78 / нет | нет | partial |
| Project settings | `shell/ProjectSettings.tsx` (574) | :236 | 100 (:37) | :250 | нет | первое поле :197 / нет (возврат только из вложенного Edit profile :155-158) | да :239 | partial |
| Add project: выбор Machine (`MachineChoice`) | `shell/sidebar/ProjectsSection.tsx:166-215` | :172 | 95 (:89) | :188 | нет | dialog :170 / нет | да :175 | partial |
| Remove project | `projects/RemoveProject.tsx` (215) | :121 | 95 (:12) | :137 (не во время работы) | нет | dialog :89 / нет | да :124 | partial |
| Connect project | `projects/ConnectProject.tsx` (726) | :667 | 95 (:67) | :684 | нет | dialog :201 / нет | да :670 | partial |
| Folder browser | `projects/FolderBrowser.tsx` (226) | :166 | 96 (:35) | :183 | нет | dialog :106 / нет | да :169 | partial |
| Edit profile | `projects/EditProfile.tsx` (507) | :451 | 110 (:50) | :467 | нет | dialog :119 / да, через Project settings | да :454 | partial |
| Send all (PR replies) | `pr-inbox/DraftThread.tsx:466-520` (714) | :472 | 95 (:432) | :488 | нет | dialog :470 / нет | да :475 | partial |
| Move the old Harness | `harness/MigrationForm.tsx` (453) | :431 | 100 (:43) или prop `layer` (:433) | :306 | нет | нет / нет | да :434 | partial |
| Approve Harness hooks in Codex | `harness/CodexHooksStep.tsx` (205) | :141 | 100 (:23) | listener на window :118-120 | нет | нет / нет | да :144 | partial |
| Browser profiles | `browser/BrowserProfiles.tsx` (403) | :296 | 100 (:28) | :314 | нет | dialog :276 / нет | да :300 (и гасит все pointer-события :294) | partial |
| Link a machine | `machines/LinkMachineDialog.tsx` (521) | :307 | 100 (:16) | :321 | нет | поле :140-141 / нет | да :310 | partial |
| Image overlay (картинка во весь экран) | `session/MessageAttachments.tsx:76-110` (144) | :92 | 105 (`session.css:2335`) | :86 | нет | dialog :80 / да :82 | клик закрывает :93 | partial |

Мест вызова: по одному у каждого диалога, по два у `FolderBrowser`, `MigrationForm`, `ImageOverlay`. Всего 23 JSX-вызова. Список — в приложении, команда П10.

Сколько строк заменит библиотека. Файлы целиком — 6 100 строк, но это в основном формы. Сама оболочка (backdrop, Esc, фокус, ARIA, стили рамки) по замеру на трёх примерах:
- `MachineDialogFrame`: `ChangeAddressDialog.tsx:24-82` и стили `machine-dialogs.ts:31-45` — около 75 строк на два диалога.
- `StartNowModal`: `StartNowModal.tsx:62-107` — около 45 строк.
- Settings: `SettingsDialog.tsx:30-44`, `:62-103` и guard `settings-window.ts:58-144` — около 145 строк.
У простых диалогов оболочка около 40 строк. В сумме порядка 1 000 строк. Это оценка по трём замерам, построчно не считалось.

### 1.2. Inline confirm (`role="alertdialog"`, 4 места)

Это не модальные окна, а блок с вопросом внутри панели. Фокус в них не переходит, Esc не обрабатывается.

| Где | Строка |
|---|---|
| Settings → Pipeline: «Reset / Save / Remove?» | `settings/PipelineSection.tsx:399` |
| Session Node: «Resume the Session» | `canvas/nodes/SessionNode.tsx:651` |
| History popover: «Resume the Session» | `session/HistoryPopover.tsx:259` |
| Browser profiles: «Delete profile» | `browser/BrowserProfiles.tsx:242` |

### 1.3. Native-диалоги Electron (main, 8 мест)

Их web-библиотека не заменит. Они вне renderer-а.

| Что | Строка |
|---|---|
| `showMessageBox` «Move the old Harness out of ~/.claude?» | `src/main/ipc/harness-migration.ts:79` |
| `showMessageBox` подтверждение действия First run | `src/main/ipc/first-run.ts:130` |
| `showMessageBox` удаление папки демо Getting started | `src/main/ipc/getting-started.ts:171` |
| `showMessageBox` «Roll back to worfy …?» | `src/main/ipc/update.ts:390` |
| `showMessageBox` установка Harness | `src/main/ipc/harness.ts:146` |
| `showOpenDialog` «Attach files» | `src/main/ipc/agent.ts:104` |
| `showOpenDialog` «Add project» | `src/main/ipc/projects.ts:386` |
| `showErrorBox` при сбое запуска | `src/main/startup-failure.ts:127` |

### 1.4. a11y: partial

- Хорошо у всех 19: `role="dialog"`, `aria-modal="true"`, имя через `aria-labelledby` или `aria-label` (20 элементов с `aria-modal`, команда П4).
- Full только у 5: Settings, Shortcuts, Guide, Start Autopilot, Start now. У них есть focus trap и возврат фокуса.
- У 13 нет focus trap. Tab уводит фокус за backdrop, хотя `aria-modal` обещает обратное. Пример: `projects/RemoveProject.tsx:121-140` — только Esc.
- У 12 нет возврата фокуса на кнопку, которая открыла окно. Пример: `shell/FirstRun.tsx:78` ставит фокус, но не запоминает прежний.
- У двух фокус не ставится вовсе: `harness/MigrationForm.tsx`, `harness/CodexHooksStep.tsx`.

## 2. Popover и menu

### 2.1. Popover (11 реализаций)

Общий только hook `useDismiss` (`canvas/use-dismiss.ts:8-24`, 25 строк: Esc и mousedown снаружи). Его берут 2 файла. `TrashPopover` держит свою копию той же логики (`canvas/overlays/TrashPopover.tsx:62-80`).

| Popover | Файл | Portal / где | Позиционирование | z-index | Esc | Снаружи | Фокус | ARIA | a11y |
|---|---|---|---|---|---|---|---|---|---|
| История Session-ов Ticket-а и Epic-а («N sessions») | `canvas/session-history.tsx:94-140` (163) | portal :101 | `fixed` под кнопкой: `rect.bottom + 4`, `rect.left` (:152-153); без flip и без прижатия к краю | 1000 (`archive.css:61`) | `useDismiss` :100 | mousedown | не входит, не возвращается | `role="dialog"` :105; кнопка `aria-expanded`, `aria-haspopup` :145-147 | partial |
| Archive | `canvas/overlays/ArchivePopover.tsx` (189) | React Flow `<Panel>` :130 | CSS, над кнопкой (`archive.css:47-53`) | в Panel | `useDismiss` :118 | mousedown | не входит | `role="dialog"` :133; `aria-haspopup` :169 | partial |
| Trash | `canvas/overlays/TrashPopover.tsx` (135) | `<Panel>` :92 | CSS (`trash.css:34-40`) | в Panel | своя копия :68-73 | mousedown :64-67 | не входит | `role="dialog"` :95; `aria-expanded` :122 | partial |
| History в sidebar | `session/HistoryPopover.tsx` (299) | нет | `absolute` (:44-46) | 20 (:46) | только с фокусом внутри :280-287 | нет | не входит | `role="dialog"` :277 | partial |
| Queued messages | `session/composer/Queue.tsx:51` (67) | нет | `absolute` над chip (`session.css:2045-2049`) | 10 | нет | нет (только повторный клик) | не входит | `role="dialog"` :51; `aria-expanded` :38 | partial (только роли) |
| Effort (ползунок) | `session/composer/Pickers.tsx:179-360` (462) | нет | `absolute` над кнопкой (`session.css:1878-1882`) | 10 | :293-300, фокус на кнопку :232 | mousedown capture :282-288; blur :301-304 | ползунок :277 / да | `aria-haspopup="dialog"`, `aria-controls` :311-313; `role="dialog"` :334 | full |
| What's new | `update/WhatsNew.tsx` (198) | portal :160 | `fixed` под version chip | 130 (:46) | :169-172 → фокус на chip | mousedown и focusin :118-119 | popover :113 / да | `role="dialog"` :163 | full |
| Комментарий к цитате | `session/QuoteCommentParts.tsx:225-423` (471) | общий portal слоя `QuoteComments.tsx:826` | `fixed`, `placeNear`: под или над, прижат к окну (:59-77, :257) | 310 (`quote-comments.css:215`) | :281-286 | mousedown capture, кроме toast-ов :271-279 | поле :258-262; Tab по кругу :292-301; возврат не проверено | `role="dialog"` :322 | full |
| Кнопка «Comment» у выделения | `session/QuoteCommentParts.tsx:137-166` | тот же portal | `fixed`, `useFloating` | 300 (`quote-comments.css:116`) | — | — | — | `role="note"` :143 | partial |
| Command request (⌘I) Terminal AI | `canvas/nodes/TerminalAiRequest.tsx` (117) | нет, внутри Terminal Node | `absolute` над экраном (`TerminalNode.css:130-135`) | 2 | :72 | — | поле / да, в terminal (комментарий :5) | `role="dialog"` :89 | full |
| Карточка узла Mind map | `product/MindMap.tsx:764-900` (1 363) | нет, рядом с `<ReactFlow>` (:1340) | считается из camera (:806-809) и `cardPlace`: справа или слева, прижата к краям (`product/mind-map-layout.ts:671-677`) | 6 (`mind-map.css:429`) | :1220-1226, фокус на узел | клик по пустой карте | вход не проверено / да | `<section aria-label="Node">` :811-814 | partial |

Анимация есть только у всплывашек цитат: `w-quote-pop-in` 0.12 s (`quote-comments.css:73-78, 111`), с учётом reduce motion (`quote-comments.css:732-736`). Остальные появляются без анимации.

Мест вызова: 9 JSX (`SessionHistoryButton` ×2, `HistoryPopover`, `EffortPicker`, `WhatsNew`, `CommentPopover`, `SelectionButton`, `TerminalAiRequest`, `NodeCard`) и 3 через slot. Slot — папка, файлы которой подключаются сами через `import.meta.glob`: overlays Canvas (`canvas/extensions.ts:84`, `canvas/Canvas.tsx:484-486`) и элементы composer (`session/composer/index.ts:46`).

a11y: partial. Full — у 4 из 11 (Effort, What's new, комментарий к цитате, Command request). У popover-ов Canvas и sidebar фокус внутрь не переходит, поэтому с клавиатуры их содержимое достижимо только Tab-ом по всей странице.

Что заменит библиотека: popover Canvas, sidebar и composer — да (Popover). Частично — карточка Mind map (своя раскладка рядом с узлом), Command request и кнопка у выделения (якорь — выделенный текст, а не элемент).

### 2.2. Menu и menu button, включая «Modes» (6 реализаций)

Общий только `ActionMenu` (`canvas/actions/action-menu.ts`, 163 строки). Его берут «⋯» Autopilot (`canvas/actions/AutopilotAction.tsx:732`) и «Open PR» (`canvas/actions/OpenPr.tsx:46`).

| Menu | Файл (LOC) | Portal | Позиционирование | z-index | Клавиши | Фокус | Снаружи | ARIA | a11y |
|---|---|---|---|---|---|---|---|---|---|
| «⋯» и «Open PR» (`ActionMenu`) | `canvas/actions/action-menu.ts` (163) | :162 | `fixed` под кнопкой, по её правому краю (:73-74); без flip | 90 (`actions.css:48-50`) | ↑↓ по кругу :113-119; Esc с `preventDefault` :107-111; Home/End нет; Tab не обрабатывается | первый пункт :77-80 / назад на «⋯» :60-65 | mousedown, wheel, blur окна :82-97 | `aria-haspopup="menu"`, `aria-expanded` :129-130; `role="menu"` :143; `menuitem` + `aria-disabled` :150-153 | full (без Home/End) |
| «Modes» (Eco mode, Auto-approval, Auto-continue) | `session/composer/Modes.tsx` (283) | :207 | `fixed` над кнопкой (:102-107), сдвиг от правого края окна (:110-119) | 3000 (`session.css:2459-2460`) | ↓ на кнопке открывает :139-144; ↑↓ Home End без круга :169-172; Enter/Space :162-167; Esc :147-153; Tab закрывает :154-158 | первый пункт :118 / да | pointerdown capture, resize, blur :121-137 | `menuitemcheckbox`, `menuitemradio`, `group` + `aria-labelledby`, `aria-checked`, `aria-busy` :208-260 | full |
| «Sidebar shows» (Project switcher) | `shell/ProjectSwitcher.tsx` (195) | нет | `absolute` под кнопкой (`shell.css:243-248`) | 30 | ↓ открывает :153; ↑↓ по кругу, Home, End :117-120; Esc :121-125; Tab закрывает :126-128 | отмеченный пункт :104 / да | mousedown :108 | `menuitemradio` + `aria-checked` :164-171; `aria-haspopup`, `aria-controls` :141-143 | full |
| Меню version chip (Update) | `update/UpdateChip.tsx` (311) | :172 | `fixed` по краю chip (:126) | 130 (:79) | ↑↓ по кругу :184-186; Esc :180-183 | первый пункт :131 / да :183 | mousedown, focusin, blur :137-141 | `role="menu"` :175 | full (без Home/End) |
| «New session on» (выбор Vendor) | `session/NewSessionVendor.tsx` (130) | нет | `absolute` (:24-29) | 20 (:25) | только Esc, на document, без `preventDefault` :86-90 | первый пункт :99 / нет | mousedown :89 | `role="menu"` :103; `menuitem` + `aria-disabled` :115 | partial |
| «Choose a profile» Browser-а | `canvas/nodes/BrowserNode.tsx:437-491` (620) | нет, внутри Node | в потоке CSS (`BrowserNode.css:281-288`) | — | нет | не входит | mousedown :442-449 | `role="menu"` :462; кнопка `aria-expanded` :458 | none (кроме ролей) |

Анимации нет ни у одного menu.

Мест вызова: 7 (ActionMenu ×2, остальные по одному; «Modes» — через slot composer).

a11y: partial. Full — у 4 из 6. У «New session on» нет стрелок. У «Choose a profile» нет ни Esc, ни стрелок, ни перевода фокуса.

Что заменит библиотека: все 6 — да (DropdownMenu / Menu). У «Modes» есть checkbox- и radio-пункты; в Radix для них есть `CheckboxItem` и `RadioGroup` (по документации, не проверено).

## 3. Context menu

### 3.1. DOM в renderer-е (5 реализаций)

Общего нет. Комментарий объясняет, почему меню HTML, а не native: «Playwright cannot click a native menu» (`canvas/overlays/CanvasMenu.tsx:12`).

| Menu | Где открывается | Файл | Portal | Позиционирование | z-index | Клавиши | Фокус | ARIA | a11y |
|---|---|---|---|---|---|---|---|---|---|
| Canvas | правый клик по пустому месту Canvas (:74-81) | `canvas/overlays/CanvasMenu.tsx` (171) | :108 | `fixed` в точке клика, без прижатия к краю окна (:113) | 90 (:33) | ↑↓ по кругу :120-126; Esc с `preventDefault` :115-119 | первый пункт :88 / нет | `role="menu"` + `aria-label` :111-112; `menuitem`; `separator` :134 | partial |
| «Remove binding» | правый клик по Node, привязанному вручную (:172-180) | `canvas/overlays/BindingDrop.tsx:196-245` (250) | :222-245 | `fixed` в точке клика | 2000 (:72) | только Esc, window capture :197-209 | не входит / нет | `role="menu"` без имени :224 | none |
| Project в sidebar | правый клик по строке Project-а (`ProjectsSection.tsx:390-393`) | `shell/sidebar/ProjectsSection.tsx:262-322` | нет | `fixed` в точке клика (:289) | 90 (:74-76) | ↑↓ по кругу :292-298; Esc без `preventDefault` :291 | первый пункт :271 / нет | `role="menu"` + `aria-label` :287-288 | partial |
| Machine в sidebar | правый клик по строке Machine (`MachinesSection.tsx:304-307`) | `shell/sidebar/MachinesSection.tsx:137-181` | нет | `fixed` в точке клика (:163) | 90 (:63) | только Esc :164-166 | первый пункт :145 / нет | `role="menu"` + `aria-label` :161-162 | partial |
| Действия с выделенным текстом ответа | правый клик в transcript (`QuoteComments.tsx:501-547`) | `session/QuoteCommentParts.tsx:168-222` | общий portal слоя `QuoteComments.tsx:826` | `placeNear`: прижат к окну (:170) | 320 (`quote-comments.css:159-160`) | ↑↓ по кругу :187-190; Esc и Tab закрывают :191-193 | первый активный пункт :172 / нет | `role="menu"` :197; `menuitem` :205 | partial |

Снаружи все пять закрываются по mousedown; Canvas, Project, Machine и меню цитат — ещё по blur окна.
LOC: `CanvasMenu.tsx` 171 + около 210 строк внутри четырёх файлов.
Мест вызова: 5. Canvas и «Remove binding» подключаются через overlay slot.

a11y: partial. Ни одно не возвращает фокус. «Remove binding» не получает фокус и не имеет имени. Открытие с клавиатуры (клавиша Menu, Shift+F10) нигде не обработано; срабатывает ли браузерное событие `contextmenu` с клавиатуры в этих местах — не проверено.

### 3.2. Native-меню Electron

- Context menu: 0. Нет ни `Menu.popup`, ни обработчика `context-menu` у `webContents`, ни IPC для него (команда П7).
- Menu bar приложения: 1. `Menu.setApplicationMenu(Menu.buildFromTemplate(...))` в `src/main/menu.ts:165`. Пункты: меню приложения или File, Edit, View, Window, Help (`menu.ts:141-160`).
- Команды menu bar доходят до renderer-а событием `menu.command` (`src/shared/ipc/menu.ts:23`; `src/renderer/menu-command.ts:15-30`).
- Над `<webview>` Browser-а штатное меню страницы гасится (`canvas/nodes/BrowserNode.tsx:396`).

Что заменит библиотека: 5 DOM-меню — да (ContextMenu). Menu bar — нет, он native.

## 4. Tooltip

- Своего компонента нет. Поиск `Tooltip|tooltip` находит только helper-функции текста (`shared/version-number.ts`, `buildVersionTooltip`) и комментарии.
- Нет и CSS-подсказок через `attr()`: единственный `attr()` — `session.css:1548`, это не tooltip.
- Всё — native-атрибут `title`: 335 вхождений `title=` в 105 файлах `.tsx` (команда П8).
- По тегу, на котором стоит `title=` (эвристика по ближайшему `<Tag`, команда П9): `span` 117, `button` 105, `div` 34, прочие DOM-теги 25 — всего около 281 на DOM-элементах. Ещё 54 — props 22 компонентов. Часть из них сама передаёт `title` в DOM (`ActionButton`, `Chip`, `IconButton`, `Select`, `SettingSwitch`), часть — это заголовки (`SidebarSection`, `MachineDialogFrame`).
- Ещё `title` приходит через spread `writeAction(...)` (`projects/read-only.ts:26-29`): 46 вызовов. Это подсказка «почему действие неактивно» на экране Linked machine (связанной машины только для чтения).
- Сознательный приём: `aria-disabled` вместо `disabled`, потому что «a disabled button shows no tooltip» (`projects/read-only.ts:23-24`; то же в `session/composer/Modes.tsx:116`, `session/NewSessionVendor.tsx:41`).
- Свою подсказку для обрезанного текста считают сами: строки Command palette (`palette/CommandPalette.tsx:195-197`), пункты `Select` (`theme/Select.tsx:290-292`).

a11y: partial.
- Screen reader читает `title` как описание. Код на это рассчитывает (`settings/controls.tsx:37`).
- С клавиатуры подсказка не показывается: Chromium показывает `title` только при наведении мыши. Это поведение браузера, в репо не проверено.
- Задержку, место и оформление подсказки приложение не контролирует.

Что заменит библиотека: да (Tooltip). Объём — до 335 мест. Подсказки «почему неактивно» (`writeAction`, `aria-disabled`) стоит переносить первыми: там текст важен.

## 5. Hover card / preview

| Что | Файл | Как открывается | Позиционирование | Клавиатура | ARIA | a11y |
|---|---|---|---|---|---|---|
| Карточка комментария к цитате | `session/QuoteCommentParts.tsx:425-471` (47 строк) | наведение на подсвеченный кусок ответа: открытие через 280 ms, закрытие через 220 ms после ухода (`session/QuoteComments.tsx:37-38, 563-565`); наведение на chip в лотке (:733) | `fixed`, `useFloating` + `placeNear` (:436) | нет | `div` без роли | none |

Подсвеченный кусок — не элемент, а `Range` из CSS Custom Highlight API (`session/QuoteComments.tsx:196-237`). Поэтому якорь карточки — прямоугольник `Range`, а не DOM-узел.
Других hover card и hover preview нет. Подсветка узлов при наведении (`product/NodeChips.tsx:41-42`, `session/Transcript.tsx:1095-1096`) — не overlay. Миниатюра Evidence открывает `ImageOverlay` по клику, не по наведению (`canvas/nodes/EvidencePreview.tsx:5-7`).

Что заменит библиотека: частично. Hover card с элементом-триггером тут не подходит: нужен якорь-прямоугольник. Floating UI умеет virtual element; есть ли то же у Radix HoverCard — не проверено.

## 6. Toast / notification

### 6.1. Toast внутри окна

Одна общая система (worfy-ui ticket 16 — внутренние уведомления окна): store `toast/toasts.ts` (205) и компонент `toast/ToastRegion.tsx` (157). Ещё `toast/placement.ts` (49), `toast/revealed.ts` (18), `toast/toast.css` (127). Итого 556 строк.
Модули-обёртки для своих сценариев: `canvas/archive-toast.ts` (93), `flight-recorder/stop-toast.ts` (97), `session/question-toast.ts` (68), `update/toasts.ts` (341). Итого 599 строк.

- Монтируется один раз: `main.tsx:99`.
- Вызовы: 57 `showToast(` в 28 файлах, 12 `dismissToast(`, 27 файлов импортируют store.
- Виды: `error` 27, `info` 17, `action` 14, `success` 2.
- Правила store (`toasts.ts:7-17`): `info` и `success` скрываются сами через 4 000 ms (:21). `error` и `action` висят до закрытия. Один toast на `key`: повтор заменяет его на месте. Toast с `projectId` виден только в своём Project. На экране не больше 3 (:24); лишние sticky ждут в очереди. Наведение мыши или фокус ставят таймер на паузу и потом запускают его заново целиком.
- Portal: в `document.body` (`ToastRegion.tsx:142-156`).
- z-index 120 (`toast.css:17`): выше dialog-ов (90–110), ниже меню version chip и What's new (130).
- Место измеряется, а не задано. Каждые 200 ms (`placement.ts:20`) и при resize стопка встаёт в первую свободную полосу правого края. Обходит то, что помечено `data-toast-keep-out`, открытые `[role="dialog"]` и `[role="menu"]`, minimap (`ToastRegion.tsx:98-116`).
- Клавиатура: фокус toast не забирает. Кнопки достижимы Tab-ом. Esc на toast-е в фокусе закрывает его и возвращает фокус туда, где он был (`ToastRegion.tsx:52-67`).
- ARIA: landmark `aria-label="Notifications"`; `error` в `role="alert"`, остальные в `role="status"` + `aria-live="polite"`. Обе области всегда в DOM (`ToastRegion.tsx:13-16, 143-153`).
- Анимация: появление `w-toast-in` 160 ms (`toast.css:46, 111-121`), без него при reduce motion (`toast.css:123-127`). Исчезновение без анимации.

a11y: full.

### 6.2. OS notification (main)

`new Notification(...)` в `src/main/notify.ts:861`. Это уведомления системы, их web-библиотека не заменит.

### 6.3. Inline-сообщения

`role="alert"` — 99 мест, `role="status"` — 39 мест (команда П6). Общего компонента нет. Это сообщения об ошибке и статусе рядом с полем или кнопкой.

### 6.4. Что даст Sonner (сверено по `sonner/src/index.tsx`)

Совпадает: по умолчанию 3 видимых toast-а и 4 000 ms; пауза при наведении; пауза, когда документ скрыт.
Не покрывает: показ по `projectId`; очередь sticky toast-ов сверх трёх; раскладку в обход `data-toast-keep-out` и открытых меню; разделение `error` в `role="alert"` (у Sonner один `aria-live="polite"` на section).
Добавляет своё: горячую клавишу Alt+T по умолчанию, свою реакцию на Esc при фокусе в списке.
Вывод: частично. Store с правилами останется своим, а Sonner заменит только отрисовку.

## 7. Command palette и Find bar

### 7.1. Command palette

Файлы: `palette/CommandPalette.tsx` (618), `palette/commands.ts` (677), `palette/groups.ts` (21). Итого 1 316 строк. Ранжирование своё и общее с поиском по Canvas: `rankItems` (`find/search-index.ts:94`, файл 441 строка).
Место вызова: 1 (`shell/Toolbar.tsx:156`).

- Открытие: ⌘K / Ctrl+K, listener на window (`CommandPalette.tsx:576-585`); кнопка в toolbar (:593-611).
- Portal :488. Backdrop z 100 (:57), панель z 101 (:73). Место — CSS: по центру сверху, `left: 50%` + `translateX(-50%)` (:58-73).
- Клавиши живут на поле ввода (:468-483): ↑↓ по кругу, Enter нажимает активную строку, Esc с `preventDefault` закрывает.
- ARIA: поле `role="combobox"` + `aria-activedescendant` (:496-500); `listbox` и `group` с заголовками; строки `option` + `aria-selected` + `aria-disabled` (:209-212); причина неактивности — в `title` строки (:217).
- Нажатие на backdrop закрывает (:489).
- Чего нет: `aria-modal`; focus trap (Tab уходит с поля, строки `tabIndex={-1}` :210; вживую не проверено); возврата фокуса при закрытии (`close` только меняет state, :588).
- Анимации нет.

a11y: partial.

Что даст cmdk (сверено по `cmdk/src/index.tsx`): частично.
- `Command.Dialog` построен на `@radix-ui/react-dialog`. Значит, появятся focus trap и `aria-modal`.
- Встроенный фильтр — `commandScore`. Его придётся заменить своим ранжированием, асинхронной группой «In transcripts» и неактивными строками с причиной.
- `vimBindings` по умолчанию включён: Ctrl+N/J/P/K двигают выбор с `preventDefault`. На Windows и Linux это пересекается с Ctrl+K палитры (раздел 10, К8).

### 7.2. Find bar (2 реализации)

| Bar | Файлы (LOC) | Где | Клавиши | ARIA | a11y |
|---|---|---|---|---|---|
| Find on the Canvas (⌘F) | `find/CanvasFind.tsx` (463), `find/canvas-requests.ts` (130), `find/node-rect.ts` (29), `find/search-index.ts` (441) | React Flow `<Panel position="top-center">` (:375), через overlay slot (`canvas/overlays/CanvasFind.tsx`) | ⌘F (:440-448), не под focus mode (:444); Enter / ⇧Enter (:345-347); Esc (:342-344) | `role="search"` (:378); `aria-live="polite"` у счётчика (:405); кнопки с `aria-label` и `title` с клавишей (:408-414) | partial |
| Find in the Session (⌘F) | `session/SessionFind.tsx` (73), `session/transcript-find.ts` (549) | вверху transcript, CSS `.w-session-find` z 3 (`session.css:261-265`) | те же; listener `transcript-find.ts:331` | `role="search"` (:36); `aria-live` (:48) | partial |

Мест вызова: 3 (Canvas через slot, Session — `SessionView.tsx:303` и `ExternalSessionPanel.tsx:235`).
Совпадения в transcript подсвечиваются через CSS Custom Highlight API (`transcript-find.ts:528-529`).
Почему partial: при закрытии фокус не возвращается (`canvas-requests.ts:118-120`, `transcript-find.ts:428`).
Что заменит библиотека: нет. Это toolbar с полем и своей логикой поиска, а не overlay.

## 8. Select / combobox / autocomplete

| Что | Файл (LOC) | Мест вызова | Позиционирование | Клавиши | ARIA | a11y |
|---|---|---|---|---|---|---|
| Общий `Select` (паттерн WAI-ARIA «select-only combobox») | `theme/Select.tsx` (414), `theme/select.css` (111) | 18 в 13 файлах (Settings — 8 секций, Project settings ×2, composer ×2, Session picker, Profile fields, Move the old Harness) | portal :331; `fixed`; под кнопкой или над ней, где больше места; не шире 480 px и окна; прижат к правому краю; пересчёт при каждом рендере (:262-292); z 3000 (`select.css:58-60`) | закрыт: ↓ ↑ Enter Space Home End и буква открывают; открыт: ↑↓ без круга, Home, End, Enter/Space выбирают, Tab выбирает и идёт дальше, typeahead со сбросом через 500 ms, Esc с `preventDefault` + `stopPropagation` (:10-16, :187-250) | кнопка `role="combobox"` + `aria-activedescendant` + `aria-controls`; `listbox` / `option` + `aria-selected` (:335-390) | full |
| Native `<select>` | `flight-recorder/RunHistoryView.tsx:85` | 1 | браузер | браузер | `aria-label` | full |
| Slash menu (`/` в поле ввода) | `session/SlashMenu.tsx` (190) | 1 (`session/MessageInput.tsx:251`) | `absolute` над полем (`session.css:1699-1711`), z 20 | ↑↓, Tab и Enter вставляют, Esc скрывает (:129-135) | `listbox` / `option` + `aria-selected` (:142-152); поле не связано со списком: нет `aria-activedescendant` и `aria-controls` в `MessageInput.tsx` | partial |

`Select` закрывается при mousedown снаружи (capture), при прокрутке того, что держит кнопку, при resize и blur окна (`theme/Select.tsx:306-326`).
Autocomplete с подсказками в других местах нет. Поле тегов в selection toolbar — обычный `input` (`canvas/overlays/SelectionToolbar.tsx:168-192`). Поиск в Archive — фильтр списка, не combobox.
Command palette тоже combobox; он описан в разделе 7.1.

Что заменит библиотека:
- `Select` — да, но выигрыша почти нет. Компонент уже один и уже full a11y.
- Slash menu — частично. Нужен combobox с фокусом в textarea (Base UI Combobox, cmdk без своего поля или Ariakit; выбор не проверен).

## 9. Side panel / sheet / drawer

Общего компонента нет. Все панели не модальные.

| Панель | Файл (LOC) | Где и как | z-index | Esc | Фокус | ARIA | a11y |
|---|---|---|---|---|---|---|---|
| ADR (запись архитектурного решения) поверх Canvas | `shell/sidebar/AdrSection.tsx:117-200` (327) | portal :145; `fixed` справа под toolbar (:61-67) | 20 (:67) | listener на window, `preventDefault` (:119-127) | не входит | `<section role="dialog" aria-label>` (:147); `data-toast-over` | partial |
| Span panel в Work track | `work-track/SpanPanel.tsx` (216) | `absolute` справа в виде Work track (`work-track.css:641-647`) | 3 | listener на window, если нет другого dialog и menu и фокус не в поле (:115-127) | не входит | `<aside role="dialog" aria-label>` (:149) | partial |
| Getting started (чек-лист знакомства) | `getting-started/GettingStartedPanel.tsx` (611) | portal :441 (свёрнутая «пилюля») и :515 (панель); `fixed` (:78-82) | 80 (:82) | нет | заголовок по запросу (:405-414), фокус на пилюлю или заголовок при сворачивании (:416-421) | `role="region"` (:516) | partial |
| Настройки Browser-а | `canvas/nodes/BrowserSidebar.tsx` (132) | внутри Browser Node, поверх правой части страницы | — | `preventDefault` + `stopPropagation` (:113-118) | выбранный radio или панель (:99-105) | `<aside aria-label>` (:107-112) | full |
| Слой focus mode | `focus/*` (1 391: `FocusMode.tsx` 602, `cover.ts` 105, `focus.css` 305, `split-tree.ts` 295 и др.) | portal в главную область окна (:524, :600); она — свой stacking context (`shell/shell.css:333` `isolation: isolate`) | 1000 (`focus.css:11`) внутри области | своя логика в два шага (раздел 10) | в слой и обратно (:360-376); то, что под слоем, — `inert` (:335-352) | `role="region"`, не modal (:525-532) | full |

Мест вызова: 5 (`WorkTrackView.tsx:118`, `AppShell.tsx:132`, `AdrSection.tsx:303`, `BrowserNode.tsx:615`, focus mode — `canvas/overlays/FocusEntry.tsx`).
Пристыкованные панели — не overlay, в счёт не идут: нижняя панель Run history (`flight-recorder.css:503-506`, `flex: none`), колонка агентов Product Session (`session.css:419`), сам sidebar.

Что заменит библиотека: нет.
- Панели не модальные и стоят внутри своей раскладки.
- Vaul — drawer на `@radix-ui/react-dialog` (сверено по его `package.json`). Его README говорит: «This repo is unmaintained.»
- Для ADR и Span panel подошёл бы non-modal Dialog, но выигрыш — только Esc и фокус.
- Focus mode — своя раскладка плиткой, библиотечного аналога нет.

## 10. Фокус и глобальные shortcuts (`src/renderer/focus`, `src/renderer/shortcuts`)

### 10.1. Как это устроено

**Реестр клавиш — данные, а не диспетчер.**
- Все сочетания лежат в одном списке `src/shared/shortcuts.ts` (140 строк). Его читают обработчики, подписи кнопок, меню приложения и окно Keyboard shortcuts (`shortcuts.ts:1-4`). Пользователь клавиши не меняет (`:11`).
- Сопоставление нажатия — `matches` в `src/renderer/shortcuts/match.ts:52-60`.
- Исключения: текстовое поле (`isTextTarget`, `match.ts:91-94`) и Terminal (`isInTerminalNode`, `match.ts:97-99`; список `shellKeeps` отдаёт shell-у нужные Ctrl-сочетания на Windows и Linux, `match.ts:58`).

**Слушает каждый модуль сам.** Центрального обработчика клавиатуры, стека слоёв или «focus scope» нет.
30 listener-ов `keydown` на `window` / `document` (команда П12):
- 10 в capture phase на window. Модальные guard-ы: `settings/settings-window.ts:141`, `shortcuts/shortcuts-window.ts:86`, `guide/store.ts:127` — добавляются при импорте модуля, раньше любого компонента. Focus mode: `focus/FocusMode.tsx:439-440`. Сворачивание стопки done по Esc: `canvas/overlays/SelectionToolbar.tsx:120`. Закрытие «Remove binding»: `canvas/overlays/BindingDrop.tsx:204`. ⌘↩ раньше обработчика React Flow: `canvas/overlays/FocusEntry.tsx:103`. Окна Autopilot: `autopilot/StartNowModal.tsx:96`, `autopilot/StartAutopilotModal.tsx:437`.
- 4 в bubble phase на document: `settings-window.ts:142` и `guide/store.ts:128` (останавливают клавиши окна до listener-ов на window), `session/QuoteComments.tsx:599`, `session/NewSessionVendor.tsx:90`.
- 16 в bubble phase на window: ⌘K (`palette/CommandPalette.tsx:584`), ⌘F (`find/CanvasFind.tsx:448`, `session/transcript-find.ts:331`), «?» (`shortcuts/ShortcutsOverlay.tsx:71`), ⌘= / ⌘− (`canvas/Canvas.tsx:390`), Esc выхода из активного Node (`Canvas.tsx:422`), Delete и ⌘Z (`SelectionToolbar.tsx:119`), ⌘[ (`session/ExternalSessionPanel.tsx:73`), Esc панелей и popover-ов (`AdrSection.tsx:126`, `SpanPanel.tsx:126`, `RunHistoryView.tsx:207`, `TrashPopover.tsx:75`, `canvas/use-dismiss.ts:19`, `CodexHooksStep.tsx:120`), стрелки списка PR (`pr-inbox/PrInboxView.tsx:733`), выход из focus mode (`FocusMode.tsx:441`).

**Часть сочетаний — accelerators меню приложения в main.** Это Settings… (`src/main/menu.ts:71`), Keyboard Shortcuts (`:109-110`), масштаб интерфейса (`:123-125`), Toggle Sidebar (`:154`). Нажатие приходит в renderer как IPC `menu.command` (`src/renderer/menu-command.ts:15-30`). Комментарий кода: Electron отдаёт accelerator-у только нажатия, которые страница не отменила (`shortcuts-window.ts:66-69`).

**Вместо общего механизма — соглашения между обработчиками.**

1. «Одно нажатие — одно действие».
   - Кто закрылся по Esc, вызывает `preventDefault` (`canvas/use-dismiss.ts:12-15`, `canvas/actions/action-menu.ts:107-111`, `CanvasMenu.tsx:115-118`, `theme/Select.tsx:208-212`).
   - Следующие проверяют `defaultPrevented` (`Canvas.tsx:417`, `SpanPanel.tsx:118`, `FocusMode.tsx:424`, `canvas/sources/epics.ts:172`).
   - Другие закрываются через `stopPropagation` в React-обработчике: `ChangeAddressDialog.tsx:60-62`, `Modes.tsx:149-152`, `HistoryPopover.tsx:280-287`. Комментарий в `HistoryPopover.tsx:280-282` прямо говорит, что так нажатие не доходит до ADR panel на window.
   - Третьи не делают ни того, ни другого: `ProjectsSection.tsx:291`, `MachinesSection.tsx:165`, `NewSessionVendor.tsx:87`. Для них focus mode ждёт конца задачи нажатия и смотрит, закрылся ли popup (`FocusMode.tsx:176-178, 403-438`).
2. «Открыт ли popup» узнают по DOM: `[role="dialog"]`, `[role="menu"]`. Так делают 6 мест: `FocusMode.tsx:145-147`, `canvas/sources/epics.ts:177`, `SpanPanel.tsx:121`, `flight-recorder/RunHistoryView.tsx:156`, `toast/ToastRegion.tsx:99`, `pr-inbox/PrInboxView.tsx:645` (там ещё `listbox`).
3. Модальность — три отдельные копии guard-а на уровне модуля.
   - Settings: `settings-window.ts:84-144`. Пропускает слой «выше себя» по z-index элемента прямо под `body`, если он больше 110 (`:87-94`).
   - Keyboard shortcuts: `shortcuts-window.ts:58-86`. Гасит все клавиши, слой не проверяет (`:70-84`).
   - Guide: `guide/store.ts:88-129`. Esc и Tab всегда его (`:97-118`).
4. Focus trap написан в 6 местах по-своему: эти три guard-а, `MachineDialogFrame` (`ChangeAddressDialog.tsx:34-42, 63-73`), `StartNowModal.tsx:71-102`, `StartAutopilotModal.tsx:405-445`. `SettingsDialog.tsx:78-91` повторяет Tab-цикл своего guard-а. Ещё два хранителя фокуса: focus mode (`focus/cover.ts:87-105`) и `shell/FirstRunChecks.tsx:375-385`. Всего 8 listener-ов `focusin`.
5. Focus mode.
   - Слой — `role="region"`, а не modal: sidebar рядом остаётся в работе (`FocusMode.tsx:525`).
   - То, что под слоем, получает `inert` (`FocusMode.tsx:335-352`, `cover.ts:39-81`).
   - Фокус уходит в слой и возвращается туда, где был (`FocusMode.tsx:360-376`).
   - Esc обрабатывается в два шага. В capture phase слой запоминает, какие dialog и menu открыты снаружи. В bubble phase решает: если кто-то вызвал `preventDefault` — не выходит; если снаружи ничего не открыто — выходит; иначе ждёт конца задачи и выходит, только если popup не закрылся (`FocusMode.tsx:403-445`).

### 10.2. Чего ждать от библиотеки (Radix, Base UI): конфликты

Порядок события `keydown`:
1. capture-listener-ы на window — guard-ы приложения;
2. capture-listener-ы на document — здесь Radix ловит Esc: `ownerDocument.addEventListener('keydown', …, { capture: true })`, сверено в `use-escape-keydown.tsx`;
3. сам элемент и React-обработчики;
4. bubble-listener-ы на document — здесь Floating UI `useDismiss`, если Esc не в capture;
5. bubble-listener-ы на window — большинство обработчиков приложения.

| # | Конфликт | Доказательство | Что делать |
|---|---|---|---|
| К1 | Пока открыт Settings, Shortcuts или Guide, их guard на window capture получает Esc и Tab раньше библиотеки. Settings пропускает слой, только если у элемента прямо под `body` z-index больше 110. У Radix Popover прямо под `body` оказывается wrapper popper-а: Portal с `asChild`, wrapper копирует z-index содержимого (сверено в `popover.tsx`, `popper.tsx`). Без z-index больше 110 Esc закроет Settings, а не popover. Guard `keepFocus` заберёт фокус из popover-а обратно. В окне Shortcuts любой popup библиотеки не получит ни одной клавиши. | `settings-window.ts:87-94, 97-119, 127-138`; `shortcuts-window.ts:70-84`; `guide/store.ts:97-118` | Перенести три окна на Dialog библиотеки одним шагом с удалением guard-ов. Либо задать слоям библиотеки z-index больше 110 и научить guard-ы их видеть. |
| К2 | Два focus trap сразу. Radix FocusScope слушает `focusin` и `focusout` на document и возвращает фокус в свой контейнер (сверено в `focus-scope.tsx`). У приложения таких хранителей 5 плюс FirstRunChecks. Modal библиотеки поверх modal приложения или наоборот: каждый будет возвращать фокус к себе, фокус может переходить туда-обратно без конца. Вживую не проверено. | `settings-window.ts:127-138`, `ChangeAddressDialog.tsx:34-42`, `StartNowModal.tsx:91-97`, `StartAutopilotModal.tsx:432-441`, `cover.ts:87-105`, `FirstRunChecks.tsx:375-385` | Переводить модальные окна пачкой, а не по одному. Не открывать окно одной системы поверх окна другой. |
| К3 | Соглашение о `preventDefault`. Radix при закрытии по Esc вызывает `event.preventDefault()` перед `onDismiss` (сверено в `dismissable-layer.tsx`). Это совместимо с проверками `defaultPrevented`. Floating UI `useDismiss` `preventDefault` не вызывает, только `stopPropagation`, когда `bubbles` выключен (сверено по upstream `useDismiss.ts`; повторяет ли это Base UI — не проверено). Дыра есть уже сейчас: Esc в поле ввода прерывает ход агента и `defaultPrevented` не смотрит. Popup библиотеки, который оставляет фокус в поле (замена slash menu, mention combobox), закроется и прервёт ход тем же нажатием. | `MessageInput.tsx:344-347`; потребители `defaultPrevented` — `Canvas.tsx:417`, `FocusMode.tsx:424`, `SpanPanel.tsx:118`, `epics.ts:172` | Добавить проверку `defaultPrevented` в `MessageInput.tsx:344`. Для Base UI проверить поведение до выбора. |
| К4 | Проверки «открыт ли popup» знают только `dialog` и `menu`. Radix Popover даёт `role="dialog"` (сверено). Select и Combobox библиотеки дают `listbox` — их увидит только `PrInboxView.tsx:645`. Если у popup-а есть exit-анимация, он остаётся в DOM после закрытия, и focus mode считает его ещё открытым. Выход по Esc тогда держится только на `preventDefault`, то есть на Radix. | `FocusMode.tsx:140-147, 176-178`; `epics.ts:177`; `SpanPanel.tsx:121`; `RunHistoryView.tsx:156`; `ToastRegion.tsx:99` | Вынести «открытые слои» в один helper и учесть `listbox` и атрибут закрытия (`data-state="closed"`). |
| К5 | Нажатие снаружи. Canvas на window capture снимает активность Node при `pointerdown` вне `.react-flow__node`: popover библиотеки, вынесенный из Node в `body`, «выключит» Node первым кликом. Свои portal-меню ведут себя так же уже сейчас. Radix ловит нажатие снаружи на document в bubble phase, listener ставит через `setTimeout(0)` (сверено). Нажатие, которое React-обработчик остановил (`BrowserProfiles.tsx:294` гасит mousedown и pointerdown), до document не дойдёт, и popover не закроется. Клик внутри `<webview>` до документа не доходит вовсе. Свои меню закрываются по blur окна; закрывает ли Radix по blur — не проверено. | `Canvas.tsx:409-421`; `action-menu.ts:91`, `CanvasMenu.tsx:93`, `Select.tsx:320`, `Modes.tsx:132` | Добавить закрытие по blur окна в обёртку над библиотекой. Popup-ы из Node помечать как «внутри Node». |
| К6 | Modal Radix ставит `body.style.pointerEvents = 'none'` (сверено) и `aria-hidden` всем соседям под `body` через `hideOthers` (сверено в `dialog.tsx`). Toast-ы — сосед под `body` с `pointer-events: auto`. Они останутся кликабельными, но клик по ним — «снаружи», и modal закроется. Screen reader перестанет объявлять toast-ы, пока modal открыт. Сейчас клик по toast-у не закрывает свои modal (они закрываются только по нажатию на сам backdrop), а комментарий к цитате явно не считает клик по toast-у нажатием снаружи. | `toast.css:45`; `ToastRegion.tsx:142-156`; `QuoteCommentParts.tsx:273`; backdrop-проверка, например `RemoveProject.tsx:124-125` | В `onPointerDownOutside` пропускать область toast-ов. Решить, должны ли toast-ы объявляться поверх modal. |
| К7 | Скрытые view. AppShell держит view смонтированными и скрывает их атрибутом `hidden`. Проверки отбрасывают popup-ы под `[hidden]`. Portal библиотеки уходит из-под `[hidden]` предка, и popup скрытого view будет и виден, и «открыт» для проверок. То же верно для 34 своих portal-ов уже сейчас; библиотека добавит их. | `FocusMode.tsx:140-142`; комментарий `RunHistoryView.tsx:207-209` | Закрывать popup-ы при смене view, как часть общей обёртки. |
| К8 | cmdk по умолчанию `vimBindings = true`: Ctrl+N/J/P/K двигают выбор с `preventDefault` (сверено). На Windows и Linux Ctrl+K — сама палитра; внутри палитры оно станет «вверх». | `shared/shortcuts.ts:72`; `CommandPalette.tsx:576-585` | `vimBindings={false}`. |
| К9 | Шкалы z-index нет. 79 объявлений, уровни overlay от 2 до 3000. Именованных констант две: `SETTINGS_LAYER = 110` и `MACHINE_DIALOG_LAYER = 120`; плюс `PINNED_Z_INDEX = 1000` для закреплённых Node. Radix копирует z-index содержимого в wrapper, своей шкалы не вводит (сверено в `popper.tsx`). | `settings-window.ts:24`; `machine-dialogs.ts:29`; `canvas/pinning.ts:38`; таблица в 10.3 | Сначала ввести шкалу слоёв в `tokens.css`, потом переносить компоненты. |

### 10.3. Слои z-index сейчас (уровень overlay)

| z-index | Кто |
|---|---|
| 3000 | список `Select` (`select.css:60`), меню «Modes» (`session.css:2460`) |
| 2000 | меню «Remove binding» (`BindingDrop.tsx:72`) |
| 1000 | слой focus mode — внутри своей области (`focus.css:11`); popover истории Session (`archive.css:61`); закреплённые Node (`pinning.ts:38`); контур привязки (`BindingDrop.tsx:56`) |
| 300–320 | кнопка, popover, карточка и меню цитат (`quote-comments.css:116, 160, 215, 436`) |
| 130 | меню version chip, What's new (`UpdateChip.tsx:79`, `WhatsNew.tsx:46`) |
| 120 | toast-ы (`toast.css:17`), окна Autopilot (`autopilot-modal.css:23`), диалоги Machine (`machine-dialogs.ts:29`) |
| 110 | Settings, Shortcuts, Guide (`settings-window.ts:24`), Edit profile (`EditProfile.tsx:50`) |
| 105 | Image overlay (`session.css:2335`) |
| 100–101 | Command palette (`CommandPalette.tsx:57, 73`); Project settings, Link a machine, Browser profiles, Move the old Harness, Codex hooks |
| 95–96 | Remove project, Connect project, Send all, выбор Machine; Folder browser |
| 90 | Canvas menu, «⋯», меню Project и Machine, First run |
| 80 | Getting started (`GettingStartedPanel.tsx:82`) |
| 20–30 | ADR panel, History, New session on, slash menu, Project switcher |
| ≤ 10 | Effort, Queue, Span panel, find в Session, карточка Mind map, Command request |

## 11. Canvas: overlay внутри трансформированного viewport

Viewport React Flow сдвигается и масштабируется CSS `transform`. Всё внутри него масштабируется вместе с zoom.

**Внутри viewport через `ViewportPortal` (4 места):**
- Selection toolbar: `SelectionToolbar.tsx:379-387`. Обратное масштабирование `scale(1/zoom)` и свой выбор стороны, чтобы не закрыть шапку Epic frame, соседние Node и кнопку Focus (`canvas/pinning.ts:384-407`; `SelectionToolbar.tsx:360-378`).
- Кнопка Focus: `FocusEntry.tsx:118-124`.
- Контур и подпись «Bind to …» при перетаскивании: `BindingDrop.tsx:216-220`.
- Страницы `<webview>` Browser-ов: `BrowserLayer.tsx:394-400`.

**Внутри компонентов Node, то есть тоже под zoom:**
- меню «Choose a profile» (`BrowserNode.tsx:461-489`);
- настройки Browser-а (`BrowserSidebar.tsx:107`);
- Command request Terminal AI (`TerminalAiRequest.tsx:87-93`);
- вопрос «Resume the Session» (`SessionNode.tsx:651`).
Эти элементы несут классы `nodrag` / `nowheel` / `nopan`, иначе React Flow тянул бы и сдвигал Canvas (`TerminalAiRequest.tsx:88`, `BrowserSidebar.tsx:110`).

**Вынесены из viewport в `body` сознательно.** Комментарии объясняют: внутри Node их масштабировал бы zoom, а Epic frame обрезал бы.
- `ActionMenu` — `action-menu.ts:7-9, 162`;
- история Session-ов — `session-history.tsx:89-92, 101`;
- меню «Remove binding» — `BindingDrop.tsx:222-245`;
- Canvas menu — `CanvasMenu.tsx:108-170`.

**В `<Panel>` React Flow** (обёртка без transform): Trash (`TrashPopover.tsx:92`), Archive (`ArchivePopover.tsx:130`), Find bar и фильтр тегов (`CanvasFind.tsx:162, 375`), полоса «только чтение» (`ReadOnlyCanvas.tsx:52`).

**История вопроса.** Selection toolbar раньше стоял на `NodeToolbar` React Flow. Его убрали в `530ff5e12` (worfy-daily 12: закреплённый Node уезжал под minimap, а чужой toolbar рисовался поверх него). Причина записана в `pinning.ts:20-23`: `NodeToolbar` кладёт toolbar поверх всей плоскости.

**Что это значит для библиотеки с portal.**
- Portal в `body` — то же решение, что приложение уже приняло для меню. Начальное место будет верным: Floating UI считает от `getBoundingClientRect`, в нём zoom уже учтён.
- Следовать за Node при pan и zoom popup не будет. `autoUpdate` Floating UI по умолчанию не реагирует на `transform` (`animationFrame = false`; сверено в `autoUpdate.ts`). В Radix это включает `updatePositionStrategy="always"` (сверено в `popper.tsx`).
- Сейчас так: `ActionMenu` закрывается при прокрутке колесом (`action-menu.ts:90`), а история Session-ов не закрывается и, по коду, остаётся на месте, когда Canvas уезжает (`use-dismiss.ts:8-24`; вживую не проверено).
- Popup, оставленный внутри Node без portal, будет масштабироваться и обрезаться, как сейчас «Choose a profile».
- Selection toolbar и кнопку Focus библиотека не заменит: раскладка своя.

## 12. Известные баги этих примитивов

Источник: 969 ticket-файлов в 41 папке `.scratch/*/issues/` и `git log`. Открытых ticket-ов о самих примитивах нет. Есть только flaky e2e (`worfy-polish/issues/47-…`, открыт).

### 12.1. Заметные ticket-ы

| Ticket | Что было | Чем закрыт |
|---|---|---|
| `.scratch/worfy-polish/issues/51-список-пикера-session-не-влезает.md` (bug) | Список `Select` шире окна: начинался у левого края поверх списка Projects, длинная строка уходила за правый край | `4bfe1475b` (#1347) |
| `.scratch/worfy-polish/issues/46-клавиши-canvas-не-действуют-под-слоем-focus-mode.md` | Фокус ни на чём: Delete под слоем focus mode незаметно отправлял выделение в Trash; ⌘Z менял раскладку; Esc сворачивал стопку вместо выхода; ⌘F открывал поиск под слоем | `e3c54550a` (#1098) |
| `.scratch/worfy-ui/issues/13-settings-в-режиме-фокуса.md` | «Settings…» в focus mode не открывался: слой 1000 против окна 110, окно было бы невидимо | `083c7db72` (#327) |
| `.scratch/worfy-browser/issues/17-в-focus-mode-browser-страница-не-видна.md` (bug) | `<webview>` оставался на Canvas под слоем focus mode | `6698ecf77` (#831) |
| `.scratch/worfy-daily/issues/12-закреплённый-node-и-toolbar.md` | Закреплённый Node уезжал под minimap; toolbar чужого выделения рисовался поверх него (`NodeToolbar`) | `530ff5e12` (#52) |
| `.scratch/worfy-polish/issues/01-панель-выделения-не-закрывает-шапку-рамки-epic-а.md`, `…/14-панель-выделения-не-закрывает-соседние-ticket-ы.md` | Selection toolbar закрывал шапку Epic frame, подписи колонок и соседние Ticket-ы | `d494f607a` (#348), `342b32b0d` (#367) |
| `.scratch/worfy-windows/issues/101-кнопка-focus-на-windows-шире-места-панели-выделения.md` | На Windows кнопка Focus шире 96 px, которые toolbar ей оставлял | `bfbffbc9d` (#762) |
| `.scratch/worfy-ui/issues/24-долг-после-review-pr-677-693-698.md` | Стопка toast-ов могла закрыть Send, пока открыт Command palette: поле не было в keep-out | `1f38df2cc` (#716) |
| `.scratch/worfy-polish/issues/42-flaky-e2e-session-archive-toast.md` | Toast архива не появлялся для пачки, сделанной при старте | `ad9919ac2` (#822), правка в main и `canvas/archive-toast.ts` |
| `.scratch/worfy-polish/issues/48-шапка-на-узком-окне.md` | Toolbar шире узкого окна; повторные toast-ы «Update failed» | `022657ee4` (#1500) |
| `.scratch/worfy-polish/issues/28-заголовки-command-palette-до-трёх-строк-и-tooltip-только-у-обрезанных.md`, `…/16-полный-текст-ручной-проверки-в-палитре.md` | Строки палитры обрезались; tooltip стоял и на необрезанных | `2e805e061` (#423), `9742c4568` (#366) |
| `.scratch/worfy-ui/issues/15-composer-подписи-model-и-permissions-скрываются-когда-значение-не-помещается.md` | Значение picker-а обрезалось из-за подписи | `da3de685f` (#450) |
| `.scratch/worfy-ui/issues/27-курсор-pointer-и-hover.md` (bug) | Нет cursor pointer и видимого hover/focus ring у кликабельного, включая overlay | `94352ef45` (#833) |
| `.scratch/worfy-polish/issues/56-первый-epic-надпись-у-minimap-вместо-панели.md` | Панель «Plan your first epic» посреди Canvas закрывала работу | `6c10a4a80` (#1363) |
| `.scratch/worfy-windows/issues/96-команда-меню-до-монтирования-react-теряется.md`, `…/103-остатки-ревью-pr-753-подписчики-меню-и-сброс-на-навигации.md` | «Settings…» из меню сразу после показа окна терялся: команда приходила до подписки React | `952b4fdbb` (#753), `3062579b0` (#774) |

### 12.2. Сколько fix-коммитов

- Коммитов, которые тронули файлы примитивов: 147 (команда П20; репозиторий сливает PR одним коммитом, так что это примерно 147 PR).
- Из них по чтению заголовков 17 — исправления поведения overlay: 15 коммитов из таблицы выше плюс `1b4009c5c` (test места toast-а) и `ad9919ac2` (доставка toast-а, не сам компонент). Остальное — новые функции.
- Поиск по ключевым словам (`tooltip|popover|menu|dialog|toast|palette|focus|escape|z-index|…`) находит 349 из 1 848 коммитов. Он шумный: «focus» — это ещё и название focus mode, «menu» — меню приложения. Как оценка багов не годится.
- Повторяющиеся темы: место и перекрытие (Select, selection toolbar ×4, toast-ы, панель первого Epic) и порядок слоёв и клавиш под focus mode (×3).

## 13. Объём работы: что придётся тронуть

- Реализаций: 19 dialog, 11 popover, 6 menu, 5 context menu, 1 hover card, 1 toast-система, 1 palette, 1 `Select`, 1 slash menu.
- Мест вызова: 77 (сумма столбца в сводке без toast-ов), плюс 57 вызовов `showToast(` и 335 `title=`, если переводить и tooltip.
- Инфраструктура, без которой замена не сработает:
  - три модульных guard-а (`settings-window.ts:84-144`, `shortcuts-window.ts:58-86`, `guide/store.ts:88-129`);
  - 6 мест, которые ищут открытые popup-ы по роли;
  - потребители `defaultPrevented` и одна дыра в `MessageInput.tsx:344`;
  - шкала z-index;
  - разметка `data-toast-keep-out` у новых слоёв;
  - классы `nodrag` / `nopan` / `nowheel` у всего, что остаётся внутри Canvas.
- Test-ы: 105 файлов unit и contract импортируют модули примитивов (команда П22). 86 из 158 e2e spec-ов ищут их по роли или `data-testid` (команда П23, грубая оценка).
- Native вне досягаемости web-библиотеки: menu bar, 8 диалогов main, OS notification.

## Приложение: команды подсчёта

Все команды — из корня репозитория.

- П1. `.tsx` и `.css`: `find src/renderer -name '*.tsx' | wc -l` → 207; `find src/renderer -name '*.tsx' -print0 | xargs -0 cat | wc -l` → 40 994; `find src/renderer -name '*.css' | wc -l` → 42; то же с `cat` → 12 478.
- П2. Portal: `grep -rn "createPortal(" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l` → 34 (33 файла, `grep -rln`).
- П3. `role="dialog"`: `grep -rnE 'role="dialog"' src/renderer --include='*.tsx' | grep -v '\.test\.' | wc -l` → 38 (32 элемента, 5 строк-селекторов, 1 комментарий). `role="alertdialog"` → 4.
- П4. `aria-modal`: `grep -rnE 'aria-modal="true"' src/renderer --include='*.tsx' | grep -v '\.test\.' | wc -l` → 20.
- П5. `role="menu"`: `grep -rnE "role(=\"|: ')menu(\"|')" src/renderer --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l` → 18 (11 элементов, 6 строк-селекторов, 1 комментарий).
- П6. Inline-сообщения: подсчёт `grep -rnE "role=[\"{'\`]+(alert|status)[\"'\`}]" src/renderer --include='*.tsx' --include='*.ts' | grep -v '\.test\.'` по каждой роли → `alert` 99, `status` 39.
- П7. Native-меню и диалоги: `grep -rnE "Menu\.buildFromTemplate|\.popup\(|Menu\.setApplicationMenu|new Menu\(|new MenuItem\(|context-menu|contextmenu|setContextMenu|Tray" src/main src/preload --include='*.ts' | grep -v '\.test\.'` → 1 строка (`menu.ts:165`); `grep -rnE "dialog\.(show[A-Za-z]+)|new Notification\(" src/main src/preload --include='*.ts' | grep -v '\.test\.'` → 8 диалогов и 1 notification.
- П8. `title=`: `grep -rnoE '(^|[^A-Za-z_.-])title=' src/renderer --include='*.tsx' | grep -v '\.test\.' | wc -l` → 335; с `-l` → 105 файлов.
- П9. `title=` по тегу: `find src/renderer -name '*.tsx' ! -name '*.test.tsx' -print0 | xargs -0 perl -0777 -ne 'while (/(?<![\w.-])title=/g) { my $pos = pos($_); my $pre = substr($_, 0, $pos); if ($pre =~ /.*<([A-Za-z][\w.]*)/s) { print "$1\n" } }' | sort | uniq -c | sort -rn`. `writeAction(`: `grep -rn "writeAction(" src/renderer --include='*.tsx' | grep -v '\.test\.' | wc -l` → 46.
- П10. Вызовы dialog: для каждого имени `grep -rnE "<Имя( |/|>|$)" src/renderer --include='*.tsx' | grep -v '\.test\.'` (SettingsDialog, ShortcutsOverlay, GuideWindow, ChangeAddressDialog, RemoveMachineDialog, StartAutopilotModal, StartNowModal, FirstRun, ProjectSettings, MachineChoice, RemoveProject, ConnectProject, FolderBrowser, EditProfile, SendAllDialog, MigrationForm, CodexHooksStep, BrowserProfiles, LinkMachineDialog, ImageOverlay) → 23.
- П11. `Select` и `<select>`: `grep -rnE "<Select(<[^>]+>)?([ >]|$)" src/renderer --include='*.tsx' | grep -v '\.test\.' | grep -v "^src/renderer/theme/Select.tsx" | wc -l` → 18 (13 файлов); `grep -rnE "<select[ >]" src/renderer --include='*.tsx' | grep -v '\.test\.'` → 1.
- П12. Keydown: `grep -rnE "(window|document|globalThis)\.addEventListener\(\s*'keydown'" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l` → 30; с `.*true\)` в конце шаблона → 10.
- П13. Нажатие снаружи и фокус: `grep -rnE "addEventListener\(\s*'(mousedown|pointerdown)'" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -E "document\.|window\.|globalThis\." | wc -l` → 21; то же для `'focusin'` без второго фильтра → 8.
- П14. z-index: `grep -rnoE "z-index: ?-?[0-9]+|zIndex: ?-?[0-9A-Z_]+" src/renderer --include='*.css' --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l` → 79.
- П15. Позиционирование: `grep -rn "getBoundingClientRect" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l` → 52.
- П16. Backdrop: `grep -rlE "rgba\(0, 0, 0, 0\.25\)" src/renderer --include='*.ts' --include='*.tsx' --include='*.css' | wc -l` → 17.
- П17. Toast: `grep -rn "showToast(" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v "^src/renderer/toast/" | wc -l` → 57 (28 файлов); `dismissToast(` → 12; импорт store: `grep -rlE "from '(\.\./)+toast/toasts'|from '\./toasts'" src/renderer --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v '^src/renderer/toast/' | wc -l` → 27; виды: `grep -rnoE "kind: '(info|success|error|action)'" …`.
- П18. Native `<dialog>`, Popover API, anchor positioning: `grep -rnE "showModal\(|<dialog|popover=|showPopover|anchor-name|position-anchor" src/renderer --include='*.ts' --include='*.tsx' --include='*.css' | grep -v '\.test\.'` → одно совпадение, и это prop React `popover={popover}` (`QuoteComments.tsx:782`); API не используется.
- П19. Библиотеки: `ls -d node_modules/@radix-ui node_modules/@floating-ui node_modules/cmdk node_modules/sonner node_modules/vaul` → нет ни одной; зависимости — `package.json:28-77`.
- П20. Коммиты по файлам примитивов: из `src/renderer`, `git log --no-merges --format='%h' -- <список> | sort -u | wc -l` → 147. Список: `settings/SettingsDialog.tsx settings/settings-window.ts shortcuts/ShortcutsOverlay.tsx shortcuts/shortcuts-window.ts guide/GuideWindow.tsx guide/store.ts machines/ChangeAddressDialog.tsx machines/MachineDialogs.tsx machines/machine-dialogs.ts machines/LinkMachineDialog.tsx autopilot/StartAutopilotModal.tsx autopilot/StartNowModal.tsx autopilot/autopilot-modal.css shell/FirstRun.tsx shell/ProjectSettings.tsx projects/RemoveProject.tsx projects/ConnectProject.tsx projects/FolderBrowser.tsx projects/EditProfile.tsx harness/MigrationForm.tsx harness/CodexHooksStep.tsx browser/BrowserProfiles.tsx session/MessageAttachments.tsx pr-inbox/DraftThread.tsx canvas/session-history.tsx canvas/use-dismiss.ts canvas/overlays/ArchivePopover.tsx canvas/overlays/TrashPopover.tsx canvas/overlays/archive.css canvas/overlays/trash.css canvas/overlays/CanvasMenu.tsx canvas/overlays/BindingDrop.tsx canvas/actions/action-menu.ts canvas/actions/actions.css session/HistoryPopover.tsx session/composer/Queue.tsx session/composer/Pickers.tsx session/composer/Modes.tsx session/NewSessionVendor.tsx session/SlashMenu.tsx session/QuoteCommentParts.tsx session/QuoteComments.tsx session/quote-comments.css shell/ProjectSwitcher.tsx update/UpdateChip.tsx update/WhatsNew.tsx theme/Select.tsx theme/select.css toast palette find/CanvasFind.tsx session/SessionFind.tsx session/transcript-find.ts focus getting-started/GettingStartedPanel.tsx work-track/SpanPanel.tsx shell/sidebar/AdrSection.tsx canvas/nodes/BrowserSidebar.tsx`.
- П21. Ключевые слова по всему log: `git log --oneline -i -E --grep='tooltip|popover|menu|dropdown|context menu|dialog|modal|toast|palette|focus|escape|\besc\b|outside click|click outside|z-index|clipped|overflow|keyboard' | wc -l` → 349; всего `git log --oneline | wc -l` → 1 848. Ticket-ы: `ls .scratch/*/issues/*.md | wc -l` → 969; `ls -d .scratch/*/issues | wc -l` → 41; `grep -lE '^Type: bug' .scratch/*/issues/*.md | wc -l` → 83.
- П22. Unit и contract test-ы: `grep -rlE "renderer/(theme/Select|toast/|palette/|find/|session/SessionFind|session/transcript-find|settings/SettingsDialog|settings/settings-window|shortcuts/|guide/store|guide/GuideWindow|focus/|canvas/overlays/|canvas/actions/action-menu|canvas/session-history|canvas/use-dismiss|session/composer/(Modes|Pickers|Queue)|session/SlashMenu|session/QuoteComment|session/HistoryPopover|session/NewSessionVendor|shell/ProjectSwitcher|update/(UpdateChip|WhatsNew)|machines/(ChangeAddressDialog|LinkMachineDialog|MachineDialogs)|autopilot/(StartAutopilotModal|StartNowModal)|projects/(RemoveProject|ConnectProject|FolderBrowser|EditProfile)|harness/(MigrationForm|CodexHooksStep)|browser/BrowserProfiles|shell/(FirstRun|ProjectSettings)|session/MessageAttachments|pr-inbox/DraftThread|work-track/SpanPanel|getting-started/GettingStartedPanel)" test/unit test/contract | wc -l` → 105.
- П23. E2e: `ls test/e2e/*.spec.ts | wc -l` → 158. Spec-и с `getByRole('dialog|menu|menuitem|menuitemradio|menuitemcheckbox|option|listbox|alertdialog|combobox')` или с одним из `data-testid` примитивов (`command-palette`, `palette-option`, `toasts`, `modes-menu`, `quote-menu`, `binding-menu`, `trash-popover`, `archive-popover`, `history-popover`, `settings`, `shortcuts`, `guide`, `start-autopilot`, `start-now`, `image-overlay`, `project-switcher-menu`, `new-session-vendor`, `effort-popover`, `queue-list`, `adr-panel`, `work-track-panel`, `getting-started`, `focus-mode`, `session-find`, `slash-menu`, `link-machine`, `remove-project`, `folder-browser`, `edit-profile`, `change-address-dialog`, `remove-machine-dialog` и др.) — объединение через `grep -lE` → 86.
