# 02 — Окно Settings: диалог с разделами, «Settings…» в меню и Cmd/Ctrl+,

Type: task
Status: done 2026-10-10
PR: #209
Branch: worfy-ui/02
Blocked by: —
Source: решение владельца 2026-10-09: 2 (Settings — модальный диалог внутри приложения; открывается по Cmd/Ctrl+, и пунктом меню «Settings…»; слева разделы, справа содержимое; разделы General, Health, Shortcuts, Machines; разделы других Epic-ов подключаются) ([spec.md](../spec.md), «Как устроено», «Окно Settings» и «Меню → окно»); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (каналы `local`); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенный PR); [worfy-terminal-ai 08](../../worfy-terminal-ai/issues/08-settings-terminal-ai.md) — раздел «Terminal AI» ждёт этот Ticket и Ticket 08 (Select)

## Что происходит

- Окна настроек самого worfy нет. Меню — `menuTemplate` (`src/main/menu.ts:11-34`): на macOS роль
  `appMenu` (`:13`), пункта Settings в ней нет. Своих `accelerator` в `src/` нет (grep
  `accelerator`, `CmdOrCtrl`).
- Есть только окно одного Project-а — «Project settings…» (`src/renderer/shell/sidebar/ProjectsSection.tsx:259`,
  `src/renderer/shell/ProjectSettings.tsx`). Оно хранит шаблоны действий в
  `<папка данных>/<id Project-а>/settings.json` (`src/main/projects/settings.ts:1-2`,
  `src/main/projects/store.ts:123-126`).
- Образец диалога поверх окна — First run (`src/renderer/shell/FirstRun.tsx:190`, портал в
  `document.body` — `:242`). Вид — `docs/design/F-SPEC.md:102`: по центру, подложка чёрного 25 %, ширина 720 px (не шире окна минус
  32 px), высота не больше окна минус 48 px, поверхность, рамка 1 px, радиус 10 px, тень Node-а.
  State — zustand-store `useFirstRun` (`src/renderer/shell/first-run-store.ts:17`, открытие `:38`,
  закрытие `:44`). Диалог смонтирован в `src/renderer/shell/AppShell.tsx:53-54`.
- Части оболочки подключаются файлом: `collectExtensions` и `import.meta.glob`
  (`src/renderer/shell/registry.ts:4-15`, `:32-37`; `src/renderer/shell/Sidebar.tsx:3-6`).
- Пункт меню, который меняет окно, сообщает о себе событием IPC: View ▸ Show Minimap
  (`src/main/menu.ts:29`, `:38`) → `view.changed` всем окнам (`src/main/ipc/view.ts:15-18`). e2e
  нажимает пункт меню по id без аргументов — `item.click()` (`test/e2e/pin-tags.spec.ts:99-103`),
  потому что Playwright не нажимает ускорители меню. Electron зовёт обработчик пункта как
  `click(menuItem, focusedWindow, event)`; при `item.click()` без аргументов окна нет, и остаётся
  окно в фокусе, а фокус в прогоне e2e не гарантирован: `test/e2e/linked-notify.spec.ts:79-88` сам
  снимает фокус со всех окон и ждёт, пока `BrowserWindow.getFocusedWindow()` вернёт `null`. Minimap
  это не мешает: он шлёт всем окнам.
- Диалоги worfy — порталы в `document.body` с `z-index` от 90 до 101 (First run — `FirstRun.tsx:32`,
  палитра — `src/renderer/palette/CommandPalette.tsx:27`, `:43`). Режим фокуса закрывается по Esc, который
  дошёл до `window` без `preventDefault` (`src/renderer/focus/FocusMode.tsx:232-238`).
- Команды палитры — `src/renderer/palette/commands.ts`; «First-run checks» — в группе View
  (`commands.ts:184-193`).
- Переключатель есть только свой у секции Machines — `SectionSwitch` (`role="switch"`,
  `src/renderer/shell/sidebar/MachinesSection.tsx:122-140`, стили `:30-50`).
- Версию приложения отдаёт канал `app.version` (`src/shared/ipc/app.ts:10`).

## Что делаем

