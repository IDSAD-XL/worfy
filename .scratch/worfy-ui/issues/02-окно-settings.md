# 02 — Окно Settings: диалог с разделами, «Settings…» в меню и Cmd/Ctrl+,

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-09: 2 (Settings — модальный диалог внутри приложения; открывается по Cmd/Ctrl+, и пунктом меню «Settings…»; слева разделы, справа содержимое; разделы General, Health, Shortcuts, Machines; разделы других Epic-ов подключаются) ([spec.md](../spec.md), «Как устроено», «Окно Settings» и «Меню → окно»); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (каналы `local`); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенный PR); PR #202, Ticket 08 Epic-а `worfy-terminal-ai` — его раздел «Terminal AI» ждёт этот Ticket

## Что происходит

- Окна настроек самого worfy нет. Меню — `menuTemplate` (`src/main/menu.ts:11-34`): на macOS роль
  `appMenu` (`:13`), пункта Settings в ней нет. Своих `accelerator` в `src/` нет (grep
  `accelerator`, `CmdOrCtrl`).
- Есть только окно одного Project-а — «Project settings…» (`src/renderer/shell/sidebar/ProjectsSection.tsx:259`,
  `src/renderer/shell/ProjectSettings.tsx`). Оно хранит шаблоны действий в
  `<папка данных>/<id Project-а>/settings.json` (`src/main/projects/settings.ts:1-2`,
  `src/main/projects/store.ts:123-126`).
- Образец диалога поверх окна — First run (`src/renderer/shell/FirstRun.tsx:190`). Вид —
  `docs/design/F-SPEC.md:101`: по центру, подложка чёрного 25 %, ширина 720 px (не шире окна минус
  32 px), высота не больше окна минус 48 px, поверхность, рамка 1 px, радиус 10 px, тень Node-а.
  State — zustand-store `useFirstRun` (`src/renderer/shell/first-run-store.ts:17`, открытие `:38`,
  закрытие `:44`). Диалог смонтирован в `src/renderer/shell/AppShell.tsx:53-54`.
- Части оболочки подключаются файлом: `collectExtensions` и `import.meta.glob`
  (`src/renderer/shell/registry.ts:4-15`, `:32-37`; `src/renderer/shell/Sidebar.tsx:3-6`).
- Пункт меню, который меняет окно, сообщает о себе событием IPC: View ▸ Show Minimap
  (`src/main/menu.ts:29`, `:38`) → `view.changed` (`src/main/ipc/view.ts:15-18`). e2e нажимает пункт
  меню по id (`test/e2e/pin-tags.spec.ts:101`), потому что Playwright не нажимает ускорители меню.
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
     уходит в окно и возвращается туда, где был.
   - Окно — поверх всего, в том числе поверх режима фокуса (его слой — `z-index: 1000`,
     `src/renderer/focus/focus.css:4-13`).
2. **Разделы по файлам.** Раздел — `src/renderer/settings/<Name>Section.tsx`: компонент по
   умолчанию, `export const order`, `export const title`. `src/renderer/settings/sections.ts`
   (новый) собирает их через `import.meta.glob('./*Section.tsx')`; файл без компонента, `order` или
   `title` — ошибка при импорте, как в `collectExtensions`. Добавление раздела окно не правит.
   Порядок: General 10, Health 20 (Ticket 06), Shortcuts 30 (Ticket 11), Machines 40 (Ticket 05);
   разделы других Epic-ов — от 50 (Terminal AI — Ticket 08 Epic-а `worfy-terminal-ai`, файл
   `src/renderer/settings/TerminalAiSection.tsx`). id раздела — имя файла без расширения.
3. **Общие элементы разделов** — `src/renderer/settings/controls.tsx` (новый):
   - `SettingRow` — подпись, пояснение под ней (12 px, secondary) и элемент справа;
   - `SettingSwitch` — `role="switch"`, `aria-checked`, `disabled`; вид — как `SectionSwitch`.

   Ими пользуются Ticket-ы 03 и 05 и Ticket 08 `worfy-terminal-ai`.