1. **Окно** — `src/renderer/settings/SettingsDialog.tsx` (новый) и `src/renderer/settings/settings.css`
   (новый). Модальный диалог по центру окна, вид — как First run (F-SPEC, «First run», «Place»).
   - Слева колонка разделов 180 px: строки `ListRow` (`src/renderer/theme/primitives.tsx:66`),
     выбранная — `selected`; ↑ и ↓ ходят по разделам.
   - Справа — заголовок раздела (20 px, semibold) и его содержимое с прокруткой.
   - `role="dialog"`, `aria-modal="true"`, имя «Settings»; Esc и кнопка «Close» закрывают; фокус
     уходит в окно и возвращается туда, где был. Esc окно забирает себе: `preventDefault` и
     `stopPropagation`, — иначе он закроет и режим фокуса под окном.
   - Окно — портал в `document.body`, как First run, `z-index` 110 — выше остальных диалогов. Над
     режимом фокуса оно встаёт после Ticket-а 10: тот уводит слой фокуса в свой stacking context
     ниже диалогов приложения.
2. **Разделы по файлам.** Раздел — `src/renderer/settings/<Name>Section.tsx`: компонент по
   умолчанию, `export const order`, `export const title`. `src/renderer/settings/sections.ts`
   (новый) собирает их через `import.meta.glob('./*Section.tsx')`; файл без компонента, `order` или
   `title` — ошибка при импорте, как в `collectExtensions`. Добавление раздела окно не правит.
   Порядок: General 10, Health 20 (Ticket 06), Shortcuts 30 (Ticket 11), Machines 40 (Ticket 05);
   разделы других Epic-ов — от 50 (Terminal AI — Ticket 08 Epic-а `worfy-terminal-ai`, файл
   `src/renderer/settings/TerminalAiSection.tsx`). id раздела — имя файла без расширения.
3. **Общие элементы разделов** — `src/renderer/settings/controls.tsx` (новый):
   - `SettingRow` — подпись, пояснение под ней (12 px, secondary) и любой элемент справа: ползунок,
     переключатель, `Select` Ticket-а 08;
   - `SettingSwitch` — `role="switch"`, `aria-checked`, `disabled`; вид — как `SectionSwitch`.

   Ими пользуются Ticket-ы 03 и 05 и Ticket 08 `worfy-terminal-ai` (переключатели — `SettingSwitch`,
   выбор модели — `Select` в `SettingRow`).
4. **Раздел General** — `src/renderer/settings/GeneralSection.tsx` (новый, `order` 10): пока одна
   строка «Version» — значение `app.version` моноширинным шрифтом. Ползунок масштаба добавит
   Ticket 03.
5. **Как открыть.**
   - Пункт меню «Settings…» с `CmdOrCtrl+,` и экспортируемым id для test-ов. На macOS — в меню
     приложения после «About worfy»: роль `appMenu` раскрывается в явный список её же пунктов. На
     Windows — первым пунктом File: роль `fileMenu` раскрывается так же.
   - Клик по пункту шлёт событие `menu.command` со значением `settings` окну из аргумента
     обработчика (`click(menuItem, window)`); нет окна — `BrowserWindow.getFocusedWindow()`; нет и его
     — ничего. Домен — `src/shared/ipc/menu.ts` (новый), канал `local`, значения — перечисление;
     Ticket 10 добавит `toggleSidebar`, Ticket 11 — `shortcuts`.
   - Helper e2e `clickMenuItem(app, id)` — `test/e2e/menu.ts` (новый): находит пункт по id и зовёт
     `item.click(undefined, <первое окно>)`, то есть передаёт окно, как настоящий клик. Им пользуются
     e2e Ticket-ов 03, 05, 10, 11 и 12; `test/e2e/helpers.ts` не меняется.
   - Пункт палитры «Settings…» в группе View (`src/renderer/palette/commands.ts`), с Project-ом и
     без.
   - State окна — `src/renderer/settings/settings-window.ts` (новый, zustand, как
     `first-run-store.ts`): `openSettings(sectionId?)`, `closeSettings()`; подписка на `menu.command`.
   - Окно смонтировано в `src/renderer/shell/AppShell.tsx` рядом с `<FirstRun />`.
6. Окно на Project-е Linked machine-а показывает Settings своей Machine: каналы `local` идут на
   свою машину (`src/renderer/ipc.ts:5-11`).

Решено в Ticket-е, подтверждено владельцем 2026-10-09: «Settings…» на Windows — первый пункт File; General до
Ticket-а 03 показывает версию; «Settings…» есть и в палитре.

**Не входит:** содержимое разделов — масштаб (Ticket 03), Machines (05), Health (06), Shortcuts
(11); раздел «Terminal AI» — Epic `worfy-terminal-ai`; обработчик Cmd/Ctrl+, в renderer — только
ускоритель меню; запоминание последнего открытого раздела.

## Готово, когда

- [x] Unit `test/unit/settings-dialog.test.tsx` (новый): два раздела-заглушки с `order` 20 и 10 —
  в списке по `order`; клик и ↑/↓ меняют раздел; Esc и «Close» закрывают и возвращают фокус;
  `openSettings('<id>')` открывает нужный раздел; модуль без `title` — ошибка с именем файла.
- [x] Unit, тот же файл: `SettingSwitch` — `role="switch"`, `aria-checked`; клик зовёт `onChange`
  с обратным значением; `disabled` — не зовёт.
- [x] Contract `test/contract/view-menu.test.ts`: на `darwin` в меню приложения есть «Settings…» с
  `CmdOrCtrl+,`, прежние пункты роли `appMenu` на месте; на `win32` «Settings…» — первый пункт File,
  выход из приложения на месте; клик с окном шлёт этому окну `menu.command` со значением `settings`;
  клик без окна — окну в фокусе, без фокуса — никому.
- [x] Unit `test/unit/palette-commands.test.tsx`: «Settings…» есть в группе View с Project-ом и без
  и открывает окно.
- [x] e2e `test/e2e/settings.spec.ts` (новый): `clickMenuItem` по id «Settings…» открывает Settings,
  General показывает версию; Esc закрывает; «Settings…» из палитры открывает снова. Снимки
  `settings-general` в светлой и тёмной теме (`snapshotThemes`).
- [ ] (вручную) `pnpm dev`: ⌘, открывает Settings на Canvas, в Session, в поле ввода Session и при
  фокусе в Terminal Node; Esc закрывает. Как проверить: окно worfy.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.
- [ ] Windows-ПК: gate full — строка вердикта и код выхода в PR (платформенный PR: `src/main/menu.ts`
  ветвится по системе; spec, «Соглашения», «Платформенный PR»).

## Тесты

Сначала падающий test — unit «два раздела в списке по `order`»: окна нет. Затем contract меню.

Ускоритель `CmdOrCtrl+,` Playwright не нажимает: e2e зовёт пункт меню по id через `clickMenuItem`,
клавишу проверяет ручной пункт. В «Итог» — как подключить раздел (экспорты файла) и как test открывает Settings: этого ждёт
Ticket 08 `worfy-terminal-ai`.

## Где в коде