4. **Раздел General** — `src/renderer/settings/GeneralSection.tsx` (новый, `order` 10): пока одна
   строка «Version» — значение `app.version` моноширинным шрифтом. Ползунок масштаба добавит
   Ticket 03.
5. **Как открыть.**
   - Пункт меню «Settings…» с `CmdOrCtrl+,` и экспортируемым id для test-ов. На macOS — в меню
     приложения после «About worfy»: роль `appMenu` раскрывается в явный список её же пунктов. На
     Windows — первым пунктом File: роль `fileMenu` раскрывается так же.
   - Клик по пункту шлёт окну в фокусе событие `menu.command` со значением `settings`. Домен —
     `src/shared/ipc/menu.ts` (новый), канал `local`, значения — перечисление; Ticket 10 добавит
     `toggleSidebar`, Ticket 11 — `shortcuts`.
   - Пункт палитры «Settings…» в группе View (`src/renderer/palette/commands.ts`), с Project-ом и
     без.
   - State окна — `src/renderer/settings/settings-window.ts` (новый, zustand, как
     `first-run-store.ts`): `openSettings(sectionId?)`, `closeSettings()`; подписка на `menu.command`.
   - Окно смонтировано в `src/renderer/shell/AppShell.tsx` рядом с `<FirstRun />`.
6. Окно на Project-е Linked machine-а показывает Settings своей Machine: каналы `local` идут на
   свою машину (`src/renderer/ipc.ts:5-11`).

Решено в Ticket-е, подтвердить у владельца: «Settings…» на Windows — первый пункт File; General до
Ticket-а 03 показывает версию; «Settings…» есть и в палитре.

**Не входит:** содержимое разделов — масштаб (Ticket 03), Machines (05), Health (06), Shortcuts
(11); раздел «Terminal AI» — Epic `worfy-terminal-ai`; обработчик Cmd/Ctrl+, в renderer — только
ускоритель меню; запоминание последнего открытого раздела.

## Готово, когда

- [ ] Unit `test/unit/settings-dialog.test.tsx` (новый): два раздела-заглушки с `order` 20 и 10 —
  в списке по `order`; клик и ↑/↓ меняют раздел; Esc и «Close» закрывают и возвращают фокус;
  `openSettings('<id>')` открывает нужный раздел; модуль без `title` — ошибка с именем файла.
- [ ] Unit, тот же файл: `SettingSwitch` — `role="switch"`, `aria-checked`; клик зовёт `onChange`
  с обратным значением; `disabled` — не зовёт.
- [ ] Contract `test/contract/view-menu.test.ts`: на `darwin` в меню приложения есть «Settings…» с
  `CmdOrCtrl+,`, прежние пункты роли `appMenu` на месте; на `win32` «Settings…» — первый пункт File,
  выход из приложения на месте; клик шлёт окну в фокусе `menu.command` со значением `settings`.
- [ ] Unit `test/unit/palette-commands.test.tsx`: «Settings…» есть в группе View с Project-ом и без
  и открывает окно.
- [ ] e2e `test/e2e/settings.spec.ts` (новый): пункт меню по id открывает Settings, General
  показывает версию; Esc закрывает; «Settings…» из палитры открывает снова. Снимки
  `settings-general` в светлой и тёмной теме (`snapshotThemes`).
- [ ] (вручную) `pnpm dev`: ⌘, открывает Settings на Canvas, в Session, в поле ввода Session и при
  фокусе в Terminal Node; Esc закрывает. Как проверить: окно worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.
- [ ] Windows-ПК: gate full — строка вердикта и код выхода в PR (платформенный PR: `src/main/menu.ts`
  ветвится по системе; spec, «Соглашения», «Платформенный PR»).

## Тесты

Сначала падающий test — unit «два раздела в списке по `order`»: окна нет. Затем contract меню.

Ускоритель `CmdOrCtrl+,` Playwright не нажимает: e2e зовёт пункт меню по id, клавишу проверяет ручной
пункт. В «Итог» — как подключить раздел (экспорты файла) и как test открывает Settings: этого ждёт
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

## Итог

Заполняется при закрытии.