- `src/shared/ipc/menu.ts` (новый)
- `src/main/menu.ts`
- `src/renderer/settings/SettingsDialog.tsx` (новый)
- `src/renderer/settings/settings-window.ts` (новый)
- `src/renderer/settings/sections.ts` (новый)
- `src/renderer/settings/controls.tsx` (новый)
- `src/renderer/settings/settings.css` (новый)
- `src/renderer/settings/GeneralSection.tsx` (новый)
- `src/renderer/shell/AppShell.tsx`
- `src/renderer/palette/commands.ts`
- `test/unit/settings-dialog.test.tsx` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/contract/view-menu.test.ts`
- `test/e2e/settings.spec.ts` (новый)
- `test/e2e/menu.ts` (новый)

## Итог

Сделано (PR #209, ветка `worfy-ui/02`).

**Окно.** `src/renderer/settings/SettingsDialog.tsx` + `settings.css`: модальный диалог как First run
(720 px, не шире окна минус 32 px, высота 520 px, не выше окна минус 48 px, подложка чёрного 25 %,
радиус 10 px, тень Node-а), портал в `document.body`, `z-index` 110. Слева колонка 180 px на
surface raised: подпись «Settings» (11 px, semibold, muted) и строки `ListRow`; справа заголовок
раздела (20 px, semibold), содержимое с прокруткой; внизу полоса с рамкой сверху и кнопкой «Close»
(общая кнопка действия, primary). `role="dialog"`, `aria-modal="true"`, имя «Settings»
(`aria-labelledby` на подпись колонки). При открытии фокус — на выбранной строке раздела, ↑/↓ ходят по
разделам и несут фокус, у концов списка останавливаются. Esc (если его не забрал элемент внутри —
`defaultPrevented`) и «Close» закрывают, фокус возвращается туда, где был. Esc — `preventDefault` и
`stopPropagation`: до `window` он не доходит, режим фокуса под окном остаётся. Tab и Shift+Tab ходят по
кругу внутри окна; нажатие на подложку фокус не забирает и окно не закрывает (как у First run).

**Как подключить раздел** (для Ticket-ов 03, 05, 06, 11 и Ticket-а 08 Epic-а `worfy-terminal-ai`):
файл `src/renderer/settings/<Name>Section.tsx` с тремя экспортами — компонент по умолчанию,
`export const order = <число>`, `export const title = '<Заголовок>'`. Окно файл не правит:
`sections.ts` собирает `./*Section.tsx` через `import.meta.glob` (`collectSections`); файл без
компонента, `order` или непустого `title` — ошибка с путём файла при загрузке renderer-а. id раздела —
имя файла без расширения (`GeneralSection`, `TerminalAiSection`). Строки раздела —
`SettingRow` (`label`, `description`, элемент справа — `children`) и `SettingSwitch` (`label` —
имя для экранного диктора, `checked`, `onChange(next)`, `disabled`) из `controls.tsx`.

**Как test открывает Settings.** Unit: `openSettings('<id>')` / `closeSettings()` из
`src/renderer/settings/settings-window.ts` и `SettingsDialogView` со своими разделами
(`collectSections({...})`, пример — `test/unit/settings-dialog.test.tsx`). e2e: `clickMenuItem(app,
'app.settings')` из `test/e2e/menu.ts` (id — `SETTINGS_MENU_ITEM_ID` из `src/main/menu.ts`; модуль
тянет Electron, поэтому в e2e id — строкой, а contract test сверяет её с константой); окно —
`window.getByRole('dialog', { name: 'Settings' })`, раздел — кнопка в
`getByRole('navigation', { name: 'Settings sections' })`.

**Меню.** «Settings…» с `CmdOrCtrl+,`, id `app.settings`. macOS: меню приложения (`label: app.name`)
— явный список пунктов роли `appMenu` (About, Services, Hide, Hide Others, Show All, Quit) с
«Settings…» после About между разделителями. Не macOS: File — «Settings…», разделитель, Quit (явный
список роли `fileMenu`). Клик шлёт `menu.command` = `settings` окну из аргумента обработчика, без
него — окну в фокусе, без фокуса — никому (`sendMenuCommand`). Домен `src/shared/ipc/menu.ts`:
событие `menu.command`, доступ `local`, значение — перечисление `MENU_COMMANDS` (пока `settings`;
Ticket 10 добавит `toggleSidebar`, Ticket 11 — `shortcuts`). Подписка — `followMenuCommands()` в
эффекте `SettingsDialog`; окно на Project-е Linked machine-а слушает свой main (канал `local`), раздел
General зовёт `app.version` — тоже `local`, своя машина.

**Палитра.** «Settings…» в группе View, с Project-ом и без (`id: settings`, ключи settings,
preferences, options). **General** — строка «Version» со значением `app.version` моноширинным
шрифтом; при ошибке канала — «unknown» с причиной в подсказке.

**Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (172 файла, 3340 test-ов);
`GATE_SCOPE=all` gate fast — exit 0, «[gate] зелено (fast)»; CI PR #209 — check pass. e2e
`test/e2e/settings.spec.ts` — 2 passed: второй test сверяет явный список пунктов меню с тем, что Electron
строит из голой роли (`appMenu` на macOS, `fileMenu` на остальных) — пункт, забытый в списке, его
краснит (мутант без `unhide` — красный). На macOS сверена роль `appMenu`; ветку `fileMenu` тот же
test проверит в gate full на Windows-ПК. Мутанты (убрать `stopPropagation`, убрать возврат фокуса,
меню без окна из аргумента) — каждый краснит свой test. `GATE_SCOPE=all` gate full на macOS
(на коммите 6ecaaa8, под замком `/tmp/worfy-e2e.lock`) — exit 0, «[gate] зелено (full): worfy/.:lint
worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package».

**Проверки раунда 2** (после rebase на main 558dd67, коммит 5565f27): `pnpm lint`, `pnpm typecheck`,
`pnpm test` — exit 0 (181 файл, 3656 test-ов); gate fast — exit 0, «[gate] зелено (fast)»;
`GATE_SCOPE=all` gate full под замком — exit 0, «[gate] зелено (full): worfy/.:lint
worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package»; CI PR #209 — check pass.
e2e `test/e2e/settings.spec.ts` — 3 passed: третий test на Project-е с Canvas проверяет, что при
открытом Settings ⌘K, ⌘F и ⌘↩ ничего не делают (и при фокусе на странице), Tab возвращает фокус, Esc
закрывает окно, после закрытия те же сочетания работают, а в режиме фокуса «Settings…» не
открывается. Мутанты раунда: 13 для unit и contract test-ов (перехват клавиш, возврат фокуса, слой
выше окна, `defaultPrevented`, режим фокуса, уничтоженное окно в меню) и 2 для e2e (перехват
выключен — ⌘K открывает палитру; без проверки режима фокуса — окно открывается под ним) — все
красные. Из `src/` раунд менял только `src/renderer/settings/` (`SettingsDialog.tsx`,
`settings-window.ts`, `settings.css`); `src/main/menu.ts` и `src/shared/ipc/menu.ts` не менялись.

**Снимки** (светлая и тёмная тема, Playwright, `snapshotThemes`): окно с General —
[светлая](../evidence/02-settings-general-light.png), [тёмная](../evidence/02-settings-general-dark.png);
фокус клавиатуры на кнопке «Close» после Tab — [светлая](../evidence/02-settings-focus-light.png),
[тёмная](../evidence/02-settings-focus-dark.png); «Settings…» в палитре —
[светлая](../evidence/02-settings-palette-light.png), [тёмная](../evidence/02-settings-palette-dark.png).
Разделов пока один (General): Health, Shortcuts, Machines приходят своими Ticket-ами.

**Окно модальное (доработка после ревью, раунд 2).** Пока Settings открыт, приложение под ним не
получает ни клавиш, ни фокуса. Причина: сочетания приложения слушают `window` (⌘K палитры, ⌘F
поиска по Canvas, ⌘↩ режима фокуса, Esc режима фокуса, клавиши Canvas), и обработчик на самом
диалоге их не останавливал: ⌘K открывал палитру под подложкой и уводил фокус, после чего Esc окно
уже не закрывал. Теперь три слушателя в `src/renderer/settings/settings-window.ts`, заведённые при
загрузке модуля — раньше любого слушателя компонента:
- `window`, фаза capture: клавиша при фокусе вне окна (на странице, когда сфокусированный элемент
  исчез) ни до кого не доходит; Esc закрывает окно, Tab и Shift+Tab возвращают фокус в окно.
  Сочетание с ⌘ или Ctrl, нажатое внутри окна, не доходит ни до одного слушателя приложения;
  `preventDefault` при этом не зовётся, так что копирование, вставка и отмена в поле ввода и
  ускорители меню работают.
- `document`, фаза bubble: остальные клавиши, нажатые внутри окна, доходят до его элементов и
  останавливаются перед слушателями на `window`.
- `focusin`: фокус, ушедший на что-то под окном (диалог, открывшийся ниже, — First run с `z-index`
  90), возвращается на последний сфокусированный элемент окна.

Слой выше окна — корневой элемент в `body` с `z-index` больше 110 (`SETTINGS_LAYER`, теперь задан в
TS и ставится inline) — клавиши и фокус сохраняет: это открытый список Select Ticket-а 08 (3000) и
диалог, который раздел откроет поверх Settings. Esc внутри окна по-прежнему обрабатывает само окно в
фазе bubble и пропускает нажатие, которое забрал элемент внутри (`defaultPrevented`), — Select
закрывает свой список первым. Выбран перехват клавиш, а не `inert` на корне приложения: `inert`
снимает фокус и клики, но слушатели на `window` продолжают получать клавиши. ⌘K при открытом
Settings палитру не открывает (а не открывает её поверх): палитра — команды приложения под окном, и
два слоя с собственным Esc давали бы тот же спор о порядке закрытия.

**Режим фокуса.** Пока режим фокуса на экране (слой `.w-focus`, `z-index` 1000), `openSettings()`
ничего не делает — ни из меню, ни из палитры: окно открылось бы невидимым под ним. Обратное
направление закрыто перехватом ⌘↩. Порядок слоёв задаст Ticket 10; тогда проверку в `openSettings`
нужно снять.

**Долг для Ticket-а 12.** У общей кнопки действия `.w-action`
(`src/renderer/canvas/actions/actions.css`) нет своего `:focus-visible`: на «Close» видна рамка
браузера, а не акцентная 2 px, как у `ListRow`. Так у всех общих кнопок действия.

**Известные границы перехвата.** Слушатель приложения в фазе capture на `window` всё же получает
обычную клавишу (без ⌘ и Ctrl), нажатую внутри окна: остановить его, не отняв клавишу у самого окна,
нельзя. Сейчас таких слушателей три, и опасен один случай: если меню привязок Binding открыто под
Settings, первый Esc закроет его, второй — Settings (`BindingDrop.tsx:192-198`). Клик мышью внутри
Settings по-прежнему снимает активность с активного Node-а под окном (слушатель `pointerdown` в
`Canvas.tsx`) — так же ведёт себя First run.

**Не проверено:**
- Нативное меню macOS (пункт «Settings…» в меню worfy) Playwright не снимает: снимков меню нет;
  структуру меню проверяет contract test, клик по id — e2e.
- (вручную) ⌘, на Canvas, в Session, в поле ввода Session и в Terminal Node — шаг владельца.
- Не проверено: gate full на Windows-ПК — шаг владельца / Windows Session.

**Решено без владельца, подтвердить:**
- Esc закрывает окно, только если элемент внутри его не забрал (`defaultPrevented`) — так открытый
  список Select Ticket-а 08 закроется первым.
- Подложка окно не закрывает и фокус не забирает (как First run); Tab ходит по кругу внутри окна.
- `openSettings()` без id открывает закрытое окно на первом разделе (General), открытое оставляет на
  месте; id, которого нет, — первый раздел.
- Высота окна постоянная, 520 px (не выше окна минус 48 px), чтобы окно не прыгало между разделами.
- Пункт «Settings…» в File на Linux тоже (не macOS — одна ветка), как на Windows.
- Пока Settings открыт, ⌘K, ⌘F, ⌘↩ и остальные сочетания приложения с ⌘ или Ctrl ничего не делают
  (палитра не открывается и поверх окна).
- В режиме фокуса «Settings…» не открывается (и режим фокуса не закрывает) — до Ticket-а 10.
  **Изменено владельцем 2026-10-10:** «Settings…» должно открываться и в режиме фокуса — окно
  поверх, режим фокуса под ним сохраняется. Делает Ticket [13](13-settings-в-режиме-фокуса.md),
  после Ticket-а 10.
- Сочетание с ⌘ или Ctrl внутри окна не доходит и до обработчиков самих разделов (только действие
  клавиши по умолчанию): разделу, которому нужно своё сочетание, понадобится исключение в перехвате.

### Gate оркестратора (2026-10-10)

- Круг 1 — `REJECTED` ([комментарий в PR #209](https://github.com/IDSAD-XL/worfy/pull/209#issuecomment-6092144261)): [med] Esc и ловушка Tab висели только на диалоге — сочетания со слушателями на `window` работали под окном (⌘K открывал палитру под подложкой и уводил фокус, ⌘F, ⌘Enter); мелкие — Settings в режиме фокуса, снимок-дубль, два выживших мутанта.
- Круг 2 — `VERIFIED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/209#issuecomment-6092659393)), доработка `673757a..9345f79`, в `src/` — только три файла `src/renderer/settings/`. Долги:
  - [low] `src/renderer/settings/settings-window.ts:116` — Ctrl+Alt (AltGr) считается сочетанием приложения: символ в поле Settings вводится, но `keydown` до обработчика поля не доходит; проверить на Windows-раскладке (Ticket 12).
  - [low] `settings-window.ts:106`, `:119`, `:134` — слой выше окна пропускает и сочетания приложения; достижимо с первым диалогом раздела поверх Settings.
  - [low] `src/renderer/canvas/overlays/BindingDrop.tsx:192-198` — меню Binding остаётся поверх Settings (z-index 2000): первый Esc закрывает его, второй — окно.
  - [low] `SettingsDialog.tsx:85-91` — после клика по тексту в окне Shift+Tab не сдвигает фокус.
  - [low] шесть выживших мутантов (`SettingsDialog.tsx:97`, `:34`, `:42-43`; `settings-window.ts:91`, `:95`): потерю слоя окна не замечает ни один test.
- Windows-ПК: полный прогон на `3e6b2cb` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/209#issuecomment-6091488849)) и на финальном коде `02e6f27` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/209#issuecomment-6093140983)): install, lint, typecheck — 0; `test` — без новых падений относительно main `f129870`; свои test-ы PR — 38 passed. На ПК не запускались `test:e2e` и `test:package`; Ctrl+, / Esc / Tab / AltGr вживую — владелец вместе с ручными пунктами `worfy-windows` 11.
- Мерж: rebase на `e0b04d1` (код PR тот же, что на `02e6f27`), `GATE_SCOPE=all gate full` — код 0 с первого прогона, CI зелёный, CLEAN, влит `baf7a14`.
